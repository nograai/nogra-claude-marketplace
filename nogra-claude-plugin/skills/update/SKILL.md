---
name: update
description: Pull the latest Nogra contract and guidance on demand. Use when the user runs /nogra:update, asks whether Nogra has changed, sees a contract mismatch, or wants Claude to refresh Nogra guidance without starting work.
---

# Nogra Update

Use this skill to pull current Nogra guidance on demand.

`/nogra:update` is not a session-start hook and not background polling. It is a
manual refresh when the user wants to know whether the Nogra contract or
workflow guidance changed.

## Boundary

This skill checks guidance. It does not dispatch work, verify completion, or
silently rewrite a workspace.

Do not call this skill automatically at session start.

## Trigger

Use this skill when the user:

- runs `/nogra:update`;
- asks whether Nogra changed;
- asks Claude to refresh Nogra's contract/template;
- hits a brief validation mismatch that suggests stale guidance;
- asks for the current Nogra command/workflow surface.

Do not use this skill for:

- ordinary chat;
- every new session;
- every brief draft when a fresh contract was already fetched in this flow;
- workspace init. Use `init` for first setup.

## Flow

1. Call `registry` once and verify the active MCP is the hosted plugin
   MCP:
   - `boundary.hostedMode` must be `true`.
   - `status` should be `v1-hosted-validation`.

   If the registry shows local/non-hosted mode, stop. Tell the user the Claude
   Code session is calling a local/private MCP server still registered as
   `nogra` instead of the plugin-managed hosted MCP. `nogra` is reserved for
   hosted/plugin mode; local/private development should use `nogra-dev`.
2. Call `brief_contract` once to refresh the current brief contract and
   return policy.
3. Summarize only what matters:
   - server mode/status;
   - current brief schema name;
   - key command surface: `/nogra:brief`, `/nogra:dispatch`,
     `/nogra:verify`, `/nogra:update`, `/nogra:help`;
   - whether the response suggests a local workspace action is needed.
4. If the user asks to refresh local workspace skeleton files, ask for explicit
   GO before calling `init(mode="plugin")`. Do not do this as part of a
   normal update check.

## Output

Keep the answer short. Use this shape:

```text
Nogra update check complete.
- Hosted MCP: <status>
- Brief contract: <schema/version>
- Local action needed: <yes/no>
```

Do not print the full schema unless the user asks.
