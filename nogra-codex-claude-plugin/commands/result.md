---
description: Show a previous Nogra Codex provider consult result
argument-hint: "[run-id|latest] [--json]"
allowed-tools: Bash(node:*)
---

Show a previous Nogra Codex provider result.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-codex.mjs" result "$ARGUMENTS"
```

Return stdout verbatim.
