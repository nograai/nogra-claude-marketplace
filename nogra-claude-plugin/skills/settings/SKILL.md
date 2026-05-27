---
name: settings
description: Show or update local Nogra settings for routing, executor/verifier runtime profile, effort, language and auto behavior. Use when the user runs /nogra:settings or asks to configure Nogra executor/verifier model, effort, profile, language or automatic offers.
---

# Nogra Settings

Show or update local Nogra settings in `.nogra/config.json`.

This is a local workspace control surface for routing, runtime preferences,
language and automatic offers.

## Boundary

Read and write only `.nogra/config.json`. App files, `.claude/`, `CLAUDE.md`,
package files, hooks, plugin files, Claude Code configuration and agent
spawning stay outside this skill.

If `.nogra/config.json` is missing, say Nogra is not initialized in this folder
and stop. If it is invalid JSON, stop and ask before replacing it.

## Runtime Policy

Use `skills/help/references/runtime.md` for canonical runtime-policy details.
In this settings surface, expose only the choices a user can act on:

- `default`: use Nogra's release default executor/verifier runtime preferences.
- `custom`: use the executor/verifier model and effort values the user chooses.

Default does not write concrete executor or verifier runtime values. Custom
writes only the selected executor/verifier values. Claude Code's native
`/model` and `/effort` remain the live source of truth for the current chat.

## Profiles

Support only two user-facing profiles:

- `default`: remove concrete executor and verifier model/effort choices unless
  unknown role keys must be preserved.
- `custom`: keep or write the user-selected executor/verifier role values.

## Commands To Support

Interpret these forms:

- `/nogra:settings` -> show current settings menu only.
- `/nogra:settings profile default` -> reset runtime policy to default.
- `/nogra:settings profile custom` -> mark runtime policy custom without
  inventing concrete values.
- `/nogra:settings executor <model> <effort>` -> set `profile: "custom"` and
  update `roles.executor`.
- `/nogra:settings verifier <model> <effort>` -> update verifier role.
- `/nogra:settings language <code>` -> set
  `routingPolicy.defaultLanguage`.
- `/nogra:settings auto on|off` -> set `routingPolicy.autoOfferEnabled`.

For sensitivity changes, prefer `/nogra:sensitivity <percent>`. The settings
menu may show the current value with context.

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

Profile      default
Auto         ON
Sensitivity  50%   0% ++++++------ 100%
Language     en

Runtime      Default
Executor     default
Verifier     default

Commands:
  /nogra:settings profile default
  /nogra:settings executor opus medium
  /nogra:settings verifier sonnet medium
  /nogra:sensitivity 70%
```

When a setting changes, start with one short confirmation:

```text
Nogra runtime profile is now custom.
```

Then show the menu.
