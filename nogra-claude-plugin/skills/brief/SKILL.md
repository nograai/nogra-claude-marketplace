---
name: brief
description: Only use after /nogra:brief, an explicit request to write a Nogra brief, acceptance of a Nogra offer, or "do this through Nogra". Do not use for Codex/provider requests, research lists, customer research, casual Nogra mentions, or ordinary tasks.
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

If the user asks to get Codex, another provider, or an extension plugin to
answer or produce something, this is not a Nogra brief request. Do not route it
through Nogra, and do not offer a Nogra brief solely because the request
mentions Nogra as the product or topic.

If none of these are true, do not call MCP and do not draft a brief. Use the
`nogra:offer` skill or show the brief/direct offer yourself, then stop.

## Routing Gate

This section is a guardrail for accidental invocation. When the user has not
explicitly asked for Nogra, decide locally whether to offer a brief before any
MCP call. Read `.nogra/config.json` `routingPolicy` when available:

- `sensitivityPercent`: user-facing heat control, default 50
- `sensitivityStepPercent`: heat granularity, default 5
- `autoOfferThreshold`: effective score needed to offer Nogra, default 60
- `strongOfferThreshold`: effective score needed to recommend Nogra strongly,
  default 80
- `offerOncePerIntent`: default true

Only score topic-related workspace work: building, changing, fixing,
refactoring, deploying, designing, verifying, or deciding something in this
workspace. If the request is pure chat, explanation, status, or Q&A, do not
offer Nogra.

Score signals:

- +25 build, refactor, debug, or behavior change
- +20 multiple files or unknown blast radius
- +20 needs test, screenshot, diff, browser check, evidence, or verification
- +20 user asks whether work is done or wants a claim checked
- +15 visual, quality-critical, database, auth, payment, deploy, production,
  or security work
- +10 unclear scope, user uncertainty, or hard-to-revert work
- -30 one obvious low-risk file edit
- -40 user asks for direct/simple/no ceremony
- -50 pure Q&A

Higher `sensitivityPercent` lowers effective thresholds and makes Nogra offers
more likely. Lower sensitivity raises thresholds and keeps Claude more direct.
Values snap to `sensitivityStepPercent`, default `5%`. If the score is below
the effective auto threshold, work directly and do not call Nogra. If it
reaches the effective auto threshold, offer the brief/direct choice and stop.
If it reaches the effective strong threshold, recommend Nogra more firmly and
stop. Wait for the user to accept the brief flow before calling MCP or drafting
the brief.

The score never authorizes an MCP call, dispatch, verification, or subagent. It
only decides whether to make the local offer.

## Trigger

Use this skill when the user:

- asks to write, create, draft or prepare a Nogra brief
- accepts a Nogra brief/direct offer
- wants evidence, verification, a receipt, a run id or a verification
- says "let's do this through Nogra" or equivalent

Do not use this skill directly for generic build, refactor, debug or change
requests. Use `nogra:offer` first. If this skill is invoked accidentally before
acceptance, offer the brief first instead of silently entering ceremony:

```text
This has enough scope that a Nogra brief would help. I can write the brief
first, or work directly if you prefer.
```

If the score is at or above the effective strong threshold, use a stronger but
still optional offer:

```text
This is scoped enough that I recommend a Nogra brief before work starts. I can
write the brief first, or work directly if you prefer.
```

After either offer, stop and wait. Do not say "I'll write the brief" and do not
call MCP until the user accepts the brief flow. If the user chooses direct
work, do not call Nogra.

Do not use this skill for:

- tiny typo fixes or obvious one-line edits
- pure explanation or codebase Q&A
- direct work where the user clearly rejects Nogra flow
- already-approved execution; use `dispatch` after a brief exists and GO is
  explicit

## Boundary

The skill shapes intent. The Nogra MCP owns the brief contract. Manager writes
and validates the brief. The user gives GO. Executor implements later.

Do not implement, scaffold, run changing commands, spawn execution agents or
call dispatch from this skill. A brief is not GO.

## Flow

1. If the user did not explicitly request Nogra, apply the Routing Gate before
   any MCP call.
   - If the score is below threshold, work directly.
   - If the score reaches threshold, show the offer and stop.
   - Continue only after the user accepts the brief flow.
2. Confirm the user's intended outcome in plain language.
3. Inspect enough project context to avoid guessing. Prefer existing docs,
   relevant files, recent decisions and current structure over assumptions.
   Read `.nogra/config.json` when present and capture `runtimePolicy`:
   - `runtimePolicy.roles.agent.model` is the default `targetModel` for the
     executor brief unless the user asks for another model.
   - `runtimePolicy.roles.agent.effort`, `context` and `maxTurns` are
     handoff guidance for dispatch/execution, not brief schema fields.
   - `runtimePolicy.roles.manager` is advisory for the active Claude Code main
     session. Do not claim Nogra changed the current `/model` or `/effort`.
   - `runtimePolicy.budget` is advisory in interactive plugin mode.
4. If a missing decision would materially change scope, ask one concrete
   question. Ask one question at a time.
5. If there are multiple viable routes, present 2-3 approaches with trade-offs
   and a recommendation. Keep it short enough for the user to choose.
6. Call `registry` once for this brief flow and verify the active MCP is
   the hosted plugin MCP:
   - `boundary.hostedMode` must be `true`.
   - `status` should be `v1-hosted-validation`.

   If the registry shows local/non-hosted mode, stop. Tell the user the Claude
   Code session is calling a local/private MCP server still registered as
   `nogra` instead of the plugin-managed hosted MCP. `nogra` is reserved for
   hosted/plugin mode; local/private development should use `nogra-dev`.
7. Call `brief_contract` before drafting unless a fresh contract was
   already fetched in this same brief flow. Do not discover the schema by
   repeated validation failures.
8. Draft a complete `nogra.brief.v1` payload from the contract:
   - `title`
   - `intent`
   - `contextHandoff`
   - `scope.in`, `scope.out` and `scope.files` when known
   - `successCriteria`
   - `stopCriteria`
   - `evidenceRequired`
   - optional `executionShape` only when the approved work materially needs a
     non-default tool/runtime shape. Prefer `toolNeeds` evidence/tool need
     declarations such as source review, read-only inspection or screenshot
     evidence. The adapter derives capability families through the toolbank; do
     not write a provider-tool enum or required-tools checklist.
   - `target` and `targetModel` when routing matters. Prefer the local
     `runtimePolicy.roles.agent.model` value when present; otherwise use the
     workspace/MCP default.
   - `maxOutput` from workspace return policy unless the user asks otherwise
9. Validate once with `brief_validate` when the draft is ready to become
   an artifact.
10. If validation fails after using the contract, stop and report the mismatch or
   missing decision. Do not keep mutating blindly.
11. Save the brief with `brief_save`.
12. Promote it only when it is ready for user approval. In hosted/plugin mode,
    promote with the full normalized brief payload, not only a `brief_id`.
    Hosted Nogra is stateless; if promote returns `local_required`, read the
    local `.nogra/briefs/drafts/<briefId>.json` draft and retry promotion with
    that draft as `payload`.
13. Apply any `localWrites` returned by MCP into `.nogra/` after path
    validation. Reject absolute paths, `~`, control characters, `..` escapes
    and any resolved path outside `<workspace>/.nogra/`. Deduplicate JSONL
    appends by idempotency key. Use Claude Code Write/Edit/read-then-rewrite
    for these local writes. Do not use Bash or shell append just to create,
    rewrite or append `.nogra/` artifacts.
14. Present the brief to the user in a compact summary plus the saved brief id.
15. Ask for explicit GO before execution. If the user approves, use the
    `dispatch` skill. Do not continue into implementation inside this skill.

## Brief Writing Rules

- Write success criteria that evidence can prove.
- Write success criteria as desired outcomes or observable artifact behavior,
  not as agent presentation chores. Do not use "open the file", "take a
  screenshot", "show the page", or similar actions as acceptance criteria
  unless the user's requested deliverable is literally that artifact.
- Put screenshots, browser checks, console/network inspection, file opening, or
  rendered-output inspection in the evidence plan or Manager handoff when they
  are needed to prove a visual/interactive criterion. They are evidence
  methods, not success criteria by themselves.
- Make stop criteria real. If scope, credentials, production, payment,
  irreversible action or missing access matters, name the stop.
- Include rejected paths and no-go areas when known.
- Keep the brief executable, not bloated. It should carry enough context for a
  fresh executor subagent without importing the whole conversation.
- Separate idea shaping from approval. A useful idea is not yet an approved run.
- If the work is too large for one brief, decompose it and brief the first
  bounded piece.
- If the work needs research, browser verification, read-only scouting or other
  non-default execution/tool shape, include optional `executionShape` guidance.
  Prefer `toolNeeds` evidence/tool need declarations and let the adapter derive
  toolbank families mechanically. Use explicit `toolFamilies` only as a
  compatibility override, never as a required picker or exhaustive tool list. If
  the default file executor is enough, leave it blank.
- Use Nogra language in user-facing copy. The user-facing Nogra object is the
  brief.
- Do not turn current-phase guardrails into executor scope. If the user says
  "do not dispatch", "do not implement", "just draft the brief", or equivalent
  while asking for `/nogra:brief`, treat that as a Manager-phase instruction
  for this conversation only. Do not write "no dispatch will be performed" or
  "do not implement" into `contextHandoff`, `scope.out`, `rejected` or stop
  criteria unless the user explicitly wants the future executor forbidden from
  doing that work. A promoted brief is normally meant to be dispatchable after
  GO.

## Handoff Line

When the brief is ready, show only:

- one-line intent
- compact scope in/out
- 3-5 brief-specific success criteria
- only non-obvious stop criteria
- brief id and GO line

If the user asks for a pretty print, present the brief as a compact approval
artifact, not as raw markdown or JSON. Use
`references/pretty-print-guide.md` as a visual guide, not a rigid template.
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
moments are easy to scan. Pretty print is a decision surface; it should be
shorter than the full brief and omit MCP payloads, handoff prompts and transport
internals.

Do not print raw MCP payloads, full schema contracts, `localWrites`, demo
briefs, handoff prompts or transport receipts unless the user explicitly asks for
debug output.

End with:

```text
Brief is ready: <briefId>. Review it, and say GO if you want me to dispatch it through Nogra.
```
