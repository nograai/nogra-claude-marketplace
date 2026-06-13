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

When setting up a folder, use the `nogra-setup` skill.

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
- Nogra is pull-first. Ordinary direct work stays direct unless the user asks
  for the Nogra workflow.
- Pull-first does not mean no plugin code ever runs. In initialized
  workspaces, local lifecycle and convergence hooks may run at session or
  permanent-risk boundaries. They should stay silent for ordinary work, keep
  their records local under `.nogra/`, and never score prompts or replace
  Claude Code permissions.
- A thin intent router maps explicit user intent to the matching `nogra-*`
  skill. If no Nogra route matches, stay direct.
- Nogra calls are authority gates, not ambient polling. Do not call Nogra just
  because a session started or ordinary chat is happening.
- For irreversible or externally expensive work, use Claude Code's native
  permission model and current-task judgment. The local runtime has a
  narrow deterministic git/action convergence gate: it asks when a
  permanent-risk tool call has no current dispatch receipt. It does not score
  prompts or replace provider permissions.
- Language handling is English-first. `defaultLanguage` defaults to `en`.
  `translationFallback: claude-current-prompt` means Claude may use its own
  current-prompt understanding directly.
- Runtime preferences are local workspace policy. Detailed runtime behavior
  lives in `references/runtime.md`.

Detailed router behavior lives in `references/router.md`. Detailed routing
configuration lives in `references/routing.md`. Detailed runtime and
status/version configuration lives in `references/runtime.md`.
The local five-anchor truth surfaces are described in `references/index.md`.

## Off and Uninstall

If the user asks how to turn Nogra off, separate workspace state from the
installed Claude Code plugin.

Workspace off: remove or rename the folder-local `.nogra/` directory. That
turns off Nogra's workspace state, ledger, routing and convergence checks for
that project, but it does not uninstall the plugin from the machine.

Plugin off: use Claude Code's plugin manager. Tell the user to run `/plugin`,
open the Installed tab, choose Nogra, then Disable or Uninstall. CLI is also
valid when the user wants it:

```bash
claude plugin disable <plugin-id>
claude plugin uninstall <plugin-id>
```

Use the exact plugin id shown by `/plugin` or `claude plugin list`. After
disabling or uninstalling during an active session, run `/reload-plugins` or
restart Claude Code before trusting the loaded plugin state.

Do not direct users to edit `settings.json` by hand as the primary path.
Plugin scope can be user, project or local, and Claude Code's plugin manager
owns that state.

## Routing Policy

Use routing only for explicit Nogra intent. If the user asks for Nogra, use the
relevant Nogra flow; if the user asks for direct/simple/no-ceremony work, stay
direct.

The router is:

- brief intent -> `/nogra:brief`;
- approved GO after a reviewed brief -> `/nogra:dispatch`;
- "is this done?", evidence or verification intent -> `/nogra:verify`;
- Nogra ledger/state/checkpoint/version intent -> `/nogra:status`;
- setup/adapt/create/settings/update/help intent -> the matching `nogra-*` skill;
- no matching Nogra intent -> direct work.

The companion index is:

- risk intake -> `.nogra/index/risk-intake.md`;
- behavior score -> `.nogra/index/behavior-score.md`;
- connections/risk registry -> `.nogra/index/risk-registry.md`;
- decision shape -> `.nogra/state/DECISIONS.md`;
- expansion guidance -> `.nogra/index/EXPANSIONS.md`.

For unusually large autonomous work, Claude may give one short non-blocking
brief nudge before the run starts. Do not repeat it, do not block on it, and do
not turn it into prompt scoring.

Detailed routing and language defaults live in `references/routing.md`.
Runtime calls, dispatch, verification and subagents start from accepted user
intent.

## Commands

- `/nogra:setup`: enable the current folder for Nogra.
- `/nogra:create <name>`: create a new project under
  `projects/<workspaceId>/` from a workspace hub.
- `/nogra:adapt`: teach Nogra an existing project by writing a local project
  map under `.nogra/` while app files stay unchanged.
- `/nogra:brief`: write and lock scoped work into a Nogra brief.
- `/nogra:dispatch`: run an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:update`: check installed plugin-local contract/guidance on demand.
- `/nogra:settings`: show or update Nogra profile, role models, effort,
  and language.
- `/nogra:status`: show installed plugin ref, workspace release version,
  local ledger/state, language/runtime state and recent local records.
- `/nogra:help`: explain Nogra and choose the right flow.

## Normal Workflow

1. Turn work into a brief when the user pulls Nogra with `/nogra:brief`, asks
   for a Nogra workflow, or explicitly wants a brief.
2. Before drafting the brief, make a coarse decomposition call from scope,
   coupling and likely runtime. Draft only the selected phase/run, then preview
   size before saving/promoting. Split, reduce or ask before approval when that
   phase is still too large for a normal single run. Do not put `maxTurns` in the
   brief.
3. Make the user approve the brief before dispatch.
4. Dispatch approved work with a scoped run and a clean execution crossing.
5. Package evidence before calling work complete.
6. For a normal single-run, compare the returned evidence against the approved
   brief and return a concise verification with remaining risk.
7. Use a separate verifier only for noisy log/test checks, explicit
   independent verification or larger multi-agent flows.

If the user asks whether work is actually done, use `/nogra:verify` or the
`nogra-verify` skill. Verification can check a Nogra-dispatched run or ordinary Claude
work after the fact, as long as there is a claim, scope and evidence to compare.

Use `/nogra:update` only when the user asks to inspect installed Nogra guidance,
when a contract/template cache is stale, or when validation suggests Claude is
using outdated guidance.

## Demo Requests

If the user asks for a demo, do not reuse a canned demo. Suggest 2-3 bounded
demo ideas that fit the current folder and what the user seems to care about.
Recommend one. If the user chooses an idea, stay direct unless they ask for
Nogra. If the user accepts Nogra, use `/nogra:brief` to write the brief. Do not
dispatch until the user says GO.

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

When the user gives explicit GO on an approved brief, use the `nogra-dispatch` skill.
Do not implement the approved scope in the main chat.

The clean crossing is:

1. Get a local dispatch receipt/run id for the approved brief.
2. Persist local `.nogra/transport/` records through the local runtime
   or local ledger helper.
3. Inspect `executionSizing`; concrete `executionMaxTurns` is chosen here, after
   approval. When it requires a Manager decision, split, override with operator
   approval or ask before spawning.
4. Fetch the local `handoff-contract --kind executor --run-id <runId>`.
5. Spawn with the Claude Code `Agent` primitive into the plugin-provided
   `executor` subagent role with the executor role contract, full brief, run id,
   scope, stop criteria and required evidence. Include prior findings directly,
   with attribution and verification status, when they matter; spawned agents do
   not inherit parent chat context.
   The local runtime resolves executor model/effort from runtime policy or the
   release default and carries dispatch-derived `maxTurns` from the run receipt
   instead of relying on role frontmatter.
6. Wait for the executor report, then compare evidence against the brief.
7. Use the plugin-provided `verifier` only when independent verification
   is explicitly needed or the evidence surface is noisy.

If the dispatch receipt, handoff contract, Claude Code `Agent` primitive,
`executor` role primitive, or required `verifier` primitive is unavailable, stop
and say what is missing. Do not offer inline Manager execution, synchronous
fallback or a generic bypass. The user may explicitly override outside Nogra,
but Manager must not propose the bypass.

Never claim the Manager chat is the agent. The plugin workflow provides Nogra
behavior while Manager and Executor remain separate roles. The final report
title is `Nogra Verification`.
