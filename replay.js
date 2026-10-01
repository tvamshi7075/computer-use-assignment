const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const {
  requestHumanIntervention,
} = require("./intervention");

// ============================================================
// PATHS
// ============================================================

const ARTIFACT_PATH = path.join(
  __dirname,
  "artifacts",
  "lookup-savings.json"
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
// EVIDENCE
// ============================================================

function ensureEvidenceDirectories() {
  fs.mkdirSync(EVIDENCE_DIR, {
    recursive: true,
  });

  fs.mkdirSync(SCREENSHOT_DIR, {
    recursive: true,
  });
}

function saveEvidence(filename, data) {
  ensureEvidenceDirectories();

  const filePath = path.join(
    EVIDENCE_DIR,
    filename
  );

  fs.writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  console.log(
    `Evidence saved: ${filePath}`
  );
}

// ============================================================
// CAPABILITY
// ============================================================

function loadCapability() {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(
      `Capability artifact not found: ${ARTIFACT_PATH}`
    );
  }

  return JSON.parse(
    fs.readFileSync(
      ARTIFACT_PATH,
      "utf8"
    )
  );
}

// ============================================================
// TEMPLATE RESOLUTION
// ============================================================

function resolveTemplate(value, inputs) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(
    /\{\{(\w+)\}\}/g,
    (match, key) => {
      if (!(key in inputs)) {
        throw new Error(
          `Missing input parameter: ${key}`
        );
      }

      return inputs[key];
    }
  );
}

// ============================================================
// INPUT VALIDATION
// ============================================================

function validateInputs(artifact, inputs) {
  for (const [name, definition] of Object.entries(
    artifact.inputs
  )) {
    const value = inputs[name];

    if (
      definition.required &&
      (value === undefined ||
        value === null ||
        value === "")
    ) {
      throw new Error(
        `Required input is missing: ${name}`
      );
    }

    if (
      definition.type === "string" &&
      value !== undefined &&
      typeof value !== "string"
    ) {
      throw new Error(
        `Input "${name}" must be a string.`
      );
    }

    if (
      definition.pattern &&
      value !== undefined
    ) {
      const regex =
        new RegExp(
          definition.pattern
        );

      if (!regex.test(value)) {
        throw new Error(
          `Input "${name}" does not match ${definition.pattern}`
        );
      }
    }
  }
}

// ============================================================
// SAFETY
// ============================================================

function validateSafety(artifact) {
  const allowedActions =
    artifact.safety.allowedActions;

  for (const step of artifact.steps) {
    if (
      !allowedActions.includes(
        step.action
      )
    ) {
      throw new Error(
        `Safety policy blocked action "${step.action}" in ${step.id}`
      );
    }
  }
}

function validateOrigin(artifact, url) {
  const origin =
    new URL(url).origin;

  const allowedOrigins =
    artifact.safety.allowedOrigins;

  if (
    !allowedOrigins.includes(origin)
  ) {
    throw new Error(
      `Safety policy blocked origin: ${origin}`
    );
  }
}

// ============================================================
// LOCATORS
// ============================================================

function createLocator(
  page,
  target,
  inputs
) {
  if (
    target.strategy ===
    "accessible-role"
  ) {
    const resolvedName =
      resolveTemplate(
        target.name,
        inputs
      );

    return page.getByRole(
      target.role,
      {
        name: resolvedName,
      }
    );
  }

  throw new Error(
    `Unsupported locator strategy: ${target.strategy}`
  );
}

// ============================================================
// BUSINESS OUTCOMES
// ============================================================

async function detectBusinessOutcome(page) {
  const text =
    await page
      .locator("body")
      .innerText();

  if (
    text.includes("Member not found") ||
    text.includes("No member found")
  ) {
    return {
      status:
        "business_outcome",

      code:
        "MEMBER_NOT_FOUND",

      message:
        "The requested member does not exist.",
    };
  }

  return null;
}

// ============================================================
// EXECUTE STEP
// ============================================================

async function executeStep(
  page,
  artifact,
  step,
  inputs,
  evidence
) {
  const startedAt =
    new Date().toISOString();

  console.log(
    `\nExecuting ${step.id}: ${step.action}`
  );

  validateOrigin(
    artifact,
    page.url()
  );

  const locator =
    createLocator(
      page,
      step.target,
      inputs
    );

  try {
    if (
      step.action === "fill"
    ) {
      const value =
        resolveTemplate(
          step.value,
          inputs
        );

      console.log(
        `FILL "${step.target.name}"`
      );

      await locator.fill(
        value,
        {
          timeout:
            step.timeoutMs,
        }
      );
    } else if (
      step.action === "click"
    ) {
      const targetName =
        resolveTemplate(
          step.target.name,
          inputs
        );

      console.log(
        `CLICK "${targetName}"`
      );

      await locator.click({
        timeout:
          step.timeoutMs,
      });
    } else {
      throw new Error(
        `Unsupported replay action: ${step.action}`
      );
    }

    validateOrigin(
      artifact,
      page.url()
    );

    evidence.steps.push({
      stepId: step.id,
      action: step.action,

      target: {
        strategy:
          step.target.strategy,

        role:
          step.target.role,

        name:
          resolveTemplate(
            step.target.name,
            inputs
          ),
      },

      status: "success",

      startedAt,

      completedAt:
        new Date().toISOString(),

      observedUrl:
        page.url(),
    });

    return {
      success: true,
    };
  } catch (error) {
    evidence.steps.push({
      stepId: step.id,
      action: step.action,

      target: {
        strategy:
          step.target.strategy,

        role:
          step.target.role,

        name:
          resolveTemplate(
            step.target.name,
            inputs
          ),
      },

      status: "blocked",

      startedAt,

      blockedAt:
        new Date().toISOString(),

      observedUrl:
        page.url(),

      error: {
        type:
          error.name ||
          "ReplayError",

        message:
          error.message,
      },
    });

    return {
      success: false,
      error,
    };
  }
}

// ============================================================
// CHECKPOINT
// ============================================================

async function verifyCheckpoint(
  page,
  artifact
) {
  if (
    artifact.checkpoint.type ===
    "text-visible"
  ) {
    const locator =
      page.getByText(
        artifact.checkpoint.text,
        {
          exact: false,
        }
      );

    await locator.waitFor({
      state: "visible",
      timeout: 5000,
    });

    return true;
  }

  throw new Error(
    `Unsupported checkpoint type: ${artifact.checkpoint.type}`
  );
}

// ============================================================
// OUTPUT EXTRACTION
// ============================================================

async function extractOutputs(
  page,
  artifact
) {
  const outputs = {};

  for (
    const [name, extraction]
    of Object.entries(
      artifact.extraction
    )
  ) {
    if (
      extraction.strategy ===
      "aria-label"
    ) {
      const locator =
        page.locator(
          `[aria-label="${extraction.value}"]`
        );

      outputs[name] =
        (
          await locator.innerText()
        ).trim();
    } else {
      throw new Error(
        `Unsupported extraction strategy: ${extraction.strategy}`
      );
    }
  }

  return outputs;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(
    "Starting deterministic capability replay..."
  );

  console.log(
    "NO LLM IS USED DURING REPLAY."
  );

  ensureEvidenceDirectories();

  const memberId =
    process.argv[2] ||
    "M1001";

  const inputs = {
    memberId,
  };

  const artifact =
    loadCapability();

  const evidence = {
    evidenceVersion: "1.0",

    runType:
      "deterministic-replay",

    runId:
      `replay-${Date.now()}`,

    startedAt:
      new Date().toISOString(),

    capability: {
      id:
        artifact.capability.id,

      version:
        artifact.capability.version,
    },

    modelUsed: false,

    inputs: {
      memberId,
    },

    steps: [],

    interventions: [],

    result: null,
  };

  console.log(
    "Capability:",
    artifact.capability.name
  );

  console.log(
    "Version:",
    artifact.capability.version
  );

  console.log(
    "Inputs:",
    inputs
  );

  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  try {
    validateInputs(
      artifact,
      inputs
    );

    validateSafety(
      artifact
    );

    validateOrigin(
      artifact,
      artifact.target.baseUrl
    );
  } catch (error) {
    evidence.completedAt =
      new Date().toISOString();

    evidence.result = {
      status: "failure",

      category:
        "validation_or_policy",

      message:
        error.message,
    };

    saveEvidence(
      "replay-failure-log.json",
      evidence
    );

    throw error;
  }

  // ----------------------------------------------------------
  // BROWSER
  // ----------------------------------------------------------

  const browser =
    await chromium.launch({
      headless: false,
    });

  const page =
    await browser.newPage();

  let currentStep = null;

  try {
    await page.goto(
      artifact.target.baseUrl,
      {
        waitUntil:
          "domcontentloaded",

        timeout: 10000,
      }
    );

    validateOrigin(
      artifact,
      page.url()
    );

    // --------------------------------------------------------
    // REPLAY STEPS
    // --------------------------------------------------------

    for (
      const step of artifact.steps
    ) {
      currentStep = step;

      const beforeOutcome =
        await detectBusinessOutcome(
          page
        );

      if (beforeOutcome) {
        evidence.completedAt =
          new Date().toISOString();

        evidence.result =
          beforeOutcome;

        saveEvidence(
          "replay-business-outcome-log.json",
          evidence
        );

        console.log(
          "\n=============================="
        );

        console.log(
          "KNOWN BUSINESS OUTCOME"
        );

        console.log(
          "=============================="
        );

        console.log(
          JSON.stringify(
            beforeOutcome,
            null,
            2
          )
        );

        await browser.close();
        return;
      }

      const stepResult =
        await executeStep(
          page,
          artifact,
          step,
          inputs,
          evidence
        );

      // ------------------------------------------------------
      // HUMAN ESCALATION
      // ------------------------------------------------------

      if (!stepResult.success) {
        console.log(
          `\nAutomation could not complete ${step.id}.`
        );

        await requestHumanIntervention({
          page,

          capability:
            artifact.capability,

          step,

          reason:
            stepResult.error.message,

          evidence,
        });

        // Human may have navigated somewhere unexpected.
        // Re-check the safety boundary before continuing.
        validateOrigin(
          artifact,
          page.url()
        );

        evidence.steps.push({
          stepId:
            step.id,

          action:
            step.action,

          status:
            "completed_by_human",

          resumedAt:
            new Date().toISOString(),

          observedUrl:
            page.url(),
        });

        console.log(
          `Human intervention completed for ${step.id}.`
        );

        console.log(
          "Automation is resuming..."
        );
      }

      await page.waitForTimeout(
        300
      );

      const afterOutcome =
        await detectBusinessOutcome(
          page
        );

      if (afterOutcome) {
        evidence.completedAt =
          new Date().toISOString();

        evidence.result =
          afterOutcome;

        saveEvidence(
          "replay-business-outcome-log.json",
          evidence
        );

        console.log(
          "\n=============================="
        );

        console.log(
          "KNOWN BUSINESS OUTCOME"
        );

        console.log(
          "=============================="
        );

        console.log(
          JSON.stringify(
            afterOutcome,
            null,
            2
          )
        );

        await page.waitForTimeout(
          1000
        );

        await browser.close();
        return;
      }
    }

    // --------------------------------------------------------
    // FINAL CHECKPOINT
    // --------------------------------------------------------

    console.log(
      "\nVerifying final checkpoint..."
    );

    await verifyCheckpoint(
      page,
      artifact
    );

    const outputs =
      await extractOutputs(
        page,
        artifact
      );

    const hadHumanIntervention =
      evidence.interventions.length > 0;

    const result = {
      status: "success",

      outputs,

      checkpointVerified: true,

      humanIntervention:
        hadHumanIntervention,
    };

    evidence.completedAt =
      new Date().toISOString();

    evidence.result =
      result;

    saveEvidence(
      hadHumanIntervention
        ? "replay-human-intervention-log.json"
        : "replay-success-log.json",
      evidence
    );

    console.log(
      "\n=============================="
    );

    if (
      hadHumanIntervention
    ) {
      console.log(
        "SUCCESS AFTER HUMAN INTERVENTION"
      );
    } else {
      console.log(
        "DETERMINISTIC REPLAY SUCCESS"
      );
    }

    console.log(
      "=============================="
    );

    console.log(
      JSON.stringify(
        {
          status:
            "success",

          capability:
            artifact.capability.id,

          version:
            artifact.capability.version,

          inputs,

          outputs,

          checkpointVerified:
            true,

          modelUsed:
            false,

          humanIntervention:
            hadHumanIntervention,
        },
        null,
        2
      )
    );

    await page.waitForTimeout(
      2000
    );

    await browser.close();
  } catch (error) {
    // --------------------------------------------------------
    // TRUE HARD FAILURE
    //
    // This means replay/handoff/checkpoint itself failed,
    // rather than an ordinary UI step that was handed to a
    // human.
    // --------------------------------------------------------

    ensureEvidenceDirectories();

    const screenshotName =
      `failure-${Date.now()}.png`;

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

      category:
        "hard_failure",

      failedStep:
        currentStep
          ? currentStep.id
          : null,

      error: {
        type:
          error.name ||
          "ReplayError",

        message:
          error.message,
      },

      observedUrl:
        page.url(),

      screenshot:
        `screenshots/${screenshotName}`,
    };

    saveEvidence(
      "replay-failure-log.json",
      evidence
    );

    console.error(
      "\n=============================="
    );

    console.error(
      "DETERMINISTIC REPLAY FAILED"
    );

    console.error(
      "=============================="
    );

    console.error(
      JSON.stringify(
        evidence.result,
        null,
        2
      )
    );

    await page
      .waitForTimeout(2000)
      .catch(() => {});

    await browser
      .close()
      .catch(() => {});

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "\nReplay terminated:"
  );

  console.error(
    error.message
  );

  process.exit(1);
});