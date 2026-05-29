
# Nogra Claude Plugin

Nogra gives Claude Code a brief-first workflow with explicit dispatch, evidence
and verification discipline.

This package ships the Nogra skills, local runtime contracts, hooks and agents
used by the Claude Code plugin. The plugin is skill-driven: `/nogra:setup`,
`/nogra:create`, `/nogra:adapt` and the other Nogra flows are represented as
skills backed by the local runtime.

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
- `hooks/user-prompt-expansion.mjs` - initialized-workspace prompt expansion.
- `hooks/pre-tool-use.mjs` - pending-routing guard. It may update the same
  local routing-score telemetry record.

Production hooks may write only bounded local routing telemetry under
`.nogra/runtime/last-routing-score.json`. They do not write config, dispatch,
verify, spawn agents or draft briefs.

Skills, commands, local contracts and local runtime support are part of this
package.
