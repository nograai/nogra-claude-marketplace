# Nogra Five-Anchor Index

This index binds Nogra's routing logic to the local workspace records that keep
intent, action and verification converged. It is original Nogra product
guidance. Do not import third-party framework names, folder layouts or scoring
rubrics into this surface.

The thin router chooses the skill. The five anchors explain why the skill is
being used, when its local record matters, and how Manager should keep the
record current.

This historical "five-anchor index" label describes five guidance surfaces.
It is distinct from the canonical continuity record created by
`/nogra:anchor` (`nogra.anchor.v1`). The index guides; an Anchor preserves
factual cross-session state.

## 1. Risk Intake

Why: risk appears when Claude acts on an interpreted intent instead of the
operator's current intent.

When: before adapting a real workspace, writing a brief, dispatching work that
can touch history or external systems, or investigating a drift incident.

How: collect only the facts needed to keep action bounded:

- current outcome;
- explicit GO shape;
- irreversible or expensive actions;
- acceptable evidence;
- allowed and forbidden systems;
- known recurring drift pattern;
- what future sessions must remember.

Route: `/nogra:adapt` records workspace facts; `/nogra:brief` turns action into
a scoped contract.

Local record: `.nogra/index/risk-intake.md`.

## 2. Behavior Score

Why: Nogra must measure behavior, not folder completeness.

When: after scenario grading, release rehearsal, drift probes, post-compact
checks or any run where the operator asks whether Nogra held the line.

How: score concrete scenarios by cluster and mode. A result is useful only when
it includes the prompt/scenario, expected guard, observed behavior, evidence
path and verdict.

This record is populated only by a deliberate scenario-grading exercise. Hooks,
ordinary prompts and transcript diagnostics never write or update it.

Modes: `fresh`, `long-session`, `post-compact`, `git-risk`.

Drift clusters: A speed-before-intent, B fabricated-grounding, C provenance,
D contract/boundary, E explicit-GO, F manufactured-friction, G bad-evidence,
H answer-the-ask.

Route: `/nogra:verify` checks evidence; `/nogra:status` summarizes the latest
ledger/state score if the record exists.

Local record: `.nogra/index/behavior-score.md`.

## 3. Connections And Risk Registry

Why: Claude needs to know what the workspace may read, write, deploy, send,
migrate, bill or never touch before action becomes permanent.

When: setup/adapt for a workspace, before briefs that touch external systems,
and before dispatching work near production, data, permissions, customer
messages, billing, secrets or git history.

How: keep capability facts separate from secrets. Record the system, mechanism,
allowed read/write posture, risk boundary, evidence source and last checked
date. Never store credentials in the registry.

Route: `/nogra:adapt` discovers the registry; `/nogra:brief` uses it for scope
and stop criteria; `PreToolUse` enforces only deterministic git/action risk.

Local record: `.nogra/index/risk-registry.md`.

## 4. Decision Shape

Why: a decision without reason, owner and linked evidence becomes drift-prone
memory instead of durable state.

When: after setup defaults, adapt discoveries, brief approvals, dispatch sizing
choices, verification deviations and operator decisions.

How: use this shape:

- Decision;
- Why;
- Alternatives considered;
- Owner;
- Linked brief/run/evidence;
- Date.

Route: `/nogra:adapt` records known project decisions; `/nogra:brief`,
`/nogra:dispatch` and `/nogra:verify` link decisions to artifacts when the
operator makes a material choice.

Local record: `.nogra/state/DECISIONS.md`.

## 5. Nogra Expansions

Why: Nogra should grow from repeated need, not from folder theater.

When: the operator repeatedly uses the same brief pattern, verifier, project
hub, scenario pack, evidence adapter or risk registry shape.

How: add one surface only when it has a clear owner, route, evidence contract
and expected reuse. If the same need is not recurring, keep it in the current
brief/run evidence instead of creating a new lane.

Route: `/nogra:help` explains the option; `/nogra:create` creates project hubs;
specialized graders and scenario packs stay explicit, not ambient.

Local record: `.nogra/index/EXPANSIONS.md`.

## Router Binding

Use `references/router.md` for skill selection. Use this index to keep the
selected skill grounded in Nogra's five local truth surfaces.

If no route matches, stay direct. If a deterministic git/action risk boundary
has no current dispatch receipt, `PreToolUse` may ask for confirmation; that is
the convergence gate, not prompt scoring. When an action is matched to the
current receipt, or is a conservative read-only public fetch, `PreToolUse` may
emit a match-review note without changing Claude Code permissions.
