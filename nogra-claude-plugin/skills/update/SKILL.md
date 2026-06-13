---
name: nogra-update
description: Check the installed Nogra plugin-local contract and guidance on demand. Use when the user runs /nogra:update, asks whether Nogra has changed, sees a contract mismatch, or wants Claude to refresh Nogra guidance without starting work.
---

# Nogra Update

Use this skill to inspect current Nogra plugin-local guidance on demand.

`/nogra:update` is not a session-start hook and not background polling. It is a
manual check when the user wants to know whether the installed Nogra contract
or workflow guidance changed.

## Boundary

This skill checks guidance only. Dispatch, verification and workspace changes
stay in their own flows.

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
- workspace setup. Use `nogra-setup` for first setup.

## Flow

1. Run the plugin-local registry:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" registry --root "$PWD" --json
   ```

   This checks the installed plugin contracts locally.
2. Run the plugin-local brief contract check:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-contract --root "$PWD" --json
   ```

3. Summarize only what matters:
   - local runtime status;
   - current brief schema name;
   - key command surface: `/nogra:brief`, `/nogra:dispatch`,
     `/nogra:verify`, `/nogra:update`, `/nogra:help`;
   - whether the response suggests a local workspace action is needed.
4. If the user asks to refresh local workspace skeleton files, ask for explicit
   GO before running the local init bundle/apply path. Do not do this as part
   of a normal update check.

## Output

Keep the answer short. Use this shape:

```text
Nogra update check complete.
- Local runtime: <status>
- Brief schema: <schema>
- Local action needed: <yes/no>
```

Do not print the full schema unless the user asks.
