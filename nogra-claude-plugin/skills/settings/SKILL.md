---
name: settings
description: Show or update local Nogra settings for routing, runtime role models, effort and advisory budget. Use when the user runs /nogra:settings or asks to configure Nogra manager/agent/verifier model, effort, profile, budget, language or auto behavior.
---

# Nogra Settings

Show or update local Nogra settings in `.nogra/config.json`.

This is a local workspace control surface. It does not call hosted Nogra, does
not draft a brief, does not dispatch, and does not change Claude Code global
settings.

## Boundary

Read and write only `.nogra/config.json`.

Do not edit app files, `.claude/`, `CLAUDE.md`, package files, hooks, plugin
files or MCP config. Do not call Nogra MCP tools for settings. Do not spawn an
agent.

If `.nogra/config.json` is missing, say Nogra is not initialized in this folder
and stop. If it is invalid JSON, stop and ask before replacing it.

## Runtime Policy Shape

Ensure the config has this shape, preserving user-set values and unknown keys:

```json
"runtimePolicy": {
  "profile": "balanced",
  "roles": {
    "manager": {
      "model": "inherit",
      "effort": "auto",
      "context": "session",
      "enforcement": "advisory-main-session"
    },
    "agent": {
      "model": "sonnet",
      "effort": "high",
      "context": "default",
      "maxTurns": null
    },
    "verifier": {
      "model": "sonnet",
      "effort": "medium",
      "context": "default",
      "maxTurns": null
    }
  },
  "budget": {
    "mode": "balanced",
    "maxUsdPerRun": null,
    "warnUsdPerRun": null
  }
}
```

`manager` is advisory for the active Claude Code main conversation. To actually
switch the current conversation, tell the user the matching native commands,
such as `/model opus[1m]` and `/effort xhigh`.

The plugin registers `executor` and `verifier` from its own
`agents/` directory with default Sonnet/high frontmatter. Plugin mode does not
install these agents into the workspace's `.claude/agents/`. `agent` and
`verifier` settings describe desired disposable run-agent routing for each
Nogra run; Manager passes them into dispatch handoff and requests them directly
when the client/runtime can honor per-run model and effort overrides. If the
runtime cannot honor them, Manager must report the limitation rather than
silently pretending.

Budget is advisory in interactive plugin mode. A hard `maxUsdPerRun` applies
only to headless runtimes that support budget flags such as
`--max-budget-usd`.

## Profiles

When the user sets a profile, replace only `runtimePolicy.profile`,
`runtimePolicy.roles` and `runtimePolicy.budget`. Preserve unknown keys inside
`runtimePolicy`.

Use these presets:

```json
{
  "frugal": {
    "roles": {
      "manager": { "model": "inherit", "effort": "auto", "context": "session", "enforcement": "advisory-main-session" },
      "agent": { "model": "sonnet", "effort": "medium", "context": "default", "maxTurns": 20 },
      "verifier": { "model": "haiku", "effort": "low", "context": "default", "maxTurns": 12 }
    },
    "budget": { "mode": "frugal", "maxUsdPerRun": 2, "warnUsdPerRun": 1 }
  },
  "balanced": {
    "roles": {
      "manager": { "model": "inherit", "effort": "auto", "context": "session", "enforcement": "advisory-main-session" },
      "agent": { "model": "sonnet", "effort": "high", "context": "default", "maxTurns": null },
      "verifier": { "model": "sonnet", "effort": "medium", "context": "default", "maxTurns": null }
    },
    "budget": { "mode": "balanced", "maxUsdPerRun": null, "warnUsdPerRun": null }
  },
  "max": {
    "roles": {
      "manager": { "model": "opus[1m]", "effort": "xhigh", "context": "1m", "enforcement": "advisory-main-session" },
      "agent": { "model": "sonnet", "effort": "high", "context": "default", "maxTurns": null },
      "verifier": { "model": "sonnet", "effort": "high", "context": "default", "maxTurns": null }
    },
    "budget": { "mode": "max", "maxUsdPerRun": null, "warnUsdPerRun": null }
  }
}
```

Important: current Claude Code docs support `xhigh` on Opus 4.7. Sonnet may
fall back to `high` if `xhigh` is requested. If the user asks for Sonnet xhigh,
preserve their requested value only after noting that runtime support depends on
the active Claude Code/model version.

There is no native 250k context switch in Claude Code settings. Use
`context: "default"` for the normal context window, or model aliases such as
`opus[1m]` / `sonnet[1m]` when the user explicitly wants 1M and their plan
supports it.

## Commands To Support

Interpret these forms:

- `/nogra:settings` -> show current settings menu only.
- `/nogra:settings profile frugal|balanced|max` -> apply preset.
- `/nogra:settings manager <model> <effort>` -> update manager role.
- `/nogra:settings agent <model> <effort>` -> update agent role.
- `/nogra:settings verifier <model> <effort>` -> update verifier role.
- `/nogra:settings budget frugal|balanced|max` -> update budget mode only.
- `/nogra:settings budget <number>` -> set `maxUsdPerRun` to that number and
  budget mode to `custom`.
- `/nogra:settings language <code>` -> set
  `routingPolicy.defaultLanguage`.
- `/nogra:settings auto on|off` -> set `routingPolicy.autoOfferEnabled`.

For sensitivity, prefer `/nogra:sensitivity <percent>` but it is fine to show
the current value in the settings menu.

## Write Rules

When updating:

1. Read `.nogra/config.json`.
2. Add missing `runtimePolicy` defaults without overwriting existing values.
3. Apply the requested change.
4. Preserve `routingPolicy`, `briefPolicy`, `returnPolicy`, paths and unknown
   keys.
5. Write two-space JSON with a trailing newline.
6. Return the updated compact menu.

## Menu Shape

Use a compact inline menu like this. It is a visual guide, not a rigid template.
For the sensitivity bar, use exactly 12 characters. Filled characters are
`round(percent / 100 * 12)`. Examples: `50% -> ++++++------`,
`70% -> ++++++++----`, `100% -> ++++++++++++`.

```text
╭────────────────────────────────────────╮
│ NOGRA SETTINGS                         │
╰────────────────────────────────────────╯

Profile      balanced
Auto         ON
Sensitivity  50%   0% ++++++------ 100%
Language     en

Manager      inherit · auto   (main session advisory)
Agent        sonnet  · high
Verifier     sonnet  · medium
Budget       balanced

Commands:
  /nogra:settings profile max
  /nogra:settings agent sonnet high
  /nogra:settings manager opus[1m] xhigh
  /nogra:sensitivity 70%
```

When a setting changes, start with one short confirmation:

```text
Nogra profile is now max.
```

Then show the menu.
