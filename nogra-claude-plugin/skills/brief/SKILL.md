---
name: nogra-brief
description: Shape scoped, risky, or ambiguous work into a validated Nogra brief (an approved plan) before execution. Use after /nogra:brief or when the user explicitly asks for a Nogra brief/workflow — not for casual mentions or ordinary direct work.
---

# Nogra Brief

Use this skill to turn an accepted Nogra intent into a brief. The brief is the
agreement that execution and verification will later be checked against.

Nogra is pull-first. Use this flow when the user asks for Nogra, asks for a
brief, or says to do the work through Nogra. If the user chooses direct work,
respect that choice.

Nogra calls are authority gates, not ambient polling. This skill may call Nogra
only after the user explicitly asks for `/nogra:brief`, a Nogra brief, or the
Nogra workflow.

Read `references/gotchas.md` when intent is ambiguous, another provider or
plugin is named, the target workspace is unclear, or the user is deciding
between direct work and Nogra-managed work.

## Entry Condition

Continue in this skill only if one of these is true:

- the user invoked `/nogra:brief`
- the user explicitly asked to write, draft or prepare a Nogra brief
- the user said to do the work through Nogra

If the user asks a named provider, external assistant, or extension plugin to
answer or produce something, treat that as separate from a Nogra brief request.
Keep it outside the Nogra flow unless the user explicitly asks to turn it into
a Nogra brief.

If none of these are true, do not call the Nogra runtime and do not draft a
brief. Return to direct work.

## Routing Gate

This section is a guardrail for accidental invocation. Nogra core does not score
prompts, intercept tool calls, or decide that ordinary work needs a brief.
Accepted user intent starts the brief flow.

For ordinary workspace work, stay direct unless the user asks for Nogra. For
irreversible, production, billing, data, permissions or secrets work, use Claude
Code's native permission model and current-task judgment; do not enter the
Nogra runtime unless the user pulls Nogra.

## Trigger

Use this skill when the user:

- asks to write, create, draft or prepare a Nogra brief
- wants evidence, verification, a receipt, a run id or a verification
- says "let's do this through Nogra" or equivalent

Do not use this skill directly for generic build, refactor, debug or change
requests. If this skill is invoked accidentally before explicit Nogra intent,
stop and continue direct. Do not say "I'll write the brief" and do not call the
Nogra runtime until the user pulls the brief flow.

Do not use this skill for:

- tiny typo fixes or obvious one-line edits
- pure explanation or codebase Q&A
- direct work where the user clearly rejects Nogra flow
- already-approved execution; use `nogra-dispatch` after a brief exists and GO is
  explicit

## Boundary

The skill shapes intent. In the default local runtime, the local runtime
owns the brief contract from bundled schemas. Manager writes and validates the
brief. The user gives GO. Executor implements later.

Workspace root discipline is part of the boundary. A brief written from this
workspace should clearly say what workspace it governs. If the intended work
targets another workspace, ask one location question or suggest starting Claude
there and running `/nogra:setup`; do not silently use the current `.nogra/`
state as if it governed the other folder. If the user explicitly wants this
workspace to plan or hand off external work, keep that distinction visible in
the brief.

Do not implement, scaffold, run changing commands, spawn execution agents or
call dispatch from this skill. A brief is not GO.

## Flow

Claude Code Bash-safe command style: use one simple command per Bash tool call
with absolute paths. Do not use `$PWD`, `&&`, heredocs or root assignments in
Bash tool calls. When passing a structured brief payload,
write it with `Write` to a workspace-local temp file under `.nogra/` first,
then pass `--input <path>`. Remove that temp file after the runtime call if it
was only a transient input. Replace `<absolute-workspace-root>` below with the
confirmed absolute path of the workspace.

1. Confirm the user's intended outcome in plain language.
2. Apply workspace root discipline before calling the runtime. If the target
   workspace is ambiguous, ask one location question before saving a brief.
3. Inspect enough project context to avoid guessing. Prefer existing docs,
   relevant files, recent decisions, current structure,
   `.nogra/index/risk-intake.md` and `.nogra/index/risk-registry.md` over
   assumptions when those files exist.
   Use `skills/help/references/runtime.md` for runtime-policy meaning. Capture
   only the default/custom profile and any custom executor/verifier values that
   materially affect the brief. If brief shape and runtime capacity look
   mismatched, name the mismatch as a fact instead of inventing a new tier or
   runtime rule.
4. If a missing decision would materially change scope, ask one concrete
   question. Ask one question at a time. Use the local risk intake shape to keep
   questions bounded: outcome, GO, irreversible actions, evidence, allowed
   systems or recurring drift. Do not run a generic open-ended interview inside
   the brief flow.
5. If there are multiple viable routes, present 2-3 approaches with trade-offs
   and a recommendation. Keep it short enough for the user to choose.
6. Phrase environment-dependent stop criteria as pre-flight checks, not
   reactive failure handling. If the work depends on a tool, runtime,
   credential or service, write the check as the executor's first action and
   forbid recovery improvisation unless the user explicitly wants setup work.
   When a dangerous route is foreseeable but a safe route is known, include both:
   block the dangerous route and require the executor to return the safe
   continuation if that block is triggered.
   Example: `First action: run which pnpm. If not found, status: blocked,
   reason: pnpm missing. Do not install pnpm or scaffold partial files.` Avoid
   reactive phrasing such as `If pnpm fails during work, stop`, because it
   invites the executor to spend run budget on workaround attempts before
   stopping.
7. Read the plugin-local registry/status once for this brief flow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" registry --root "<absolute-workspace-root>" --json
```

   Use the local runtime path below for the default brief flow.
8. Read the local brief contract before drafting unless a fresh contract was
   already fetched in this same brief flow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-contract --root "<absolute-workspace-root>" --json
```

   Do not discover the schema by repeated validation failures.
9. Before writing a full brief payload, make a Manager-internal decomposition
   check from the user request, known repo context, expected files/areas,
   coupling and runtime risk. If the work naturally splits, or is likely to sit
   near/over a normal executor run, choose or ask for the phase boundary before
   drafting. Do not spend tokens writing an all-in brief and then split it after
   the preview trips.
10. Draft a complete brief payload for the selected phase/run from the contract.
   Use
   `references/brief-contract.md` for shape guidance:
   - `title`
   - `owner: "Manager"` because Manager owns the brief contract.
   - `nextOwner` as the scoped role expected to act after approval, normally
     `nogra:executor`.
   - `intent`
   - `contextHandoff`
   - `scope.in`, `scope.out` and `scope.files` when known
   - `successCriteria`
   - `stopCriteria`
   - `evidenceRequired`
   - optional `executionShape` only when the approved work materially needs a
     non-default evidence/tool shape.
   - `target` and `targetModel` when routing matters. Prefer local custom
     `runtimePolicy.roles.executor.model` when present; otherwise use the local
     runtime default.
   - `maxOutput` from workspace return policy unless the user asks otherwise
11. Preview brief size and decomposition pressure for the selected phase before
   saving/promoting the approval artifact:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-sizing-preview --root "<absolute-workspace-root>" --input ".nogra/tmp-brief-input.json" --json
```

   Pass the complete structured brief payload on stdin or with `--input`. This
   is a sanity check on the already selected phase, not the first decomposition
   pass. If you already split the user's intent into phases in this same brief
   flow, pass `operatorDecomposed: true` with the preview input so the advisory
   gate does not ask again on the follow-up phase. Do not persist
   `operatorDecomposed` into the saved brief.

   Treat `sizingPreview.userSurface` as the chat-surface contract:
   - `silent`: decide and continue without user-facing sizing prose.
   - `inform`: decide the execution shape, record it, and use at most one line
     if the deliverable will land in parts.
   - `ask`: pause before approval only when the preview says the Manager must
     confirm with the user.

   The split decision is Manager-owned by default. Use
   `sizingPreview.splitShapeHint` to choose linked versus parallel phases and
   escalate to the user only when one of `sizingPreview.escalateToUserIf` holds.
   Do not copy the estimated max turns into the brief; concrete
   `executionMaxTurns` belongs to dispatch.
12. Validate once with the local runtime when the draft is ready to become an
   artifact:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-validate --root "<absolute-workspace-root>" --input ".nogra/tmp-brief-input.json" --json
```

   Pass the structured brief payload on stdin or with `--input`.
13. If validation fails after using the contract, stop and report the mismatch or
   missing decision. Do not keep mutating blindly.
14. Save the brief with the local runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-save --root "<absolute-workspace-root>" --input ".nogra/tmp-brief-input.json" --json
```

    Pass the structured brief payload on stdin or with `--input`. The local
    runtime writes both the normalized draft JSON and a deterministic ASCII
    overview beside it. The overview is rendered from the same normalized
    payload; it is not a second source of truth.
15. Promote it only when it is ready for user approval:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-promote --root "<absolute-workspace-root>" --brief-id "<briefId>" --json
```

    The local runtime writes only under `.nogra/briefs/` and uses bundled
    `brief-v1.schema.json`.
16. Do not manually repair local runtime writes by hand-writing `.nogra/`
    artifacts after a runtime error. Stop and surface the failure instead.
17. Present the brief to the user in a compact summary plus the saved brief id.
18. Ask for explicit GO before execution. If the user approves, use the
    `nogra-dispatch` skill. Do not continue into implementation inside this skill.

## Brief Writing Rules

- Write success criteria as outcomes or observable artifact behavior that
  evidence can prove. Evidence-collection chores such as opening a file,
  showing a page or taking a screenshot belong in evidence notes unless the
  requested deliverable is literally that artifact.
- Choose evidence shape while writing the brief. Prefer native checks when they
  can prove the claim: file inspection, grep/search, diffs, shell commands,
  existing repo tests, artifact content and human confirmation. UI-heavy briefs
  may add interaction/state/design-language evidence; screenshots, browser
  checks, rendered-output inspection, local HTTP serving and console/network
  inspection are optional adapter evidence when the user/request needs them.
  The brief is the authority for evidence shape; executor mirrors the brief
  rather than adding its own meta-preference.
- Prefer goal-prescriptive briefs over implementation-prescriptive briefs when
  both are viable. Require a first action to read local project guidance
  (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, lint/config notes) when stale
  framework assumptions could affect the result. When an existing file is the
  design/copy contract, name it as the canonical source and extract only stable
  helper values such as color tokens or named constants.
- Make stop criteria real and early. Scope, credential, production, payment,
  irreversible-action, tunnel/live-preview and missing-access assumptions should
  be first-turn checks when the work depends on them. During-work guards should
  use exact exit/status language such as `exits non-zero`; setup, recovery or
  partial-scaffold fallback belongs in scope only when the user explicitly wants
  that work. If a stop criterion blocks one unsafe path and the safe path is
  already known, require the executor to return `Safe Continuation` with the
  specific next route instead of only returning the blocker.
- Keep execution shape deliberate. Make the primary decomposition call before
  writing the brief proposal; use the draft sizing preview only as a sanity check
  on the selected phase before saving/promoting. Large, near-ceiling or
  multi-purpose work should decompose into bounded briefs or phases unless the
  operator intentionally approves one bounded run. The preview is not a
  maxTurns authority. Use `references/brief-contract.md` for execution-shape
  details.
- Keep the brief executable, not bloated. Include rejected paths/no-go areas
  when known, label methodology claims by confidence and evidence level, and
  keep current Manager-phase guardrails out of future executor
  scope unless the user wants them to constrain the later run. Nogra protocol
  records under `.nogra/` remain allowed unless the user explicitly forbids
  Nogra recording its own state. Use Nogra language in user-facing copy; the
  user-facing Nogra object is the brief.

## Handoff Line

When the brief is ready, present a **compact approval artifact** — never raw
markdown or JSON. Use `references/approval-display.md` as a visual guide, not a
rigid template.

The minimum floor (never omit these):

- one-line intent
- compact scope in/out
- 3-5 brief-specific success criteria
- non-obvious stop criteria
- brief id, `Open brief` link and GO line

For richer briefs, draw from this structural inventory and omit any section that
would be empty (but never omit scope / stop / GO):

- title, `Open brief` link or brief id
- goal
- execution flow
- phases
- files in scope with NEW/EDIT labels
- out of scope
- stop criteria
- user actions
- success criteria
- return contract

Keep whitespace and grouping intentional so scope, no-go areas and GO/STOP
moments are easy to scan. The approval display is a decision surface; it should
be shorter than the full brief and omit raw runtime payloads, handoff prompts
and transport internals.

Do not print raw runtime payloads, full schema contracts, demo briefs, handoff
prompts or transport receipts unless the user explicitly asks for debug output.
The full normalized brief and its rendered overview live in `.nogra/briefs/`;
the chat shows the compact approval artifact, never the full brief body or
payload echoed a second time.

Use the promoted runtime payload's `openBriefLink` as the primary file
affordance when available. It must render as a bare Markdown link with the
English-first label `Open brief`:

```md
[Open brief](file:///absolute/path/to/brief.md)
```

Do not wrap the link in backticks. Do not append `:1` or any line number to a
`file://` URL. Build `file://` values from the runtime payload or an equivalent
URL encoder; do not hand-write unencoded paths with spaces or special
characters. The storage mechanism is a local markdown file, but the user-facing
artifact name remains "brief", not "file".

End with:

```text
Brief is ready: <briefId>. [Open brief](file:///absolute/path/to/brief.md). Review it, and say GO if you want me to dispatch it through Nogra.
```
