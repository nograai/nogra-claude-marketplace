---
name: nogra-transcript-diagnostic
description: Inspect one Claude transcript with Nogra's non-authoritative lexical diagnostic. Use only when the user directly runs /nogra:transcript-diagnostic; never invoke it from model judgment, status, hooks or ordinary work.
disable-model-invocation: true
---

# Nogra Transcript Diagnostic

This is an explicit, user-only diagnostic. It is not session quality, a score,
a permission check, a GO detector, a router, evidence verification or a
verdict.

## Boundary

- Never invoke this skill automatically or recommend it merely because wording
  looks risky.
- The default command is read-only preview and writes no receipt.
- Run with `--write` only when the user explicitly asks to save the compact
  diagnostic receipt.
- Treat every signal as a lexical observation with stated limitations.
- Do not convert a signal into permission, GO, a blocked action, routing,
  dispatch, evidence level, fact level or verdict.
- Use canonical approvals, runs, evidence, facts and verdicts for authority and
  truth.

## Preview

Claude Code Bash-safe command style: use one simple command per Bash tool call
with an absolute workspace root. Do not use `$PWD`, shell chaining, heredocs or
temporary shell assignments.

Use the transcript path supplied by the user when one is given:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" transcript-diagnostic --root "<absolute-workspace-root>" --transcript "<absolute-transcript-path>" --json
```

When no path is supplied, the explicit diagnostic may inspect the transcript
referenced by Nogra's current session anchor:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" transcript-diagnostic --root "<absolute-workspace-root>" --json
```

## Explicit Save

Only after the user asks to save the diagnostic:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" transcript-diagnostic --root "<absolute-workspace-root>" --transcript "<absolute-transcript-path>" --write --json
```

Saved diagnostics contain compact excerpts and live under
`.nogra/runtime/diagnostics/transcript/`. Historical
`.nogra/runtime/quality/` receipts are not read, upgraded or deleted.

## Output

Return:

- selected transcript identity and source;
- non-authoritative signal count;
- each observation and its limitations;
- `authority: none`;
- `controlEffects`;
- whether the result was previewed or explicitly saved.

Never present the result as a grade or as proof that a user did or did not give
GO.
