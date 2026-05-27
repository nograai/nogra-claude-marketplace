# Nogra Claude Code Plugin

Nogra adds a brief-first workflow to Claude Code. It helps a workspace move from
fuzzy intent to an approved brief, dispatches approved work, and asks for
evidence before calling work done.

## Install

After installing this plugin:

1. Open Claude Code in the project folder you want to use with Nogra.
2. Restart or reopen Claude Code so the plugin is loaded.
3. Run `/nogra:setup`.

You can also ask Claude:

```text
Can you help me set up Nogra in this folder?
```

The plugin provides three primitives - brief, dispatch, verify - plus the local
`.nogra/` ledger they write to.
Folder-local state is created only when `/nogra:setup` runs.

By default, setup, brief contracts, brief validation, local dispatch receipts and
verification support use bundled plugin contracts plus the workspace `.nogra/`
records. After the plugin has been installed, all workflow stays local
to the workspace.

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
- `/nogra:adapt`: read an existing project and write Nogra's local project map
  under `.nogra/` without changing app files.
- `/nogra:brief`: shape scoped, risky or ambiguous work into a validated Nogra
  brief before execution.
- `/nogra:dispatch`: dispatch an approved brief after explicit GO.
- `/nogra:verify`: check whether a claim/result matches the brief and evidence.
- `/nogra:off`: disable automatic Nogra offers in this workspace.
- `/nogra:on`: enable automatic Nogra offers in this workspace.
- `/nogra:sensitivity`: set Nogra automatic routing sensitivity as a percentage.
- `/nogra:settings`: show or update local Nogra profile, runtime role models,
  effort, language and auto-routing settings.
- `/nogra:status`: show installed plugin ref, workspace release version,
  routing state and recent local records.
- `/nogra:update`: pull current Nogra contract/guidance on demand.
- `/nogra:help`: explain Nogra and choose the right Nogra flow.

The plugin also includes soft lifecycle hooks that make the brief/direct choice
visible at the right moment. Hooks only score local current-prompt/workspace
signals, add short routing context, and ask before first tool use when a
high-scope request skipped the brief/direct offer. Skills own all `.nogra/`
writes, brief drafting, dispatch, verification, and agent spawning. Claude
transcript and history stay outside Nogra's routing input. Claude must still
use Nogra skills for the workflow and wait for the user's choice before
entering brief flow. `/nogra:on` and `/nogra:off` are handled by
their skills, which update local `.nogra/config.json` and report the result in
Claude's visible conversation surface. Explicit `/nogra:*` commands still work
while automatic offers are off.
If the user explicitly asks for direct work, skip brief, or no ceremony,
automatic routing stays direct regardless of sensitivity.

Routing is structured-primary with judgment fallback. The local score path is
the preferred baseline. When it misses but the prompt still has product-work
shape, hooks surface a judgment-fallback marker; Claude then uses current-prompt
judgment to decide whether to make the brief/direct offer. The fallback runs as
deterministic current-prompt judgment; Nogra dispatch starts only after the user
accepts the workflow.

Extension plugins own their own `/nogra-*` commands and hooks. If an installed
Nogra extension handles a prompt or command, that request stays with the
extension plugin.

After setup, use `/nogra:brief` to start a Nogra brief, or ask Claude to write
one for the work. When the brief looks right, say GO to dispatch it.

For an existing project, run `/nogra:adapt` after setup to let Claude read the
workspace and record Nogra's project map in `.nogra/PROJECT-STRUCTURE.md`,
`.nogra/SESSION-CHECKPOINT.md` and `.nogra/DECISIONS.md`.

Use `/nogra:verify` when you want Nogra to check whether work is actually done.
Use `/nogra:update` only when you want to refresh Nogra guidance; updates are
explicit, not periodic.

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
  }
}
```

`sensitivityPercent` is the user-facing sensitivity control. Higher sensitivity makes
Claude offer Nogra more often by lowering effective thresholds. Lower
sensitivity keeps Claude more direct by raising effective thresholds. The
value snaps to `sensitivityStepPercent` so users can tune it in calm increments
defined by the workspace config. The scoring values tune Nogra's local routing
while the plugin remains stable. Explicit `/nogra:*` commands always work.
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

`/nogra:setup` reads the plugin-bundled bootstrap bundle and writes only the
small local Nogra workspace state:

- workspace config
- root `CLAUDE.md` when missing

Setup only writes the two files listed above. Project-specific notes are created
by `/nogra:adapt`, after Nogra has read this workspace.
