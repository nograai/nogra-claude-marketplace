
# Nogra Plugin Surface

Clean-room landing zone for the Nogra Claude Code plugin surface.

Rule: Nogra is free. Sync is later.

## Mapped From Current Plugin

Source: previous private Nogra Claude plugin surface.

Imported active surfaces:

- `.claude-plugin/plugin.json`
- `skills/*/SKILL.md`
- `agents/*.md`
- `contracts/schemas/*`
- `contracts/templates/*`
- `contracts/init-bundle/*`
- `scripts/nogra-local.mjs`
- `scripts/nogra-ledger.mjs`
- `scripts/smoke-local-runtime.mjs`

The current core plugin is skill-driven; it does not ship a core `commands/`
folder. `/nogra:setup`, `/nogra:create`, `/nogra:adapt` and the other core
flows are represented as skills backed by the local runtime.

## LLM Workspace Shape

Nogra supports two local shapes:

```text
my-project/
  .nogra/
```

```text
my-workspace/
  .nogra/
  projects/
    project-a/
      .nogra/
    project-b/
      .nogra/
```

Hub `.nogra/` owns project discovery. Project `.nogra/` owns project state.
SessionStart only detects and hints; it must not load full memory, write state,
dispatch work, or treat memory as authority. From a hub, a named indexed
project focuses `projects/<workspaceId>/` read-only before any work begins.

## Hooks

Active hooks:

- `hooks/session-start.mjs` - boot-context and Manager hub detector.
- `hooks/user-prompt-submit.mjs` - project focus from Manager hub plus local
  routing-score telemetry.
- `hooks/pre-tool-use.mjs` - pending-routing guard. It may update the same
  local routing-score telemetry record.

Production hooks may write only bounded local routing telemetry under
`.nogra/runtime/last-routing-score.json`. They do not write config, dispatch,
verify, spawn agents or draft briefs.

Parked source hooks:

- `hooks/source-0.4.3/*`

Do not activate the parked routing hooks until their behavior is reconciled with
the boot-context, project-focus, and memory-index model.

This folder should not become a gated skill catalog. Skills, commands, local
contracts and local runtime support are part of the free local product.
