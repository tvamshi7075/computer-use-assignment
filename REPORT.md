# Design Report

This prototype implements a thin end-to-end vertical slice of a computer-use automation system for legacy banking applications that do not expose suitable APIs. The core design separates LLM-driven workflow discovery from deterministic production replay.

The demo uses only fictional member data and a locally hosted Member Servicing application.

## Architecture

The system has two distinct execution modes: discovery and replay.

### Discovery

`agent.js` implements an LLM-driven observe-decide-act loop against the live UI.

At each step:

1. Playwright observes the current page, including the URL, visible text, and interactive controls.
2. The observation and goal are sent to the LLM.
3. The LLM returns one structured action.
4. The action is validated and executed against the live page.
5. The resulting page is observed again.
6. The loop continues until the goal is satisfied or execution becomes blocked.

The current implementation uses Groq with `openai/gpt-oss-20b`.

A successful discovery run is converted into a reusable capability artifact rather than replaying the original LLM transcript.

### Replay

`replay.js` loads the saved capability artifact and executes its ordered steps directly with Playwright.

No model is called during replay.

This creates an explicit architectural boundary:

```text
LLM + live UI
      |
      | discovery
      v
Capability Artifact
      |
      | deterministic execution
      v
Replay Engine + live UI