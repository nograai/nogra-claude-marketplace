# Nogra Workflow

Approve, run, verify in Claude Code - the work is checked against the plan
before it is marked done.

Nogra is an optional discipline layer for Claude Code. On work with real scope
or risk, it gets you to approve a short plan first, runs the approved work, then
checks the result against that plan - so you don't have to take "done" on trust
when it matters.

## Install

**Requires Node.js 18+ on your PATH** — Nogra's local runtime is a small Node
script. If `node` is not available, setup stops and tells you instead of failing
cryptically.

After installing this plugin:

1. In Claude Code, go to the project folder where you want Nogra active.
2. Restart or reopen Claude Code so the plugin loads.
3. Run `/nogra:setup` — this creates the folder's local Nogra state
   (`.nogra/config.json`, standard `.nogra/` domain folders, plus a root
   `CLAUDE.md` only if you don't already have one).
4. For an existing codebase, also run `/nogra:adapt` so Nogra reads the project
   and records its map under `.nogra/`.

You can also ask Claude:

```text
Can you help me set up Nogra in this folder?
```

The plugin provides three primitives - brief, dispatch, verify - plus a thin
intent router and the local `.nogra/` ledger they write to. The router maps
explicit Nogra intent to the right skill. If no Nogra route matches, ordinary
work stays direct.
Folder-local state is created only when `/nogra:setup` runs.

By default, setup, brief contracts, brief validation, local dispatch receipts and
verification support use bundled plugin contracts plus the workspace `.nogra/`
records. After the plugin has been installed, all workflow stays local
to the workspace.

## Privacy and Support

Nogra runs locally. It collects no data, requires no account, and makes no
network calls. There is nothing to collect, store, or share.

For support, contact `support@nogra.ai`.

## Working Examples

Run these examples in disposable workspaces, not in the Nogra plugin source
repo. They show the two intended paths: choose Nogra before planned work starts,
or stay direct when you mean direct. Nogra is not a cleanup step to insert after
Claude has already started implementing.

### Set up a workspace

Ask Claude:

```text
Can you help me set up Nogra in this folder?
```

Expected behavior: Nogra previews the local files it will create, waits for
explicit GO, then creates `.nogra/` workspace state and a root `CLAUDE.md` only
when missing. Existing app files, `.claude/`, package files, git config and
provider settings are preserved.

### Build through Nogra

Ask Claude:

```text
Use Nogra to brief and run a small local task tracker build.
```

Expected behavior: Nogra shapes a brief first, waits for user approval,
dispatches only after GO, then verifies the result against the brief and
available evidence before calling it done.

### Build directly

Ask Claude:

```text
Build a small local task tracker directly. Do not use Nogra.
```

Expected behavior: Claude works directly. Nogra stays silent: no prompt scoring,
no proactive brief prompt and no workflow just because the task has scope.

### Save a checkpoint

Ask Claude:

```text
Save a checkpoint of what we did, what changed, and what remains.
```

Expected behavior: Nogra records a local continuity checkpoint under `.nogra/`
with the work completed, evidence checked and remaining next steps. No external
account or service is required.

### Check local continuity

Ask Claude:

```text
Show Nogra status for this workspace.
```

Expected behavior: Nogra reports the installed plugin version, the workspace
contract version, routing/runtime state, recent local records and checkpoint
freshness. If the local ledger watermark is ahead of the checkpoint
`SourceWatermark`, the checkpoint is stale and should be refreshed before it is
trusted as the latest state.

### Continue later

Ask Claude:

```text
Continue from the latest Nogra checkpoint if it is fresh. If it is stale, compare
the local ledger watermark with the checkpoint source watermark and tell me what
needs to be refreshed first.
```

Expected behavior: Nogra treats the append-only local ledger as the truth source
and the checkpoint as a human-readable projection. Claude should not invent
memory from chat history or read transcript contents. It should use the local
`.nogra/` records to explain whether the checkpoint is fresh or stale, then ask
what you want to do next.

## Updates

The marketplace publishes versioned plugin packages. To pick up a released
plugin version, run `/plugin update` and `/reload-plugins`, or enable
marketplace auto-update in Claude Code. The plugin metadata declares the package
version for human-readable marketplace surfaces.

If you ask Claude whether Nogra can be installed without overwriting existing
files, Claude should walk through the file plan before writing anything. Setup
writes `.nogra/` workspace state plus a root `CLAUDE.md` only when missing, and
preserves or merges existing Nogra files according to the bundled write policy.

## Skills

- `/nogra:setup`: enable the current folder for Nogra.
- `/nogra:create <name>`: create a project-local Nogra workspace under
  `projects/<workspaceId>/` from a workspace hub.
- `/nogra:adapt`: read an existing project and write Nogra's local project map
  under `.nogra/` without changing app files.
- `/nogra:brief`: shape scoped, risky or ambiguous work into a validated Nogra
  brief before execution.
- `/nogra:dispatch`: dispatch an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:settings`: show or update local Nogra profile, runtime role models,
  effort and language.
- `/nogra:status`: show installed plugin ref, workspace id,
  language/runtime state and recent local records.
- `/nogra:update`: pull current Nogra contract/guidance on demand.
- `/nogra:help`: explain Nogra and choose the right Nogra flow.

## Thin Intent Router

Nogra's router is a small intent index, not a hook gate. It maps accepted user
intent to the matching skill:

- setup/enable -> `/nogra:setup`
- learn or map this project -> `/nogra:adapt`
- create a project under a hub -> `/nogra:create`
- brief or Nogra workflow -> `/nogra:brief`
- GO after a reviewed brief -> `/nogra:dispatch`
- evidence, "is this done?", or verification -> `/nogra:verify`
- state, checkpoint, version or recent records -> `/nogra:status`
- runtime/language configuration -> `/nogra:settings`
- guidance refresh -> `/nogra:update`
- help choosing a flow -> `/nogra:help`

If no Nogra route matches, stay direct. For unusually large autonomous work,
Claude may give one short non-blocking brief nudge before the run starts, but
must not repeat it, block on it or turn it into prompt scoring.

The plugin includes lightweight lifecycle hooks for boot, compact continuity and
project focus. `SessionStart` adds a small boot or resume pointer when
`.nogra/config.json` exists. `PostCompact` rehydrates only a thin continuity
pointer after context compaction. `SessionEnd` updates the local session anchor
without adding chat context. `UserPromptSubmit` may add project-focus context
when the user clearly selects an indexed project from a workspace hub. Hooks do
not score prompts, emit proactive brief prompts, inspect tool calls, change
config, draft briefs, dispatch, verify or spawn agents. Skills own all `.nogra/`
writes, brief drafting, dispatch, verification and agent spawning. Claude
transcript and history stay outside Nogra's routing input. Claude must still use
Nogra skills for the workflow and wait for the user's choice before entering
brief flow.

Session continuity is local and explicit. Session-start and prompt hooks may
write a bounded session anchor under `.nogra/runtime/session-anchor.json`, and
Nogra runtime writes append-only ledger events when briefs, dispatches,
verification, diagnostics or terminal run records are created. A checkpoint is a
user-visible projection of that ledger state, not an automatic shutdown upload.
When the ledger is ahead of the checkpoint, `/nogra:status` reports the
checkpoint as stale so Claude can ask whether to refresh it.

Routing is pull-first. Normal scoped work stays direct unless the user pulls
Nogra. Natural-language intent belongs to Claude's judgment. Irreversible,
production, billing, data, permissions or secrets work still uses Claude Code's
native permission model and current-task judgment. Nogra dispatch starts only
after the user accepts the workflow.

Extension plugins own their own `/nogra-*` commands and hooks. If an installed
Nogra extension handles a prompt or command, that request stays with the
extension plugin.

After setup, use `/nogra:brief` to start a Nogra brief, or ask Claude to write
one for the work. When the brief looks right, say GO to dispatch it.

For an existing project, run `/nogra:adapt` after setup to let Claude read the
workspace and record Nogra's project map in `.nogra/state/PROJECT-STRUCTURE.md`,
`.nogra/state/SESSION-CHECKPOINT.md` and `.nogra/state/DECISIONS.md`.

For a workspace hub that should manage several projects, run `/nogra:create
<name>` after setup. It creates `projects/<workspaceId>/` with its own
project-local `.nogra/` state and records the project in the hub index.

Use `/nogra:verify` when you want Nogra to check whether work is actually done.
Use `/nogra:update` only when you want to refresh Nogra guidance; updates are
explicit, not periodic.

Language preference is controlled locally by `.nogra/config.json`:

```json
"routingPolicy": {
  "defaultLanguage": "en",
  "translationFallback": "claude-current-prompt"
}
```

Language handling is English-first; `defaultLanguage` tells Claude the
workspace's preferred language, and `translationFallback` means Claude uses its
current-prompt understanding directly.

Runtime preferences are also controlled locally:

```json
"runtimePolicy": {
  "profile": "default",
  "roles": {}
}
```

Use `/nogra:settings` to view or change this. `profile: "default"` uses
Nogra's release default executor/verifier runtime preferences. `profile:
"custom"` is written only when the user chooses concrete executor/verifier
runtime values. The bundled executor/verifier agents stay inside the plugin and
are not copied into the workspace's `.claude/agents/`. Claude Code's native
`/model` and `/effort` remain the source of truth for the live model and
effort.

## What Setup Writes

`/nogra:setup` reads the plugin-bundled bootstrap bundle and writes local Nogra
workspace state:

- `.nogra/config.json` (the workspace config)
- `.nogra/state/` current checkpoint, tasks, decisions and structure files
- `.nogra/briefs/`, `.nogra/runs/`, `.nogra/evidence/`, `.nogra/receipts/`,
  `.nogra/reports/`, `.nogra/checkpoints/`, `.nogra/memory/`, `.nogra/index/`
  and `.nogra/transport/` lanes
- root `CLAUDE.md`, only when one does not already exist

Setup preserves app files and existing root `CLAUDE.md`. Project-specific facts
are refined by `/nogra:adapt`, after Nogra has read this workspace.
