---
name: status
description: Show compact Nogra status, installed plugin ref, hosted MCP version, workspace playbook version, routing mode, and recent local records. Use when the user asks for Nogra status, version, installed version, plugin version, current state, recent briefs, runs or events.
---

# Nogra Status

Show a compact, human-readable status view. Do not dump raw MCP payloads.

## Required Version Lines

Always include a small version block near the top:

```text
Nogra plugin: <id> <ref>
Hosted MCP: <version> (<status>)
Workspace playbook: <playbookVersion or not initialized>
```

Sources:

- Plugin id/ref: use the `Current installed Nogra plugin` line from
  `NOGRA_ROUTING_POLICY` session context when present. If missing, say
  `unknown` and suggest `/plugin` for Claude Code's raw plugin view.
- Hosted MCP: call `registry` once and read `version`, `status`, and
  `initBundleVersion` or `versions.initBundle` when present.
- Workspace playbook: read `.nogra/config.json` if available and use
  `playbookVersion` or `version`.

## Runtime State

After versions, show:

- Workspace id/mode from `registry`.
- Local `.nogra/config.json` state when present:
  `autoOfferEnabled`, `sensitivityPercent`, and `defaultLanguage`.
- Local transport run state when present:
  - Inspect `.nogra/transport/runs/*.json` directly for the newest active
    run and newest run overall.
  - For the newest run, call
    `node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "$PWD" --run-id <runId> --json`
    when the helper is available.
  - Show only structured facts: run id, status, phase, target/runtime,
    elapsed/duration, artifact flags, and helper consistency result.
  - If helper status is `inconsistent`, `missing` or `conflict`, surface the
    differences and `nextOwner: Manager`. Do not auto-fix and do not rewrite
    Manager's prose.
- Recent briefs, runs and events. Use `recent_briefs`,
  `recent_runs`, and `recent_events`; summarize counts and newest
  item only unless the user asks for details.
- Transport note: in hosted mode, the runtime ledger is local. Do not imply
  hosted Nogra owns run state.

## Background Run Boundary

Use provider-native truth. Do not fabricate heartbeats or mid-run states for
providers that only expose start/end receipts. Do not poll continuously. This
status command is an explicit on-demand read.

Do not build a parallel task UI. Claude Code's native `/ps`, task notifications
and statusline remain the live task surfaces. `/nogra:status` is the compact
inspection surface for local Nogra ledger truth.

## Missing Workspace Config

If `.nogra/config.json` is missing, say the folder is not Nogra-initialized yet.
Still show plugin and hosted MCP versions if available, then suggest
`/nogra:init`.

## Output Shape

Keep it short:

```text
Nogra status

Versions:
- Nogra plugin: nogra@nogra-beta 32b0082...
- Hosted MCP: v1.0.0 (v1-hosted-validation), init bundle v1.0.0
- Workspace playbook: v1.0.0

Workspace:
- Mode: hosted
- Auto: ON, sensitivity 50%

Transport:
- Active: transport-... running 3m, agent anthropic:sonnet
- Latest: transport-... ok, returned, report yes, output no
- Consistency: ok

Recent:
- Briefs: none
- Runs: none
- Events: none

Next:
- /nogra:init if this folder is new
- /nogra:brief for scoped work
```

If the user only asks "what version am I on?", return only the version block.
