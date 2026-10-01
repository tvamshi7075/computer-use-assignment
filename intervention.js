const fs = require("fs");
const path = require("path");
const readline = require("readline");

const EVIDENCE_DIR = path.join(__dirname, "evidence");
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, "screenshots");

function ensureDirectories() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      "\nPress ENTER after you have completed the human intervention...",
      () => {
        rl.close();
        resolve();
      }
    );
  });
}

async function requestHumanIntervention({
  page,
  capability,
  step,
  reason,
  evidence,
}) {
  ensureDirectories();

  const interventionId = `intervention-${Date.now()}`;

  const screenshotName = `${interventionId}.png`;

  const screenshotPath = path.join(
    SCREENSHOT_DIR,
    screenshotName
  );

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  const intervention = {
    interventionId,
    status: "waiting_for_human",
    requestedAt: new Date().toISOString(),

    capability: {
      id: capability.id,
      version: capability.version,
    },

    blockedStep: step
      ? {
          id: step.id,
          action: step.action,
          target: step.target,
        }
      : null,

    reason,

    observedUrl: page.url(),

    screenshot: `screenshots/${screenshotName}`,

    instructions: [
      "Automation is paused.",
      "Use the currently open browser window.",
      "Resolve the blocked state manually.",
      "Do not close the browser.",
      "Return to the terminal and press ENTER.",
    ],
  };

  const interventionFile = path.join(
    EVIDENCE_DIR,
    "intervention-request.json"
  );

  fs.writeFileSync(
    interventionFile,
    JSON.stringify(intervention, null, 2),
    "utf8"
  );

  console.log("\n================================");
  console.log("HUMAN INTERVENTION REQUIRED");
  console.log("================================");

  console.log(`Reason: ${reason}`);

  if (step) {
    console.log(`Blocked step: ${step.id}`);
  }

  console.log(`Current URL: ${page.url()}`);

  console.log(
    "\nAutomation is now PAUSED."
  );

  console.log(
    "Use the SAME browser window to resolve the problem manually."
  );

  console.log(
    "When finished, return to this terminal."
  );

  evidence.interventions =
    evidence.interventions || [];

  const evidenceEntry = {
    ...intervention,
  };

  evidence.interventions.push(
    evidenceEntry
  );

  await waitForEnter();

  evidenceEntry.status =
    "human_completed";

  evidenceEntry.resumedAt =
    new Date().toISOString();

  evidenceEntry.urlAfterHuman =
    page.url();

  intervention.status =
    "human_completed";

  intervention.resumedAt =
    evidenceEntry.resumedAt;

  intervention.urlAfterHuman =
    page.url();

  fs.writeFileSync(
    interventionFile,
    JSON.stringify(intervention, null, 2),
    "utf8"
  );

  console.log("\n================================");
  console.log("CONTROL RETURNED TO AUTOMATION");
  console.log("================================");

  console.log(
    `Browser URL after human action: ${page.url()}`
  );

  return {
    resumed: true,
    interventionId,
  };
}

module.exports = {
  requestHumanIntervention,
};