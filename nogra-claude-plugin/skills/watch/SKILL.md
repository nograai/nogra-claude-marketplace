---
name: nogra-watch
description: Show or follow Nogra's local live hook log. Use only when the user runs /nogra:watch or explicitly asks to watch Nogra hook events, transcript activity or live runtime visibility.
---

# Nogra Watch

Use this skill to surface local live hook visibility on explicit user request.
This is an observability surface only: do not dispatch work, do not modify
workspace files, and do not start always-on background monitors.

## Data Source

Use the local runtime watch command as the canonical source:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" watch --root "<absolute-workspace-root>" --lines 25 --json
```

Claude Code Bash-safe command style: use one simple command per Bash tool call
with an absolute workspace root. Do not use `$PWD`, shell chaining, heredocs or
temporary shell assignments.

## Output

Show:

- log path;
- total event count;
- latest event name and compact summary;
- recent sanitized text log lines.

Do not dump raw JSONL by default. Do not show prompt bodies, tool output, file
contents or full shell commands.

## Live Follow

If the user asks to follow the log live, use Claude Code's Monitor tool on the
reported `.nogra/runtime/live-hooks.log` path when available. If Monitor is not
available in the client, suggest a manual `tail -F` of the reported absolute log
path.

Do not add plugin `monitors/` config for this flow unless the user explicitly
chooses an always-on monitor design in a separate decision.
