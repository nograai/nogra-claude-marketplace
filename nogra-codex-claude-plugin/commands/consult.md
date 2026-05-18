---
description: Ask Codex for a read-only consult from Claude Code through the optional Nogra Codex provider
argument-hint: "[--model <model>] [--effort <low|medium|high|xhigh>] [--max-output <chars>] [question]"
allowed-tools: Bash(node:*)
---

Ask Codex through the optional Nogra provider plugin.

Raw slash-command arguments:
`$ARGUMENTS`

Core rules:
- This command is consult-only and read-only.
- Do not edit files, apply patches, dispatch Nogra, verify Nogra runs, or convert the request into a Nogra brief.
- Preserve the user's question. If `$ARGUMENTS` is empty, ask the user what Codex should answer.
- Return the command stdout verbatim. Do not summarize Codex unless the user asks for a summary after the consult.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-codex.mjs" consult "$ARGUMENTS"
```
