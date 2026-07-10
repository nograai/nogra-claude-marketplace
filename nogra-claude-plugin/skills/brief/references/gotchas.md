# Brief Gotchas

Use this reference when deciding whether a Nogra brief should exist.

## Casual Mention Is Not Pull

Symptom: user says "Nogra" in passing and Claude starts drafting a brief.

Cause: the skill treated any Nogra mention as accepted workflow intent.

Action: only start brief flow when the user asks for `/nogra:brief`, a Nogra
brief, or says to do the work through Nogra.

## Provider Or Plugin Request

Symptom: user asks another provider, plugin or connector to answer, and Nogra
intercepts as a brief request.

Cause: Nogra routing was treated as global ownership.

Action: keep that request outside the Nogra brief flow unless the user asks to
turn it into Nogra-managed work.

## High Risk Does Not Automatically Mean Brief

Symptom: irreversible or production work auto-starts a brief because it is risky.

Cause: risk detection and Nogra opt-in were collapsed.

Action: use Claude Code's native permission model and judgment for direct work.
Enter Nogra only when the user pulls the Nogra workflow.

## Wrong Workspace

Symptom: a brief is written from one folder for work that actually targets
another folder.

Cause: current `.nogra/` state was assumed to govern the target project.

Action: ask one location question or make the external-handoff boundary visible
inside the brief. Do not silently bind the wrong workspace.

## Brief Becomes Execution

Symptom: Claude writes a brief and starts implementing immediately.

Cause: brief approval and execution GO were merged.

Action: show the brief, wait for explicit GO after review, then dispatch.
