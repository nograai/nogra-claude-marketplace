# Nogra Help

Nogra is a brief-first workflow for Claude Code. It keeps work explicit:
brief, approval, dispatch, evidence and verification.

## First Use

If the current folder is not Nogra-enabled yet, tell the user:

```text
Open Claude Code in the project folder and run /nogra:setup, or ask Claude to help you set up Nogra.
```

If the plugin was installed or updated during an already-running Claude Code
session, tell the user to restart or reopen Claude Code before running
`/nogra:setup`.

Natural language is also fine:

```text
Can you help me set up Nogra in this folder?
```

When setting up a folder, use the `setup` skill.

If the user asks whether Nogra can be installed without overwriting existing
files, say yes and offer to walk through the exact file plan before writing.
`/nogra:setup` writes `.nogra/` workspace state and creates root `CLAUDE.md`
only when it is missing. It preserves app files, existing root `CLAUDE.md`,
`.claude/`, package files, git config, hooks, presets and templates.

For an existing project, use `/nogra:adapt` after setup. Adapt reads the
workspace and writes Nogra project notes under `.nogra/`, leaving app files
unchanged.

For a workspace that should manage several projects, run `/nogra:setup` in the
hub folder, then use `/nogra:create <name>` to create
`projects/<workspaceId>/` with its own project-local `.nogra/`.

## Operating Model

- The Nogra plugin provides skills, bundled contracts and a local runtime.
- The default runtime uses bundled contracts, validation, dispatch receipts and
  `.nogra/` records in the workspace.
- The workspace owns `.nogra/` records as its local trust source.
- Nogra offers a workflow by invitation. Ordinary direct work stays direct
  unless the user asks for the Nogra workflow.
- Nogra calls are authority gates, not ambient polling. Do not call Nogra just
  because a session started or ordinary chat is happening.
- Claude may locally recognize that scoped, risky or ambiguous work deserves a
  Nogra offer from the current prompt and local config. That offer is not a
  runtime action. Enter the Nogra runtime only if the user accepts the brief
  flow or explicitly runs a Nogra command.
- Automatic routing scores only the current prompt and workspace config.
- Offer sensitivity is local workspace policy. Read `.nogra/config.json`
  `routingPolicy` when available; default to `sensitivityPercent: 50`,
  `sensitivityStepPercent: 5`, effective thresholds `60/80`, and
  `offerOncePerIntent: true`.
- Language handling is English-first. `defaultLanguage` defaults to `en`.
  `translationFallback: claude-current-prompt` means Claude may use its own
  current-prompt understanding directly.
- Runtime preferences are local workspace policy. Detailed runtime behavior
  lives in `references/runtime.md`.

Detailed routing configuration lives in `references/routing.md`. Detailed
runtime and status/version configuration lives in `references/runtime.md`.

## Routing Policy

Use routing only for topic-related workspace work. Explicit user intent wins:
if the user asks for Nogra, use the relevant Nogra flow; if the user asks for
direct/simple/no-ceremony work, stay direct.

Detailed thresholds, score signals, sensitivity mechanics and judgment-fallback
behavior live in `references/routing.md`. Do not duplicate that score table in
other skill bodies. The score creates an offer only; runtime calls, dispatch,
verification and subagents start from accepted user intent.

## Commands

- `/nogra:setup`: enable the current folder for Nogra.
- `/nogra:create <name>`: create a new project under
  `projects/<workspaceId>/` from a Manager hub.
- `/nogra:adapt`: teach Nogra an existing project by writing a local project
  map under `.nogra/` while app files stay unchanged.
- `/nogra:brief`: write and lock scoped work into a Nogra brief.
- `/nogra:dispatch`: run an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:update`: check installed plugin-local contract/guidance on demand.
- `/nogra:sensitivity`: set automatic Nogra offer sensitivity as a percentage.
- `/nogra:settings`: show or update Nogra profile, role models, effort,
  language and auto behavior.
- `/nogra:status`: show installed plugin ref, workspace release version,
  routing state and recent local records.
- `/nogra:help`: explain Nogra and choose the right flow.

## Normal Workflow

1. Turn ambiguous work into a brief when scope, risk or ambiguity warrants it.
   Use `/nogra:brief`, or ask Claude to write a Nogra brief for the work.
   If the user did not ask for Nogra, offer the brief/direct choice first and
   stop until the user accepts.
2. Make the user approve the brief before dispatch.
3. Dispatch approved work with a scoped run and a clean execution crossing.
4. Package evidence before calling work complete.
5. For a normal single-run, compare the returned evidence against the approved
   brief and return a concise verification with remaining risk.
6. Use a separate verifier only for noisy log/test checks, explicit
   independent verification or larger multi-agent flows.

If the user asks whether work is actually done, use `/nogra:verify` or the
`verify` skill. Verification can check a Nogra-dispatched run or ordinary Claude
work after the fact, as long as there is a claim, scope and evidence to compare.

Use `/nogra:update` only when the user asks to inspect installed Nogra guidance,
when a contract/template cache is stale, or when validation suggests Claude is
using outdated guidance.

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

Brief approval should default to a compact approval artifact. When a fuller
approval display is useful, make it a visual approval surface: title, goal,
flow, phases, files, out-of-scope, stop criteria, user actions, success criteria
and return contract. Preserve whitespace, group related items and make
scope/no-go/GO/STOP moments easy to scan. Do not paste the raw brief unless the
user asks for it.

Do not print raw runtime payloads, full schema contracts, demo briefs, handoff
prompts or transport receipts unless the user explicitly asks for debug output.
Those records belong in `.nogra/`.

## Dispatch Boundary

When the user gives explicit GO on an approved brief, use the `dispatch` skill.
Do not implement the approved scope in the main chat.

The clean crossing is:

1. Get a local dispatch receipt/run id for the approved brief.
2. Persist local `.nogra/transport/` records through the local runtime
   or local ledger helper.
3. Fetch the local `handoff-contract --kind executor`.
4. Spawn the plugin-provided `executor` subagent with the executor role
   contract, full brief, run id, scope, stop criteria and required evidence.
   The local runtime resolves executor model/effort from runtime policy or the
   release default instead of relying on role frontmatter.
5. Wait for the executor report, then compare evidence against the brief.
6. Use the plugin-provided `verifier` only when independent verification
   is explicitly needed or the evidence surface is noisy.

If the dispatch receipt, handoff contract, `executor` primitive, or required
`verifier` primitive is unavailable, stop and say what is missing. Do not
offer inline Manager execution, synchronous fallback or a generic bypass. The
user may explicitly override outside Nogra, but Manager must not propose the
bypass.

Never claim the Manager chat is the agent. The plugin workflow provides Nogra
behavior while Manager and Executor remain separate roles. The final report
title is `Nogra Verification`.
