# Nogra Index

Workspace: {{workspaceName}}
Created: {{generatedAt}}

This folder stores the local Nogra index: small records that help Claude and
the operator meet on the same intent before work reaches files, external
systems or git history.

The index is not a general notes folder. Keep facts compact, sourced and useful
for routing, brief writing, dispatch decisions, verification and scenario
grading.

## Five Anchors

1. `risk-intake.md` - current intent, GO shape, irreversible actions, evidence
   expectations, allowed systems and recurring drift risks.
2. `behavior-score.md` - scenario grading results grouped by drift cluster and
   mode.
3. `risk-registry.md` - systems Nogra may read, write, deploy, send, migrate,
   bill or must not touch.
4. `../state/DECISIONS.md` - durable decisions with why, alternatives, owner
   and linked artifacts.
5. `EXPANSIONS.md` - when to add new Nogra surfaces such as project hubs,
   scenario packs, evidence adapters or verifier flows.

`workspaces.jsonl` remains the machine-readable project index for workspace
hubs. The other files are operator-readable control surfaces.
