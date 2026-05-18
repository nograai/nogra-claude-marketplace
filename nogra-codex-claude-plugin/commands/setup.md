---
description: Check whether the optional Nogra Codex provider can call the local Codex CLI
argument-hint: "[--json]"
allowed-tools: Bash(node:*)
---

Check local Codex provider readiness for Nogra.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-codex.mjs" setup "$ARGUMENTS"
```

Return the command stdout verbatim. Do not run a consult from setup.
