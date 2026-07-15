# Nogra

Give your Claude a memory, a conscience, and a second brain: local-first, on the
plan you already pay for.

Nogra is a memory + discipline layer for Claude Code. It gives your workspace a
bounded memory Claude keeps across sessions, a `brain/` knowledge vault for deep
work, and a verify-before-done gate: on work with real scope or risk, you approve a
short plan first, the approved work runs, then the result is checked against that
plan, so you don't have to take "done" on trust when it matters. Everything it
knows is a file you own, and it never touches your credentials.

## Install

**Requires Node.js 18+ on your PATH.** Nogra's local runtime is a small Node
script. If `node` is not available, setup stops and tells you instead of failing
cryptically.

Install Nogra from its marketplace:

```bash
claude plugin marketplace add nograai/nogra-claude-marketplace
claude plugin install nogra@nogra-claude
```

After installing this plugin:

1. In Claude Code, go to the project folder where you want Nogra active.
2. Restart or reopen Claude Code so the plugin loads.
3. Run `/nogra:setup`. This creates the folder's local Nogra state
   (`.nogra/config.json`, standard `.nogra/` domain folders, plus a root
   `CLAUDE.md` only if you don't already have one), a `projects/` folder, and
   the two-way `inbox/` desk: `screenshots/` and `drops/` (you → Nogra) and
   `out/` (Nogra → you: receipts, drafts, "ready for GO").
4. For an existing codebase, also run `/nogra:adapt` so Nogra reads the project
   and records its map under `.nogra/`.

Setup also scaffolds the `brain/` deep-work knowledge vault (`raw/` → `wiki/` →
`index.md`). Pull-first: loaded only when you deliberately bring it in for deep
work, never every session. `/nogra:brain-init` re-creates it if you ever remove it.

You can also ask Claude:

```text
Can you help me set up Nogra in this folder?
```

The plugin provides three primitives - brief, dispatch, verify - plus a thin
intent router, a local five-anchor index and the local `.nogra/` ledger they
write to. The router maps explicit Nogra intent to the right skill. The index
keeps risk intake, behavior score, connections/risk registry, decisions and
expansion guidance visible. If no Nogra route matches, ordinary work stays
direct.
Folder-local state is created only when `/nogra:setup` runs.

By default, setup, brief contracts, brief validation, local dispatch receipts and
verification support use bundled plugin contracts plus the workspace `.nogra/`
records. After the plugin has been installed, all workflow stays local
to the workspace.

### Memory (bounded, native)

Your durable memory is Claude Code's own Auto Memory: `~/.claude/projects/<slug>/memory/`
(a `MEMORY.md` index plus typed topic files). Claude writes it and loads it every session
natively; Nogra keeps no second copy. Nogra owns the **bound**: when the memory grows past
what Claude actually loads (~the first 200 lines of the index), Nogra flags you at session
start to consolidate (merge duplicates, prune stale) so what matters stays in view. A
theory of you, not an archive.

It also pins: a `USER.md` in that same folder is the bounded who-you-are profile (≤1375
chars). Nogra loads it into context **every** session, so who you are is never one recall
away. Claude maintains it as a distilled projection of the topic files; the consolidator
creates it if missing and keeps it under the bound.

It also learns: when you correct Claude, or it catches its own mistake, the lesson goes in
as a one-line rule, so it never repeats. Bounded, so lessons consolidate instead of piling up
forever. Claude does the remembering; Nogra owns the bound.

Config note: set `verifyNudge: "off"` at the top level of `.nogra/config.json`
to silence the completion-claim verify nudge for that workspace (default: on).

## Privacy and Support

Nogra runs locally. It collects no data, requires no account, and makes no
network calls. There is nothing to collect, store, or share.

Pull-first does not mean no hooks ever run. When the plugin is enabled in an
initialized workspace, Claude Code may run Nogra's local lifecycle and
convergence hooks at session or permanent-risk boundaries. Those hooks read and
write local `.nogra/` state and stay silent for ordinary work. They narrow
within Claude Code's permission model: asking one extra time at risk
boundaries, and approving only receipt-matched calls under the explicit
`gate.autoApprove` opt-in. They never widen it.

For support, contact `support@nogra.ai`.

## Turn Off or Uninstall

Nogra has two separate off switches.

For one workspace, remove or rename that folder's `.nogra/` directory. That
turns off Nogra's workspace state, ledger, routing and convergence checks for
that project, but it does not uninstall the Claude Code plugin from your
machine.

For the plugin itself, use Claude Code's plugin manager:

```text
/plugin
```

Open the Installed tab, choose Nogra, then Disable or Uninstall. You can also
use the CLI with the exact plugin id shown by `/plugin` or
`claude plugin list`, for example:

```bash
claude plugin disable nogra@nogra-claude
claude plugin uninstall nogra@nogra-claude
```

If you disable or uninstall during an active Claude Code session, run
`/reload-plugins` or restart Claude Code before trusting the loaded plugin
state. Do not edit `settings.json` by hand unless Claude Code explicitly tells
you to; plugin scope can be user, project or local.

## Public Test Isolation

If you also run private Nogra lanes on the same machine, keep public plugin
tests in an isolated workspace where private lanes are disabled. `/nogra:status`
will warn when another non-orphaned Nogra install is present. Public-grade and
release rehearsals may enable strict public isolation so a private lane such as
`nogra-private-beta` blocks the rehearsal until it is disabled for that
workspace. When disabling a private lane for a public rehearsal, use the exact
private plugin id shown by `/plugin` or `claude plugin list`.

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
no proactive brief prompt and no workflow just because the task has scope. If a
direct run reaches git history or another permanent-risk action without a
current dispatch receipt, Nogra asks for intent confirmation before that tool
call continues.

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
Show Nogra ledger state for this workspace.
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

The marketplace publishes versioned plugin packages. Claude Code caches the
marketplace catalog when the marketplace is added, so refresh the marketplace
before updating the plugin; otherwise the update serves the cached snapshot:

```bash
claude plugin marketplace update <marketplace-name>
claude plugin update nogra@<marketplace-name>
```

Then run `/reload-plugins` or restart Claude Code. Marketplace auto-update in
Claude Code covers both steps. The plugin metadata declares the package version
for human-readable marketplace surfaces.

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
  language/runtime state and recent local ledger records.
- `/nogra:watch`: show recent local hook events from
  `.nogra/runtime/live-hooks.log`; live follow is opt-in via Claude Code
  Monitor or a manual tail command.
- `/nogra:sync`: show sync state with receipts, `run` the full pull→push cycle
  in one call, pull/push the hosted brain on demand, `bind <endpoint>` to wire
  this seat, or turn sync off. The token never passes through the model; status
  reports presence only.
- `/nogra:update`: pull current Nogra contract/guidance on demand.
- `/nogra:help`: explain Nogra and choose the right Nogra flow.

## Five-Anchor Index

Fresh setup creates a compact `.nogra/index/` surface:

- `risk-intake.md` - intent, GO shape, irreversible actions, evidence,
  allowed systems and recurring drift risks.
- `behavior-score.md` - scenario grading by drift cluster and mode.
- `risk-registry.md` - what can be read, written, deployed, sent, migrated,
  billed or must not be touched.
- `.nogra/state/DECISIONS.md` - durable decisions with why, alternatives,
  owner and linked artifacts.
- `EXPANSIONS.md` - when to add project hubs, scenario packs, evidence
  adapters, verifier flows or other Nogra surfaces.

This index is not a structural audit score. Nogra behavior is graded by
evidence from scenarios, runs and verification.

## Thin Intent Router

Nogra's router is a small intent index, not a hook gate. It maps accepted user
intent to the matching skill:

- setup/enable -> `/nogra:setup`
- learn or map this project -> `/nogra:adapt`
- create a project under a hub -> `/nogra:create`
- brief or Nogra workflow -> `/nogra:brief`
- GO after a reviewed brief -> `/nogra:dispatch`
- evidence, "is this done?", or verification -> `/nogra:verify`
- Nogra ledger/state, checkpoint, version or recent records -> `/nogra:status`
- live hook or transcript activity visibility -> `/nogra:watch`
- runtime/language configuration -> `/nogra:settings`
- sync state, sync now (run), pull/push the hosted brain, wire a seat -> `/nogra:sync`
- guidance refresh -> `/nogra:update`
- help choosing a flow -> `/nogra:help`

If no Nogra route matches, stay direct. For unusually large autonomous work,
Claude may give one short non-blocking brief nudge before the run starts, but
must not repeat it, block on it or turn it into prompt scoring.

The plugin includes lightweight lifecycle hooks for boot, compact continuity and
project focus. `SessionStart` adds a small boot or resume pointer when
`.nogra/config.json` exists and includes a small convergence guard. `PostCompact`
rehydrates a thin continuity pointer plus that same convergence guard after
context compaction. `SessionEnd` updates the local session anchor without adding
chat context. `UserPromptSubmit` may add project-focus context when the user
clearly selects an indexed project from a workspace hub. `PreToolUse` is a
narrow deterministic git/action convergence gate: it asks when a permanent-risk
tool call has no current dispatch receipt, and it may add a visible Nogra
match review for receipt-matched actions or conservative read-only public
fetches. By default the gate only adds context and asks; it never approves on
its own. With the explicit `gate.autoApprove` opt-in, a receipt-matched call
inside an authorized boundary class and scope is allowed through
(`permissionDecision: allow`), and hard mode can deny out-of-contract calls;
without that opt-in, no allow is ever sent. The gate narrows within Claude
Code's permission model; it never widens it. Hooks do not
score prompts, emit proactive brief prompts, change config, draft briefs,
dispatch, verify or spawn agents. Skills own all `.nogra/` writes, brief
drafting, dispatch, verification and agent spawning. Claude transcript and
history stay outside Nogra's routing input. Claude must still use Nogra skills
for the workflow and wait for the user's choice before entering brief flow.

Session continuity and observability are local and explicit. Session-start and
prompt hooks may write a bounded session anchor under
`.nogra/runtime/session-anchor.json`. Hook/event observability is appended to
`.nogra/runtime/live-hooks.log` and `.nogra/runtime/live-hooks.jsonl` so the
operator can see which Claude Code events fired and which transcript they
belonged to. The live hook log stores event metadata only: event name,
transcript path, tool name, target path, instruction file, decision summary and
short timing/status fields. It does not store prompt bodies, tool output, file
contents or full shell commands.

For a live view, tail `.nogra/runtime/live-hooks.log` or ask Claude to Monitor
that file in the background. Nogra runtime writes append-only ledger events when
briefs, dispatches, verification, diagnostics or terminal run records are
created. A checkpoint is a user-visible projection of that ledger state, not an
automatic shutdown upload. When the ledger is ahead of the checkpoint,
`/nogra:status` reports the checkpoint as stale so Claude can ask whether to
refresh it.

Nogra also ships a Claude Code statusline projector at
`scripts/statusline.mjs`. It reads Claude Code's statusline JSON from stdin,
reuses the local `/nogra:status` payload as the canonical source, prints one
compact line and fails open as `Nogra:unknown` if anything is unavailable. It
does not write `.nogra/` files or invent bridge, git or promotion state. The
local status payload exposes those as read-only projections: bridge status comes
from local bridge metadata plus the newest bridge gate report, dirty state is a
count/head projection from `git --no-optional-locks status --porcelain=v2
--branch` with `GIT_OPTIONAL_LOCKS=0`, and promotion is a hint derived from the
workspace index plus bridge/git blockers.

Claude Code plugin settings do not currently install a general `statusLine`
entry, so enable it in Claude Code settings when wanted:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/nogra-claude-plugin/scripts/statusline.mjs",
    "padding": 0
  }
}
```

Routing is pull-first. Normal scoped work stays direct unless the user pulls
Nogra. Natural-language intent belongs to Claude's judgment. Irreversible,
production, billing, data, permissions, secrets and git-history work still use
Claude Code's native permission model and current-task judgment. Nogra's
convergence gate adds one extra ask when those boundaries are reached without a
current dispatch receipt. When a current dispatch receipt exists, Nogra
surfaces the receipt in an approval review; by default the underlying Claude
Code permission decision is left untouched, and only the explicit
`gate.autoApprove` opt-in lets a receipt-matched, in-scope call through without
a second prompt. Nogra dispatch starts only after the user accepts the
workflow.

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
- `.nogra/index/` workspace index, risk intake, behavior score, risk registry
  and expansion guidance
- `.nogra/briefs/`, `.nogra/runs/`, `.nogra/evidence/`, `.nogra/receipts/`,
  `.nogra/reports/`, `.nogra/checkpoints/`, `.nogra/memory/`, `.nogra/index/`
  and `.nogra/transport/` lanes
- root `CLAUDE.md`, only when one does not already exist

Setup preserves app files and existing root `CLAUDE.md`. Project-specific facts
are refined by `/nogra:adapt`, after Nogra has read this workspace.
