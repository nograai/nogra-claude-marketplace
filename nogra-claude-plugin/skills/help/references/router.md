# Nogra Intent Router

Nogra's router is a thin intent index. It helps Claude choose the right Nogra
skill when the user asks for Nogra, and it stays silent for ordinary work.

The router is not a hook gate, prompt scorer, safety classifier or permission
layer. It does not inspect tool calls, block actions, create records, spawn
agents or decide that a normal task deserves a brief.

Use `index.md` as the companion truth map for Nogra's five local anchors:
risk intake, behavior score, connections/risk registry, decision shape and
expansion guidance. The router chooses the skill; the index explains which
local record carries the fact and why.

## Route Map

Use the first matching route:

- Setup intent: if the user asks to install, enable or set up Nogra in this
  folder, use `/nogra:setup`.
- Existing-project mapping: if the user asks Nogra to learn, adapt to, map or
  index the current project, use `/nogra:adapt`.
- Workspace-hub creation: if the user asks to create a new Nogra-managed
  project folder from a hub, use `/nogra:create <name>`.
- Brief intent: if the user asks for a Nogra brief, a brief-first workflow, or
  says to do the work through Nogra, use `/nogra:brief`.
- Approved-run intent: if an approved brief exists and the user gives GO after
  reviewing it, use `/nogra:dispatch`.
- Verification intent: if the user asks whether work is really done, asks for
  evidence checking, or invokes Nogra verification, use `/nogra:verify`.
- Workspace-state intent: if the user asks for Nogra ledger/state, project
  state, recent briefs/runs, checkpoint freshness, runtime preferences or
  version, use `/nogra:status`.
- Settings intent: if the user asks to configure Nogra language, runtime
  profile, executor model, verifier model or effort, use `/nogra:settings`.
- Guidance-refresh intent: if the user asks whether Nogra guidance changed, or
  a contract mismatch suggests stale installed guidance, use `/nogra:update`.
- Help intent: if the user asks what Nogra is or how to choose a Nogra flow,
  use `/nogra:help`.

If no route matches, stay direct.

## Five-Anchor Binding

- Risk intake facts belong in `.nogra/index/risk-intake.md`; use `/nogra:adapt`
  for workspace discovery and `/nogra:brief` for action contracts.
- Behavior grading belongs in `.nogra/index/behavior-score.md`; use
  `/nogra:verify` for evidence checks and `/nogra:status` for ledger summaries.
- Connections and action-risk facts belong in
  `.nogra/index/risk-registry.md`; use `/nogra:adapt` to discover and
  `/nogra:brief` to convert them into scope and stop criteria.
- Durable decisions belong in `.nogra/state/DECISIONS.md`; link material
  decisions to briefs, runs or evidence.
- Expansion guidance belongs in `.nogra/index/EXPANSIONS.md`; use `/nogra:help`
  or `/nogra:create` when a repeated need deserves a new Nogra surface.

## Direct By Default

These stay direct unless the user explicitly pulls Nogra:

- ordinary Q&A;
- small edits and content tweaks;
- normal scoped implementation;
- UI work, refactors, bug fixes and feature work;
- routine command/test/debug help;
- direct work where the user rejects Nogra or asks for no ceremony.

## Earned Nudge

For unusually large autonomous work where the user has not asked for Nogra, one
short non-blocking nudge is allowed before the run starts:

```text
This is large enough that a Nogra brief would help. Want me to shape it first?
```

Rules:

- Use this only at the autonomy or cost threshold, not for normal prompts.
- Never repeat it in the same task after the user continues direct.
- Never block on it.
- Never turn it into prompt scoring, keyword scoring or a safety classifier.
- Claude Code's native permission model remains responsible for tool
  permissions.
- The separate convergence guard may ask at deterministic git/action risk
  boundaries, or add a match-review note for read-only public fetches and
  receipt-matched actions. That is not router behavior, must not send
  `permissionDecision: allow`, and must not be rebuilt as prompt scoring.

## Placement

- Hooks keep lifecycle and workspace state visible.
- Skills own setup, adaptation, brief, dispatch, verification, settings, status
  and update flows.
- Runtime code owns deterministic local records, validation, receipts and
  handoff payloads.
- The router only chooses the relevant skill/context from accepted user intent.
