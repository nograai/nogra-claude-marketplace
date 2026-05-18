---
description: Show recent Nogra Codex provider consult runs
argument-hint: "[--json]"
allowed-tools: Bash(node:*)
---

Show recent Nogra Codex provider runs.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-codex.mjs" status "$ARGUMENTS"
```

Return stdout verbatim.
