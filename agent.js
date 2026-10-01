const { chromium } = require("playwright");
const Groq = require("groq-sdk");
const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIGURATION
// ============================================================

const TARGET_URL = "http://127.0.0.1:3300";

const GOAL =
  "Find member M1001, open the member, open the savings account, and return the current balance.";

const DISCOVERY_MEMBER_ID = "M1001";

const MAX_STEPS = 10;

const MODEL = "openai/gpt-oss-20b";

const ARTIFACT_DIR = path.join(
  __dirname,
  "artifacts"
);

const EVIDENCE_DIR = path.join(
  __dirname,
  "evidence"
);

const SCREENSHOT_DIR = path.join(
  EVIDENCE_DIR,
  "screenshots"
);

// ============================================================
// DIRECTORY SETUP
// ============================================================

function ensureDirectories() {
  fs.mkdirSync(ARTIFACT_DIR, {
    recursive: true,
  });

  fs.mkdirSync(EVIDENCE_DIR, {
    recursive: true,
  });

  fs.mkdirSync(SCREENSHOT_DIR, {
    recursive: true,
  });
}

// ============================================================
// GROQ CLIENT
// ============================================================

if (!process.env.GROQ_API_KEY) {
  console.error(
    "ERROR: GROQ_API_KEY is not set."
  );

  console.error(
    'Set it in PowerShell with: $env:GROQ_API_KEY="YOUR_KEY"'
  );

  process.exit(1);
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ============================================================
// OBSERVE LIVE UI
// ============================================================

async function observePage(page) {
  const bodyText = await page
    .locator("body")
    .innerText();

  const controls = await page
    .locator("input, button, a")
    .evaluateAll((elements) => {
      return elements.map((element) => {
        const tag =
          element.tagName.toLowerCase();

        let role = null;

        if (tag === "input") {
          role = "textbox";
        } else if (tag === "button") {
          role = "button";
        } else if (tag === "a") {
          role = "link";
        }

        return {
          tag,
          role,

          text: (
            element.innerText ||
            element.textContent ||
            ""
          ).trim(),

          value:
            element.value || "",

          ariaLabel:
            element.getAttribute(
              "aria-label"
            ),

          htmlName:
            element.getAttribute(
              "name"
            ),

          id:
            element.id || null,

          href:
            element.getAttribute(
              "href"
            ),
        };
      });
    });

  return {
    url: page.url(),
    text: bodyText,
    controls,
  };
}

// ============================================================
// SANITIZE EVIDENCE
// ============================================================

function sanitizeObservation(
  observation
) {
  /*
    This demo uses fictional data.

    We intentionally record only visible UI state.
    We do NOT persist:
    - API keys
    - cookies
    - authorization headers
    - browser storage
    - credentials
  */

  return {
    url: observation.url,

    visibleText:
      observation.text,

    controls:
      observation.controls.map(
        (control) => ({
          tag:
            control.tag,

          role:
            control.role,

          text:
            control.text,

          value:
            control.value,

          ariaLabel:
            control.ariaLabel,

          htmlName:
            control.htmlName,

          id:
            control.id,

          href:
            control.href,
        })
      ),
  };
}

// ============================================================
// VALIDATE LLM DECISION
// ============================================================

function validateDecision(decision) {
  if (
    !decision ||
    typeof decision !== "object"
  ) {
    throw new Error(
      "LLM decision must be a JSON object."
    );
  }

  const allowedActions = [
    "fill",
    "click",
    "done",
  ];

  if (
    !allowedActions.includes(
      decision.action
    )
  ) {
    throw new Error(
      `LLM returned invalid action: ${decision.action}`
    );
  }

  // ----------------------------------------------------------
  // FILL VALIDATION
  // ----------------------------------------------------------

  if (
    decision.action === "fill"
  ) {
    if (
      decision.role !==
      "textbox"
    ) {
      throw new Error(
        `LLM returned invalid fill role: ${decision.role}`
      );
    }

    if (
      typeof decision.name !==
        "string" ||
      !decision.name
    ) {
      throw new Error(
        "Fill action is missing a valid control name."
      );
    }

    if (
      typeof decision.value !==
      "string"
    ) {
      throw new Error(
        "Fill action is missing a string value."
      );
    }
  }

  // ----------------------------------------------------------
  // CLICK VALIDATION
  // ----------------------------------------------------------

  if (
    decision.action === "click"
  ) {
    const allowedClickRoles = [
      "button",
      "link",
    ];

    if (
      !allowedClickRoles.includes(
        decision.role
      )
    ) {
      throw new Error(
        `LLM returned invalid click role: ${decision.role}`
      );
    }

    if (
      typeof decision.name !==
        "string" ||
      !decision.name
    ) {
      throw new Error(
        "Click action is missing a valid control name."
      );
    }
  }

  // ----------------------------------------------------------
  // DONE VALIDATION
  // ----------------------------------------------------------

  if (
    decision.action === "done"
  ) {
    if (
      typeof decision.result !==
        "string" ||
      !decision.result
    ) {
      throw new Error(
        "Done action is missing a result."
      );
    }
  }

  return decision;
}

// ============================================================
// ASK GROQ FOR NEXT ACTION
// ============================================================

async function askAI(
  observation,
  previousActions
) {
  const prompt = `
You are a computer-use agent controlling a fictional local banking demo application.

Your job is to inspect the CURRENT live UI observation and choose exactly ONE next action.

GOAL:
${GOAL}

CURRENT LIVE PAGE OBSERVATION:
${JSON.stringify(observation, null, 2)}

PREVIOUS ACTIONS:
${JSON.stringify(previousActions, null, 2)}

IMPORTANT:
Base your decision on the CURRENT page.
Do not repeat an action whose intended state is already satisfied.
Only interact with controls visible in CURRENT LIVE PAGE OBSERVATION.

EXPECTED PROGRESSION:

1. If the Member ID textbox is empty:
   fill Member ID with M1001.

2. If Member ID already contains M1001:
   click Search.
   Search is a BUTTON.

3. If search results contain:
   Open member M1001
   click it.
   Open member M1001 is a LINK.

4. If member details contain:
   View savings account
   click it.
   View savings account is a LINK.

5. If the savings account page displays the current balance:
   return done with the balance.

ALLOWED ACTION FORMAT:

For filling a textbox:

{
  "action": "fill",
  "role": "textbox",
  "name": "Member ID",
  "value": "M1001"
}

For clicking a button:

{
  "action": "click",
  "role": "button",
  "name": "Search"
}

For clicking a link:

{
  "action": "click",
  "role": "link",
  "name": "Open member M1001"
}

or:

{
  "action": "click",
  "role": "link",
  "name": "View savings account"
}

When the goal is complete:

{
  "action": "done",
  "result": "Current savings balance is $1,245.67"
}

STRICT ROLE RULES:

<input>  -> "textbox"
<button> -> "button"
<a>      -> "link"

For a click action, role MUST be exactly ONE of:

"button"

OR

"link"

NEVER return:

"button or link"
"link or button"
"button/link"
"link/button"

Specific known controls:

Search
-> role "button"

Open member M1001
-> role "link"

View savings account
-> role "link"

Return ONLY one valid JSON object.

Do not use markdown.
Do not use code fences.
Do not explain the decision.
`;

  const completion =
    await groq.chat.completions.create({
      model: MODEL,

      temperature: 0,

      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

  const rawContent =
    completion.choices[0]
      .message.content.trim();

  let decision;

  try {
    decision =
      JSON.parse(rawContent);
  } catch (error) {
    throw new Error(
      `LLM returned invalid JSON: ${rawContent}`
    );
  }

  return validateDecision(
    decision
  );
}

// ============================================================
// EXECUTE LLM ACTION
// ============================================================

async function executeAction(
  page,
  decision
) {
  if (
    decision.action === "fill"
  ) {
    console.log(
      `FILL: ${decision.name} = ${decision.value}`
    );

    await page
      .getByRole(
        decision.role,
        {
          name:
            decision.name,
        }
      )
      .fill(
        decision.value,
        {
          timeout: 5000,
        }
      );

    return;
  }

  if (
    decision.action === "click"
  ) {
    console.log(
      `CLICK: ${decision.name}`
    );

    await page
      .getByRole(
        decision.role,
        {
          name:
            decision.name,
        }
      )
      .click({
        timeout: 5000,
      });

    return;
  }

  if (
    decision.action === "done"
  ) {
    return;
  }

  throw new Error(
    `Unsupported discovery action: ${decision.action}`
  );
}

// ============================================================
// CANONICALIZE DISCOVERED TARGET
// ============================================================

function canonicalizeTargetName(
  targetName
) {
  if (
    typeof targetName !==
    "string"
  ) {
    return targetName;
  }

  return targetName.replace(
    DISCOVERY_MEMBER_ID,
    "{{memberId}}"
  );
}

// ============================================================
// CREATE REUSABLE CAPABILITY ARTIFACT
// ============================================================

function saveCapability(
  previousActions,
  finalResult
) {
  ensureDirectories();

  const executableActions =
    previousActions.filter(
      (action) =>
        action.action !==
        "done"
    );

  const steps =
    executableActions.map(
      (action, index) => {
        const step = {
          id:
            `step-${index + 1}`,

          action:
            action.action,

          target: {
            strategy:
              "accessible-role",

            role:
              action.role,

            name:
              canonicalizeTargetName(
                action.name
              ),
          },

          timeoutMs:
            5000,

          risk:
            "safe",
        };

        if (
          action.action ===
          "fill"
        ) {
          step.value =
            action.value ===
            DISCOVERY_MEMBER_ID
              ? "{{memberId}}"
              : action.value;
        }

        return step;
      }
    );

  const artifact = {
    schemaVersion: "1.0",

    capability: {
      id:
        "lookup-savings-balance",

      name:
        "Lookup Savings Balance",

      description:
        "Find a fictional member in the demo banking application and return the current savings balance.",

      version:
        "1.0.0",
    },

    target: {
      surface:
        "web",

      baseUrl:
        TARGET_URL,

      allowedOrigins: [
        TARGET_URL,
      ],
    },

    inputs: {
      memberId: {
        type:
          "string",

        required:
          true,

        description:
          "Fictional member identifier such as M1001.",

        pattern:
          "^M\\d{4}$",
      },
    },

    outputs: {
      currentBalance: {
        type:
          "string",

        description:
          "Current savings account balance.",
      },
    },

    steps,

    checkpoint: {
      type:
        "text-visible",

      text:
        "Current balance",

      description:
        "The savings account page must display the current balance.",
    },

    extraction: {
      currentBalance: {
        strategy:
          "aria-label",

        value:
          "Current balance",
      },
    },

    safety: {
      allowedActions: [
        "fill",
        "click",
        "read",
      ],

      riskLevel:
        "read-only",

      allowedOrigins: [
        TARGET_URL,
      ],

      requireHumanForRiskyActions:
        true,

      persistRawSensitiveData:
        false,
    },

    discovery: {
      provider:
        "groq",

      model:
        MODEL,

      llmUsed:
        true,

      discoveredAt:
        new Date().toISOString(),

      finalResult,
    },
  };

  const artifactPath =
    path.join(
      ARTIFACT_DIR,
      "lookup-savings.json"
    );

  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      artifact,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `Capability saved: ${artifactPath}`
  );

  return artifactPath;
}

// ============================================================
// SAVE DISCOVERY EVIDENCE
// ============================================================

function saveDiscoveryEvidence(
  evidence
) {
  ensureDirectories();

  const evidencePath =
    path.join(
      EVIDENCE_DIR,
      "discovery-log.json"
    );

  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      evidence,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `Discovery evidence saved: ${evidencePath}`
  );
}

// ============================================================
// REPEATED ACTION / STUCK DETECTION
// ============================================================

function isRepeatedDecision(
  decision,
  previousActions
) {
  if (
    previousActions.length <
    2
  ) {
    return false;
  }

  const current =
    JSON.stringify(
      decision
    );

  const previous =
    JSON.stringify(
      previousActions[
        previousActions.length -
          1
      ]
    );

  const secondPrevious =
    JSON.stringify(
      previousActions[
        previousActions.length -
          2
      ]
    );

  return (
    current === previous &&
    current === secondPrevious
  );
}

// ============================================================
// MAIN DISCOVERY LOOP
// ============================================================

async function main() {
  ensureDirectories();

  console.log(
    "Starting REAL LLM-driven discovery..."
  );

  console.log(
    "Provider: Groq"
  );

  console.log(
    `Model: ${MODEL}`
  );

  console.log(
    `Goal: ${GOAL}`
  );

  const evidence = {
    evidenceVersion:
      "1.0",

    runType:
      "llm-discovery",

    runId:
      `discovery-${Date.now()}`,

    startedAt:
      new Date().toISOString(),

    provider:
      "groq",

    model:
      MODEL,

    llmUsed:
      true,

    goal:
      GOAL,

    target: {
      surface:
        "web",

      baseUrl:
        TARGET_URL,
    },

    steps: [],

    result: null,

    artifactCreated:
      null,
  };

  const browser =
    await chromium.launch({
      headless: false,
    });

  const page =
    await browser.newPage();

  const previousActions = [];

  try {
    await page.goto(
      TARGET_URL,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          10000,
      }
    );

    // ========================================================
    // OBSERVE -> DECIDE -> ACT LOOP
    // ========================================================

    for (
      let stepNumber = 1;
      stepNumber <= MAX_STEPS;
      stepNumber++
    ) {
      console.log(
        `\n--- Discovery step ${stepNumber} ---`
      );

      // ------------------------------------------------------
      // OBSERVE
      // ------------------------------------------------------

      const observation =
        await observePage(
          page
        );

      console.log(
        `Observing: ${observation.url}`
      );

      // ------------------------------------------------------
      // DECIDE WITH REAL LLM
      // ------------------------------------------------------

      const decision =
        await askAI(
          observation,
          previousActions
        );

      console.log(
        "LLM decision:",
        decision
      );

      evidence.steps.push({
        stepNumber,

        observedAt:
          new Date().toISOString(),

        observation:
          sanitizeObservation(
            observation
          ),

        llmDecision:
          decision,
      });

      // ------------------------------------------------------
      // STUCK DETECTION
      // ------------------------------------------------------

      if (
        isRepeatedDecision(
          decision,
          previousActions
        )
      ) {
        throw new Error(
          "Discovery agent is stuck repeating the same action."
        );
      }

      previousActions.push(
        decision
      );

      // ------------------------------------------------------
      // GOAL COMPLETE
      // ------------------------------------------------------

      if (
        decision.action ===
        "done"
      ) {
        console.log(
          "\n=============================="
        );

        console.log(
          "LLM DISCOVERY SUCCESS"
        );

        console.log(
          "=============================="
        );

        console.log(
          decision.result
        );

        const artifactPath =
          saveCapability(
            previousActions,
            decision.result
          );

        evidence.completedAt =
          new Date().toISOString();

        evidence.result = {
          status:
            "success",

          finalResult:
            decision.result,
        };

        evidence.artifactCreated =
          path
            .relative(
              __dirname,
              artifactPath
            )
            .replace(
              /\\/g,
              "/"
            );

        saveDiscoveryEvidence(
          evidence
        );

        await page.waitForTimeout(
          1500
        );

        await browser.close();

        return;
      }

      // ------------------------------------------------------
      // ACT
      // ------------------------------------------------------

      await executeAction(
        page,
        decision
      );

      await page.waitForTimeout(
        500
      );
    }

    throw new Error(
      `Discovery exceeded MAX_STEPS (${MAX_STEPS}).`
    );
  } catch (error) {
    // ========================================================
    // DISCOVERY FAILURE EVIDENCE
    // ========================================================

    const screenshotName =
      `discovery-failure-${Date.now()}.png`;

    const screenshotPath =
      path.join(
        SCREENSHOT_DIR,
        screenshotName
      );

    await page
      .screenshot({
        path:
          screenshotPath,

        fullPage:
          true,
      })
      .catch(() => {});

    evidence.completedAt =
      new Date().toISOString();

    evidence.result = {
      status:
        "failure",

      error: {
        type:
          error.name ||
          "DiscoveryError",

        message:
          error.message,
      },

      observedUrl:
        page.url(),

      screenshot:
        `screenshots/${screenshotName}`,
    };

    saveDiscoveryEvidence(
      evidence
    );

    console.error(
      "\n=============================="
    );

    console.error(
      "LLM DISCOVERY FAILED"
    );

    console.error(
      "=============================="
    );

    console.error(
      error.message
    );

    await page
      .waitForTimeout(
        2000
      )
      .catch(() => {});

    await browser
      .close()
      .catch(() => {});

    process.exitCode = 1;
  }
}

// ============================================================
// START
// ============================================================

main().catch(
  (error) => {
    console.error(
      "\nDiscovery terminated:"
    );

    console.error(
      error.message
    );

    process.exit(1);
  }
);