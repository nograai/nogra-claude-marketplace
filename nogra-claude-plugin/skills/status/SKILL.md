---
name: nogra-status
description: Show compact Nogra ledger/state, installed plugin ref, workspace id, language/runtime state, and recent local records. Use only when the user runs /nogra:status or explicitly asks for Nogra ledger, Nogra state, Nogra version, installed plugin version, current Nogra records, recent briefs, runs or events. Do not use for generic project, task, session, git or release status.
---

# Nogra Ledger State

Show a compact, human-readable Nogra ledger/state view. Do not dump raw runtime
payloads, and do not present this as Claude's session `/status` view.

## Required Version Lines

Always include a small version block near the top:

```text
Nogra plugin: <id> <ref>
Workspace: <workspaceId or not initialized>
```

Use the current plugin session context and local runtime status when available.
Detailed data-source mechanics live in
`skills/status/references/data-sources.md`; runtime-policy meaning lives in
`skills/help/references/runtime.md`.

## Plugin Drift Warnings

Status may warn about plugin install drift, but these warnings do not block
normal work:

- If the local runtime reports multiple non-orphaned `nogra` installs in
  Claude Code's plugin cache, show a warning with the marketplace, ref and
  version for each candidate. This is a visibility guard only; multi-install
  setups are valid during local testing.
- If the active plugin version differs from the matching marketplace manifest,
  show `installed=<version>, marketplace=<version>` plus the marketplace name.
  Suggest `/plugin update` or checking the active plugin ref, but do not refuse
  init, brief or dispatch solely because of this warning.

## Runtime State

After versions, show:

- Workspace id from the local runtime.
- Local `.nogra/config.json` state when present: pull-first routing posture and
  workspace language.
- Local transport run state when present:
  - Use `skills/status/references/data-sources.md` for collection details.
  - Show only structured facts: run id, status, phase, target/runtime,
    elapsed/duration, artifact flags, and helper consistency result.
- Recent briefs and local transport runs from `.nogra/`; summarize counts and
  newest item only unless the user asks for details.
- Transport note: runtime ledger truth lives in `.nogra/`. Do not imply hosted
  Nogra owns run state.
- Local ledger/checkpoint freshness when present: show `ledgerWatermark`,
  `checkpointSourceWatermark` and whether the checkpoint is `fresh` or `stale`.
- Local index readiness when present: show whether risk intake, behavior score,
  risk registry, decisions and expansions files exist. If
  `.nogra/index/behavior-score.md` has a filled latest score line, summarize it
  in one short line.
- Local continuity migration status when present: show `ready` or
  `migration-needed`. If migration is needed, say `/nogra:setup` will merge the
  missing local continuity layout without replacing app files or user-set config.

## Background Run Boundary

Use provider-native truth. Show local Nogra heartbeat/ledger state only when
`.nogra/ledger/` or `.nogra/runtime/` records exist. Do not poll continuously.
This status command is an explicit on-demand read.

Do not build a parallel task UI. Claude Code's native `/status`, `/ps` and task
notifications remain the live session/task surfaces. `/nogra:status` is only
the compact inspection surface for local Nogra ledger truth.

## Missing Workspace Config

If `.nogra/config.json` is missing, say the folder is not Nogra-initialized yet.
Still show plugin version if available, then suggest `/nogra:setup`.

## Output Shape

Keep it short:

```text
Nogra ledger

Versions:
- Nogra plugin: <plugin-id>@<marketplace> <version>

Workspace:
- Id: <workspaceId or not initialized>
- Routing: pull-first, language en

Transport:
- Active: transport-... running 3m, executor anthropic:sonnet
- Latest: transport-... ok, returned, report yes, output no
- Consistency: ok

Ledger:
- Watermark: 4, checkpoint source 2, checkpoint stale
- Continuity: ready

Warnings:
- multiple Nogra installs detected: nogra@nogra-marketplace 0.3.4, nogra@local-test 0.2.5

Recent:
- Briefs: none
- Runs: none
- Events: none

Next:
- /nogra:setup if this folder is new
- /nogra:brief for scoped work
```

If the user only asks "what version am I on?", return only the version block.
