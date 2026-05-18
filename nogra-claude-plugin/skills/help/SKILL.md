---
name: help
description: Explain and use Nogra in Claude Code. Use when the user asks what Nogra is, how to start, how to write a brief, how dispatch or evidence works, or says they want Nogra help in a workspace.
---

# Nogra Help

Nogra is a brief-first workflow for Claude Code. It keeps work explicit:
brief, approval, dispatch, evidence and verification.

## First Use

If the current folder is not Nogra-enabled yet, tell the user:

```text
Open Claude Code in the project folder and run /nogra:init, or ask Claude to help you set up Nogra.
```

If the plugin was installed or updated during an already-running Claude Code
session, tell the user to restart or reopen Claude Code before running
`/nogra:init`.

Natural language is also fine:

```text
Can you help me set up Nogra in this folder?
```

When installing in a folder, use the `init` skill.

If the user asks whether Nogra can be installed without overwriting existing
files, say yes and offer to walk through the exact file plan before writing.
In plugin mode, `/nogra:init` writes `.nogra/` workspace state and creates
root `CLAUDE.md` only when it is missing. It does not edit app files, existing
root `CLAUDE.md`, `.claude/`, package files, git config, hooks, presets,
templates or pinboard files.

For an existing project, use `/nogra:adapt` after init. Adapt reads the
workspace and writes only Nogra's local project map under `.nogra/`; it does
not call MCP or change app files.

## Operating Model

- The Nogra plugin provides skills and the MCP connection.
- Hosted Nogra provides current contracts, validation and handoff prompts.
- The workspace owns `.nogra/` records as its local trust source.
- Nogra invites; it does not enforce. Do not push Nogra into ordinary direct
  work unless the user asks for the Nogra workflow.
- Nogra calls are authority gates, not ambient polling. Do not call Nogra just
  because a session started or ordinary chat is happening.
- Claude may locally recognize that scoped, risky or ambiguous work deserves a
  Nogra offer from the current prompt and local config. That offer is not an
  MCP call. Call Nogra only if the user accepts the brief flow or explicitly
  runs a Nogra command.
- Automatic routing does not read Claude transcript/history files.
- Offer sensitivity is local workspace policy. Read `.nogra/config.json`
  `routingPolicy` when available; default to `sensitivityPercent: 50`,
  `sensitivityStepPercent: 5`, effective thresholds `60/80`, and
  `offerOncePerIntent: true`.
- Language handling is English-first plus local dictionary. `defaultLanguage`
  defaults to `en`; `dictionary` can add signal words for Danish or any other
  workspace language. `translationFallback: claude-current-prompt` means Claude
  may use its own current-prompt understanding; it is not an external
  translation call.
- Runtime/spend preferences are local workspace policy. Read
  `.nogra/config.json` `runtimePolicy` when available. `roles.manager` is
  advisory for the active Claude Code main session; use native `/model` and
  `/effort` to actually switch it. `roles.agent` and `roles.verifier` describe
  desired disposable run-agent model/effort when the client/runtime can honor
  them. Interactive plugin-mode budget is advisory unless the runtime supports
  a hard budget flag.

## Routing Policy

Use routing only for topic-related workspace work: building, changing, fixing,
refactoring, deploying, designing, verifying, or deciding something in the
workspace. If the request is not topic-related, do not offer Nogra.

Explicit user intent wins:

- If the user asks for Nogra, a brief, dispatch, verification, or verification, use
  the relevant Nogra flow.
- If the user asks for direct/simple/no-ceremony work, do direct work.
  Sensitivity must not overrule this.

Otherwise calculate a local score:

- +25 build, refactor, debug, or behavior change
- +20 multiple files or unknown blast radius
- +20 needs test, screenshot, diff, browser check, evidence, or verification
- +20 user asks whether work is done or wants a claim checked
- +15 visual, quality-critical, database, auth, payment, deploy, production,
  or security work
- +10 unclear scope, user uncertainty, or hard-to-revert work
- -30 one obvious low-risk file edit
- hard direct override when the user asks for direct/simple/no ceremony
- -50 pure Q&A

If the score reaches the effective auto threshold, offer Nogra once for that
intent and stop. If it reaches the effective strong threshold, recommend Nogra
more firmly and stop. `sensitivityPercent` is the user-facing heat control:
higher values lower thresholds and offer more often; lower values raise
thresholds and stay more direct. Values snap to `sensitivityStepPercent` so the
workspace can tune heat in 5% or 10% increments. Wait for the user to accept
the brief flow before calling MCP or drafting the brief. The score triggers
only an offer, never an MCP call, dispatch, verification, or subagent.

## Commands

- `/nogra:init`: enable the current folder for Nogra.
- `/nogra:adapt`: teach Nogra an existing project by writing a local project
  map under `.nogra/` without changing app files.
- `/nogra:brief`: write and lock scoped work into a Nogra brief.
- `/nogra:dispatch`: run an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:update`: pull current Nogra contract/guidance on demand.
- `/nogra:sensitivity`: set automatic Nogra offer heat as a percentage.
- `/nogra:settings`: show or update Nogra profile, role models, effort,
  advisory budget, language and auto behavior.
- `/nogra:status`: show installed plugin ref, hosted MCP version, workspace
  playbook version, routing state and recent records.
- `/nogra:help`: explain Nogra and choose the right flow.

## Normal Workflow

1. Turn ambiguous work into a brief when scope, risk or ambiguity warrants it.
   Use `/nogra:brief`, or ask Claude to write a Nogra brief for the work.
   If the user did not ask for Nogra, offer the brief/direct choice first and
   stop until the user accepts.
2. Make the user approve the brief before dispatch.
3. Dispatch approved work with a scoped run and a clean execution crossing.
4. Package evidence before calling work complete.
5. For a normal single-run, Manager compares the returned evidence against the
   approved brief and returns a concise verification with remaining risk.
6. Use a separate verifier only for noisy browser/log/test checks, explicit
   independent verification or larger multi-agent flows.

If the user asks whether work is actually done, use `/nogra:verify` or the
`verify` skill. Verification can check a Nogra-dispatched run or ordinary Claude
work after the fact, as long as there is a claim, scope and evidence to compare.

Use `/nogra:update` only when the user asks to refresh Nogra guidance, when a
contract/template cache is stale, or when validation suggests Claude is using
outdated guidance.

## Demo Requests

If the user asks for a demo, do not reuse a canned demo. Suggest 2-3 bounded
demo ideas that fit the current folder and what the user seems to care about.
Recommend one. If the user chooses an idea and it crosses the routing
threshold, offer the brief/direct choice and stop. If the user accepts, use
`/nogra:brief` to write the brief. Do not dispatch until the user says GO.

## Brief Handoff

When presenting a generated brief for user approval, keep chat compact:

- one-line intent;
- compact scope in/out;
- 3-5 brief-specific success criteria;
- only non-obvious stop criteria;
- brief id and GO line.

If the user asks for a pretty print, make it a visual approval surface: title,
goal, flow, phases, files, out-of-scope, stop criteria, user actions, success
criteria and return contract. Preserve whitespace, group related items and make
scope/no-go/GO/STOP moments easy to scan. Do not paste the raw brief unless the
user asks for it.

Do not print raw MCP payloads, full schema contracts, `localWrites`, demo
briefs, handoff prompts or transport receipts unless the user explicitly asks for
debug output. Those records belong in `.nogra/`.

## Dispatch Boundary

When the user gives explicit GO on an approved brief, use the `dispatch` skill.
Do not implement the approved scope in the Manager conversation.

The clean crossing is:

1. Get a hosted dispatch receipt/run id for the approved brief.
2. Apply any `.nogra/` `localWrites` from the receipt with Write/Edit or
   read-then-rewrite, not Bash/shell append.
3. Fetch `handoff_contract(kind: executor)`.
4. Spawn the plugin-provided `executor` subagent with the executor role
   contract, full brief, run id, scope, stop criteria and required evidence.
   The plugin agent template pins the default executor model/effort in
   frontmatter instead of relying only on prompt text.
5. Wait for the executor report, then compare evidence against the brief.
6. Use the plugin-provided `verifier` only when independent verification
   is explicitly needed or the evidence surface is noisy.

If the dispatch receipt, handoff contract, `executor` primitive, or required
`verifier` primitive is unavailable, stop and say what is missing. Do not
offer inline Manager execution, synchronous fallback or a generic bypass. The
user may explicitly override outside Nogra, but Manager must not propose the
bypass.

Never say "in plugin mode, I am the agent." Plugin mode means the plugin
provides Nogra behavior; it does not merge Manager and Executor. The final
report title is `Nogra Verification`; do not use `Verdict` as a Nogra-owned
heading.
