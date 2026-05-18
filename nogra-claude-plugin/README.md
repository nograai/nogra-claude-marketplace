# Nogra Claude Code Plugin

Nogra adds a brief-first workflow to Claude Code. It helps a workspace move from
fuzzy intent to an approved brief, dispatches approved work, and asks for
evidence before calling work done.

## Install

After installing this plugin:

1. Open Claude Code in the project folder you want to use with Nogra.
2. Restart or reopen Claude Code so the plugin is loaded.
3. Run `/nogra:init`.
4. Sign in when the browser opens.

You can also ask Claude:

```text
Can you help me set up Nogra in this folder?
```

The plugin provides the Nogra skills and MCP connection. Folder-local state is
created only when `/nogra:init` runs.

## Beta Updates

The beta marketplace publishes from the git commit SHA of the marketplace/plugin
source. During beta, release changes land in the marketplace/plugin repo; to
pick up a released plugin version, run `/plugin update` and `/reload-plugins`,
or enable marketplace auto-update in Claude Code. The plugin metadata also
declares the beta package version for human-readable marketplace surfaces.

If you ask Claude whether Nogra can be installed without overwriting existing
files, Claude should walk through the file plan before writing anything. In
plugin mode, init writes `.nogra/` workspace state plus a root `CLAUDE.md` only
when missing, and preserves or merges existing Nogra files according to the
returned write policy.

## Skills

- `/nogra:init`: enable the current folder for Nogra.
- `/nogra:adapt`: read an existing project and write Nogra's local project map
  under `.nogra/` without changing app files.
- `/nogra:brief`: shape scoped, risky or ambiguous work into a validated Nogra
  brief before execution.
- `/nogra:dispatch`: dispatch an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:off`: disable automatic Nogra offers in this workspace.
- `/nogra:on`: enable automatic Nogra offers in this workspace.
- `/nogra:sensitivity`: set Nogra automatic routing heat as a percentage.
- `/nogra:settings`: show or update local Nogra profile, runtime role models,
  effort, advisory budget, language and auto-routing settings.
- `/nogra:status`: show installed plugin ref, hosted MCP version, workspace
  playbook version, routing state and recent records.
- `/nogra:statusline`: optionally show `Nogra Auto ON/OFF` and routing heat in
  Claude Code's terminal statusline.
- `/nogra:update`: pull current Nogra contract/guidance on demand.
- `/nogra:help`: explain Nogra and choose the right Nogra flow.

The plugin also includes an internal `nogra:offer` gate plus soft lifecycle
hooks that make the gate visible at the right moment. Hooks only score local
current-prompt/workspace signals, add short routing context, update the local
`autoOfferEnabled` toggle when the user explicitly asks for `/nogra:on` or
`/nogra:off`, and prevent first tool use when a high-scope request skipped the
brief/direct offer. They do not call MCP, draft briefs, dispatch work, verify
completion, spawn agents, or read Claude transcript/history files. Claude must
still use Nogra skills for the workflow and wait for the user's choice before
entering brief flow. `/nogra:on` and `/nogra:off` control this automatic
routing only. Explicit `/nogra:*` commands still work while automatic offers
are off.
If the user explicitly asks for direct work, skip brief, or no ceremony,
automatic routing stays direct regardless of sensitivity.

Extension plugins own their own `/nogra-*` commands and hooks. If an installed
Nogra extension handles a prompt or command, Nogra stays out of the way and does
not convert that extension request into Nogra ceremony.

After init, use `/nogra:brief` to start a Nogra brief, or ask Claude to write
one for the work. When the brief looks right, say GO to dispatch it.

For an existing project, run `/nogra:adapt` after init to let Claude read the
workspace and record Nogra's project map in `.nogra/PROJECT-STRUCTURE.md`,
`.nogra/SESSION-CHECKPOINT.md` and `.nogra/DECISIONS.md`.

Use `/nogra:verify` when you want Nogra to check whether work is actually done.
Use `/nogra:update` only when you want to refresh Nogra guidance; Nogra does not
poll constantly or run automatically on every session start.

Nogra suggestions are controlled locally by `.nogra/config.json`:

```json
"routingPolicy": {
  "autoOfferEnabled": true,
  "sensitivityPercent": 50,
  "sensitivityStepPercent": 5,
  "autoOfferThreshold": 60,
  "strongOfferThreshold": 80,
  "offerOncePerIntent": true,
  "defaultLanguage": "en",
  "translationFallback": "claude-current-prompt",
  "scoring": {
    "createIntent": 25,
    "productSurface": 20,
    "evidenceNeed": 20,
    "completionClaim": 20,
    "qualityCritical": 15,
    "riskyDomain": 15,
    "ambiguity": 10,
    "lowRiskEdit": -30,
    "singleFileLowScope": -15,
    "directOverride": -40,
    "pureQuestion": -50
  },
  "dictionary": {
    "createIntent": [],
    "evidenceNeed": [],
    "directOverride": []
  }
}
```

`sensitivityPercent` is the user-facing heat control. Higher sensitivity makes
Claude offer Nogra more often by lowering effective thresholds. Lower
sensitivity keeps Claude more direct by raising effective thresholds. The
value snaps to `sensitivityStepPercent` so users can tune it in calm increments
such as 5% or 10%. The scoring values tune Nogra's local catch-rule without
changing the plugin. Explicit `/nogra:*` commands always work.
Language handling is English-first plus `dictionary`; `defaultLanguage` tells
Claude the workspace's preferred language, and `translationFallback` means
Claude may use current-prompt understanding without making an external
translation call. `dictionary` lets a workspace add localized trigger phrases
on top of the English-first defaults. Leave the arrays empty for English-only
workspaces, or fill them with phrases in your workspace's language.

Runtime and spend preferences are also controlled locally:

```json
"runtimePolicy": {
  "profile": "balanced",
  "roles": {
    "manager": { "model": "inherit", "effort": "auto" },
    "agent": { "model": "sonnet", "effort": "high" },
    "verifier": { "model": "sonnet", "effort": "medium" }
  },
  "budget": { "mode": "balanced", "maxUsdPerRun": null }
}
```

Use `/nogra:settings` to view or change this. `manager` is advisory for the
active Claude Code main session; use native `/model` and `/effort` to actually
switch the current conversation. The plugin registers `executor` and
`verifier` from its own `agents/` directory with default Sonnet/high
frontmatter, so approved Nogra runs can cross into a real agent template
instead of prompt-only routing. Plugin mode does not install these agents into
the workspace's `.claude/agents/`. Workspace `agent` and `verifier` settings
are passed into dispatch handoff and used as per-run guidance or overrides when
the client/runtime can honor them. In interactive plugin mode, budget is
advisory; hard budget limits require a headless runtime that supports budget
flags.

## Optional Statusline

Nogra can be shown in Claude Code's terminal statusline without hooks, MCP calls
or prompt injection. The plugin ships:

```text
statusline/nogra-statusline.mjs
```

The statusline reads Claude Code's local statusline JSON from stdin and reads the
current workspace's `.nogra/config.json` from disk. In an initialized workspace
it displays:

```text
Nogra Auto ON | Nogra Sensitivity 50% 0% ++++++------ 100% | Profile balanced | Agent sonnet/high | Budget balanced
```

or:

```text
Nogra Auto OFF | Nogra Sensitivity 50% 0% ++++++------ 100% | Profile balanced | Agent sonnet/high | Budget balanced
```

Use `/nogra:statusline` to install or explain this optional display. The script
also uses Claude Code's current `context_window` fields so 1M-context sessions
show token math such as `440k/1.0M tokens`.

## What Init Writes

`/nogra:init` asks hosted Nogra for the current workspace bootstrap bundle and
writes only the small local Nogra workspace state:

- workspace config
- local continuity notes
- local record directories for briefs, runs, events, receipts and transport

It does not change app code, Claude Code config, skills, commands, presets,
templates or pinboard files. Those belong to the plugin/update path or hosted
Nogra runtime contracts, not folder init.
