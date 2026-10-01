# Computer-Use Automation System

A small end-to-end prototype that demonstrates how an LLM can discover a workflow against a live legacy-style banking UI, save the successful workflow as a reusable capability artifact, and replay that capability deterministically without an LLM in the execution loop.

The project also demonstrates structured error handling, safety controls, evidence logging, and same-session human intervention.

## What This Demo Does

The demo uses a fictional Member Servicing application.

The discovery goal is:

> Find member M1001, open the member, open the savings account, and return the current balance.

During discovery, an LLM observes the live UI and chooses one action at a time.

A successful discovery run produces a versioned capability artifact:

```text
artifacts/lookup-savings.json
```

The artifact can then be replayed with different member IDs without using an LLM.

Examples:

```powershell
node replay.js M1001
node replay.js M1002
node replay.js M9999
```

## Architecture

```text
                    DISCOVERY

Natural-language goal
        |
        v
+-------------------+
|   Groq LLM        |
| openai/gpt-oss-20b|
+-------------------+
        |
        | decide next action
        v
+-------------------+
| Playwright        |
| Live Web Surface  |
+-------------------+
        |
        | observe -> decide -> act
        v
Successful goal completion
        |
        v
+------------------------------+
| Versioned Capability Artifact|
| artifacts/lookup-savings.json|
+------------------------------+


                 DETERMINISTIC REPLAY

Invocation input
{ memberId: "M1002" }
        |
        v
+------------------------------+
| Capability Artifact          |
+------------------------------+
        |
        v
+------------------------------+
| Deterministic Replay Engine  |
| NO LLM                       |
+------------------------------+
        |
        v
+------------------------------+
| Playwright / Live UI         |
+------------------------------+
        |
        +---- success -> typed output
        |
        +---- business outcome
        |
        +---- blocked step
                    |
                    v
             Human Intervention
                    |
             same browser session
                    |
                    v
             checkpoint verification
```

## Requirements

- Windows, macOS, or Linux
- Node.js
- npm
- A Groq API key for the discovery run

The deterministic replay path does not require an LLM API call.

## Installation

Clone the repository and install dependencies:

```powershell
npm install
```

The project uses:

- Playwright
- Groq SDK

## API Key

Do not store API keys in the repository.

Set the Groq API key as an environment variable.

PowerShell:

```powershell
$env:GROQ_API_KEY="YOUR_GROQ_API_KEY"
```

You can verify that it exists without printing the secret:

```powershell
if ($env:GROQ_API_KEY) { "Groq key is set" } else { "Groq key is NOT set" }
```

`.env` files and dependencies are excluded through `.gitignore`.

## Start the Demo Application

Open a terminal:

```powershell
node app.js
```

The fictional Member Servicing application runs at:

```text
http://127.0.0.1:3300
```

Keep this terminal running.

## Run LLM Discovery

Open another terminal with `GROQ_API_KEY` configured:

```powershell
node agent.js
```

The discovery agent performs an observe-decide-act loop against the live application.

A successful run:

1. Observes the current UI.
2. Asks the LLM for one next action.
3. Executes the action with Playwright.
4. Observes the resulting UI.
5. Repeats until the goal is satisfied.
6. Saves the successful workflow as a reusable capability artifact.

Outputs:

```text
artifacts/lookup-savings.json
evidence/discovery-log.json
```

The discovery model used by this demo is:

```text
openai/gpt-oss-20b
```

through Groq.

## Run Deterministic Replay

Replay does not call the LLM.

Run:

```powershell
node replay.js M1001
```

Example successful result:

```json
{
  "status": "success",
  "capability": "lookup-savings-balance",
  "version": "1.0.0",
  "inputs": {
    "memberId": "M1001"
  },
  "outputs": {
    "currentBalance": "$1,245.67"
  },
  "checkpointVerified": true,
  "modelUsed": false,
  "humanIntervention": false
}
```

The capability is parameterized, so it can also be invoked for another fictional member:

```powershell
node replay.js M1002
```

## Business Outcomes

A valid request that has no matching member is treated as an expected business outcome rather than a system crash.

Example:

```powershell
node replay.js M9999
```

Produces a structured result similar to:

```json
{
  "status": "business_outcome",
  "code": "MEMBER_NOT_FOUND",
  "message": "The requested member does not exist."
}
```

## Error Handling

The replay engine distinguishes between:

- successful execution
- expected business outcomes
- input or safety-policy violations
- blocked UI steps
- hard failures

Step failures include the failed step, error information, observed URL, and screenshot evidence where appropriate.

## Human Intervention

When a UI step cannot be completed deterministically, the replay engine can pause and create an intervention request.

The intervention contains:

- blocked step
- reason
- current URL
- screenshot
- timestamp
- capability information

The browser remains open.

A human operates the same live browser session, resolves the blocked state, returns to the terminal, and presses ENTER.

Automation then regains control, validates the allowed origin, verifies the final checkpoint, and extracts the output.

Evidence is written to:

```text
evidence/intervention-request.json
evidence/replay-human-intervention-log.json
evidence/screenshots/
```

## Safety

The capability artifact contains explicit safety metadata.

The current demo:

- restricts execution to an allowlisted origin
- restricts replay to allowlisted action types
- validates typed input parameters
- treats the demonstrated capability as read-only
- does not persist API secrets
- uses only fictional member data
- revalidates the origin during replay and after human handoff

The demo intentionally avoids irreversible banking operations.

## Capability Artifact

The reusable artifact contains:

- schema version
- capability ID and version
- target surface
- typed inputs
- typed outputs
- ordered deterministic actions
- parameterized target identification
- per-step timeouts
- final checkpoint
- output extraction rules
- safety policy
- discovery metadata

Example parameterized target:

```json
{
  "action": "click",
  "target": {
    "strategy": "accessible-role",
    "role": "link",
    "name": "Open member {{memberId}}"
  }
}
```

This allows a capability discovered with one fictional member to be replayed for another member without another LLM discovery run.

## Evidence

The `evidence/` directory contains examples from actual runs, including:

```text
evidence/
├── discovery-log.json
├── replay-success-log.json
├── replay-business-outcome-log.json
├── replay-failure-log.json
├── replay-human-intervention-log.json
├── intervention-request.json
└── screenshots/
```

These demonstrate:

- real LLM-driven discovery
- deterministic replay without an LLM
- parameterized capability reuse
- expected business outcomes
- failure diagnostics
- human escalation and same-session handoff

## Project Structure

```text
computer-use-assignment/
├── app.js
├── agent.js
├── replay.js
├── intervention.js
├── package.json
├── package-lock.json
├── .gitignore
├── README.md
├── REPORT.md
├── artifacts/
│   └── lookup-savings.json
└── evidence/
    ├── discovery-log.json
    ├── replay-success-log.json
    ├── replay-business-outcome-log.json
    ├── replay-failure-log.json
    ├── replay-human-intervention-log.json
    ├── intervention-request.json
    └── screenshots/
```

## Demo Flow

For a complete demonstration:

```powershell
# Terminal 1
node app.js
```

```powershell
# Terminal 2
$env:GROQ_API_KEY="YOUR_GROQ_API_KEY"
node agent.js
```

Then demonstrate deterministic replay:

```powershell
node replay.js M1001
node replay.js M1002
node replay.js M9999
```

The important architectural boundary is that `agent.js` uses the LLM during discovery, while `replay.js` consumes the saved artifact without using an LLM.

# I used an llm to create this agent It may not be 100 % right but can be used as a reference #