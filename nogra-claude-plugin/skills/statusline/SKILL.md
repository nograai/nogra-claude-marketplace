---
name: statusline
description: Install or explain the optional Nogra statusline for Claude Code. Use when the user asks to show Nogra Auto ON/OFF, heat/sensitivity, or Nogra state in the terminal/statusline.
---

# Nogra Statusline

Use this skill when the user wants Claude Code's terminal statusline to show
Nogra state such as `Nogra Auto ON`, `Nogra Auto OFF`, routing heat, runtime
profile, agent model/effort, advisory budget mode, and the currently active
local Nogra transport run when one exists.

This is optional UI only. It is not a hook, not prompt injection, not an MCP
call, and not a wrapper. It reads Claude Code's statusline JSON from stdin and
the local `.nogra/config.json` plus `.nogra/transport/runs/*.json` from disk.
It does not poll providers, inspect process tables, call MCP tools, or invent
provider progress.

## What It Shows

When the current workspace has `.nogra/config.json`, the statusline segment is:

```text
Nogra Auto ON | Nogra Sensitivity 50% 0% ++++++------ 100% | Profile balanced | Agent sonnet/high | Budget balanced
```

or:

```text
Nogra Auto OFF | Nogra Sensitivity 50% 0% ++++++------ 100% | Profile balanced | Agent sonnet/high | Budget balanced
```

When a local Nogra transport run is active, the statusline adds one compact
ledger-derived segment:

```text
Nogra Auto ON | Nogra Sensitivity 50% 0% ++++++------ 100% | Run c6afa8a9 running 3m | Profile balanced | Agent sonnet/high | Budget balanced
```

Only non-terminal local transport runs are shown. Terminal statuses such as
`ok`, `partial`, `blocked`, `failed` and `cancelled` stay out of the statusline
and belong in `/nogra:status` or the run report. If more than one local run is
active, the statusline shows the newest active run plus `+N`.

This is provider-native surface truth: Codex CLI runs that only have start/end
receipts do not get synthetic heartbeats, and Claude Code's native `/ps` and
task notifications remain the source for live shell/task management.

`sensitivityPercent` is the user-facing heat control. Higher sensitivity makes
Claude offer Nogra more often by lowering effective thresholds. Lower
sensitivity keeps Claude more direct by raising effective thresholds. The
statusline does not show raw thresholds by default. Use `/nogra:sensitivity`
or ask Claude to set Nogra sensitivity to a percentage when you want to change
the heat.

`runtimePolicy.profile`, `runtimePolicy.roles.agent` and
`runtimePolicy.budget.mode` are shown when present. Use `/nogra:settings` to
change them.

If the current workspace is not initialized with Nogra, the Nogra segment is
hidden and the statusline stays generic.

## Install Boundary

Installing the statusline changes Claude Code user settings, normally
`~/.claude/settings.json`, and copies or points to a local statusline script.

Before replacing an existing `statusLine` command, show the current command and
ask the user for explicit confirmation unless the user has already explicitly
asked to replace it.

Do not call Nogra MCP tools. Do not edit `.nogra/` state. Do not change routing
policy. Do not install hooks.

## Script

The plugin ships the script at:

```text
statusline/nogra-statusline.mjs
```

For a stable local install, copy it to:

```text
~/.claude/nogra-statusline.mjs
```

and set Claude Code's `statusLine` setting to:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/nogra-statusline.mjs",
    "padding": 0
  }
}
```

If the user's existing statusline should be preserved, adapt it manually instead
of replacing it: the important fixes are to read token usage from
`.context_window.current_usage`, not `.current_usage`, and to derive token count
from `context_window.total_input_tokens + context_window.total_output_tokens`
or from `used_percentage * context_window_size` as fallback.

## Verification

After install, verify with these cases:

1. Workspace without `.nogra/`: no Nogra segment.
2. Workspace with `autoOfferEnabled: true`: shows `Nogra Auto ON` and a
   sensitivity percentage/bar.
3. Workspace with `autoOfferEnabled: false`: shows `Nogra Auto OFF` and a
   sensitivity percentage/bar.
4. Workspace with `runtimePolicy.profile: "max"` and agent `sonnet/high` shows
   profile, agent and budget labels.
5. A 1M context fixture with `used_percentage: 44` and no token totals shows
   about `440k/1.0M tokens`, not `0/1.0M tokens`.
6. Workspace with one active local transport run shows `Run <short-id>
   running <elapsed>`.
7. Workspace with only terminal local transport runs does not show a run
   segment.
