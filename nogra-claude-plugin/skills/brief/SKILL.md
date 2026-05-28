---
name: brief
description: Only use after /nogra:brief, an explicit request to write a Nogra brief, acceptance of a Nogra offer, or "do this through Nogra". Keep provider requests, research lists, customer research, casual Nogra mentions, and ordinary tasks outside this skill.
---

# Nogra Brief

Use this skill to turn an accepted Nogra intent into a brief. The brief is the
agreement that execution and verification will later be checked against.

Nogra invites; it does not enforce. Offer this flow when work has scope, stakes,
ambiguity or verification risk. If the user chooses direct work, respect that
choice.

Nogra calls are authority gates, not ambient polling. This skill may call Nogra
only after the user accepts the brief flow or explicitly asks for `/nogra:brief`.
If the user has not accepted the brief flow, stop and use the local Nogra offer
gate instead.

## Entry Condition

Continue in this skill only if one of these is true:

- the user invoked `/nogra:brief`
- the user explicitly asked to write, draft or prepare a Nogra brief
- the user accepted a prior Nogra brief/direct offer
- the user said to do the work through Nogra

If the user asks a named provider, external assistant, or extension plugin to
answer or produce something, treat that as separate from a Nogra brief request.
Keep it outside the Nogra flow unless the user explicitly asks to turn it into
a Nogra brief.

If none of these are true, do not call the Nogra runtime and do not draft a
brief. Make the brief/direct offer yourself, then stop.

## Routing Gate

This section is a guardrail for accidental invocation. When the user has not
explicitly asked for Nogra, decide locally whether to offer a brief before any
Nogra runtime call. Use the current hook context plus
`skills/help/references/routing.md` as the routing authority; do not duplicate
score tables or create a second threshold system in this skill.

For topic-related workspace work with enough scope, risk, ambiguity or
verification need, make the brief/direct offer and stop. For pure chat, Q&A,
explicit direct/simple work or low-risk edits, stay direct.

The score never authorizes a Nogra runtime call, dispatch, verification, or
subagent. It
only decides whether to make the local offer.

Use the existing score and its signals as the canonical sensitivity source. Do
not create a second score, tier table, threshold table or automatic
high/medium/low routing rule. Surface the sensitivity, signals, task character
and any runtime-policy mismatch as advisory facts; the Manager phase chooses
evidence depth, routing and verification confidence.

## Trigger

Use this skill when the user:

- asks to write, create, draft or prepare a Nogra brief
- accepts a Nogra brief/direct offer
- wants evidence, verification, a receipt, a run id or a verification
- says "let's do this through Nogra" or equivalent

Do not use this skill directly for generic build, refactor, debug or change
requests. If this skill is invoked accidentally before acceptance, offer the
brief first instead of silently entering ceremony:

```text
This has enough scope that a Nogra brief would help. I can write the brief
first, or work directly if you prefer.
```

If the routing context clearly calls for a stronger recommendation, use a
stronger but still optional offer:

```text
This is scoped enough that I recommend a Nogra brief before work starts. I can
write the brief first, or work directly if you prefer.
```

After either offer, stop and wait. Do not say "I'll write the brief" and do not
call the Nogra runtime until the user accepts the brief flow. If the user
chooses direct work, do not call Nogra.

Do not use this skill for:

- tiny typo fixes or obvious one-line edits
- pure explanation or codebase Q&A
- direct work where the user clearly rejects Nogra flow
- already-approved execution; use `dispatch` after a brief exists and GO is
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

1. If the user did not explicitly request Nogra, apply the Routing Gate before
   any Nogra runtime call.
   - If the score is below threshold, work directly.
   - If the score reaches threshold, show the offer and stop.
   - Continue only after the user accepts the brief flow.
2. Confirm the user's intended outcome in plain language.
3. Apply workspace root discipline before calling the runtime. If the target
   workspace is ambiguous, ask one location question before saving a brief.
4. Inspect enough project context to avoid guessing. Prefer existing docs,
   relevant files, recent decisions and current structure over assumptions.
   Use `skills/help/references/runtime.md` for runtime-policy meaning. Capture
   only the default/custom profile and any custom executor/verifier values that
   materially affect the brief. If brief shape and runtime capacity look
   mismatched, name the mismatch as a fact instead of inventing a new tier or
   runtime rule.
5. If a missing decision would materially change scope, ask one concrete
   question. Ask one question at a time.
6. If there are multiple viable routes, present 2-3 approaches with trade-offs
   and a recommendation. Keep it short enough for the user to choose.
7. Phrase environment-dependent stop criteria as pre-flight checks, not
   reactive failure handling. If the work depends on a tool, runtime,
   credential or service, write the check as the executor's first action and
   forbid recovery improvisation unless the user explicitly wants setup work.
   Example: `First action: run which pnpm. If not found, status: blocked,
   reason: pnpm missing. Do not install pnpm or scaffold partial files.` Avoid
   reactive phrasing such as `If pnpm fails during work, stop`, because it
   invites the executor to spend run budget on workaround attempts before
   stopping.
8. Read the plugin-local registry/status once for this brief flow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" registry --root "$PWD" --json
```

   Use the local runtime path below for the default brief flow.
9. Read the local brief contract before drafting unless a fresh contract was
   already fetched in this same brief flow:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-contract --root "$PWD" --json
```

   Do not discover the schema by repeated validation failures.
10. Draft a complete brief payload from the contract. Use
   `references/brief-contract.md` for shape guidance:
   - `title`
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
11. Validate once with the local runtime when the draft is ready to become an
   artifact:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-validate --root "$PWD" --json
```

   Pass the structured brief payload on stdin or with `--input`.
12. If validation fails after using the contract, stop and report the mismatch or
   missing decision. Do not keep mutating blindly.
13. Save the brief with the local runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-save --root "$PWD" --json
```

    Pass the structured brief payload on stdin or with `--input`. The local
    runtime writes both the normalized draft JSON and a deterministic ASCII
    overview beside it. The overview is rendered from the same normalized
    payload; it is not a second source of truth.
14. Promote it only when it is ready for user approval:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-promote --root "$PWD" --brief-id "<briefId>" --json
```

    The local runtime writes only under `.nogra/briefs/` and uses bundled
    `brief-v1.schema.json`.
15. Do not manually repair local runtime writes by hand-writing `.nogra/`
    artifacts after a runtime error. Stop and surface the failure instead.
16. Present the brief to the user in a compact summary plus the saved brief id.
17. Ask for explicit GO before execution. If the user approves, use the
    `dispatch` skill. Do not continue into implementation inside this skill.

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
  that work.
- Keep execution shape deliberate. Large or multi-purpose work should decompose
  into bounded briefs or phases; otherwise keep one coherent run. Use
  `references/brief-contract.md` for execution-shape details.
- Keep the brief executable, not bloated. Include rejected paths/no-go areas
  when known, label methodology claims by confidence and evidence level, and
  keep current Manager-phase guardrails out of future executor
  scope unless the user wants them to constrain the later run. Nogra protocol
  records under `.nogra/` remain allowed unless the user explicitly forbids
  Nogra recording its own state. Use Nogra language in user-facing copy; the
  user-facing Nogra object is the brief.

## Handoff Line

When the brief is ready, show only:

- one-line intent
- compact scope in/out
- 3-5 brief-specific success criteria
- only non-obvious stop criteria
- brief id and GO line

Always present the brief as a compact approval artifact, not as raw markdown or
JSON. Use `references/approval-display.md` as a visual guide, not a rigid
template.
The brief should usually expose this information:

- title/path or brief id
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

End with:

```text
Brief is ready: <briefId>. Review it, and say GO if you want me to dispatch it through Nogra.
```
