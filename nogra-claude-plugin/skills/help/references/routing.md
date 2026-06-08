# Nogra Routing Configuration

Nogra core is pull-first.

## Defaults

- `defaultLanguage`: en
- `translationFallback`: claude-current-prompt

## Routing Authority

Nogra does not decide whether ordinary work deserves a brief. Nogra is a
workflow the user can pull when they want brief, approval, dispatch, evidence
and verification discipline.

## Thin Intent Router

The router is a thin intent index, not a gate. It maps explicit user intent to
the right Nogra skill and otherwise stays silent.

Use Nogra when the user explicitly asks for it:

- `/nogra:brief`
- `/nogra:dispatch`
- `/nogra:verify`
- `/nogra:status`
- `/nogra:settings`
- `/nogra:update`
- a plain-language request for a Nogra brief or workflow
- an explicit instruction to do the work through Nogra

Normal scoped work stays direct unless the user pulls Nogra. Examples that stay
direct by default: blog/content updates, contact forms, UI work, refactors,
feature implementation, explanation, Q&A and routine verification.

If the user is about to start unusually large autonomous work without asking
for Nogra, Claude may give one short non-blocking nudge before the run starts:
"This is large enough that a Nogra brief would help. Want me to shape it
first?" Do not repeat it after the user continues direct. Do not convert this
into prompt scoring or keyword scoring.

Irreversible, production, billing, data, permissions or secrets work still
requires judgment and Claude Code's native permission model. Nogra core does
not intercept tool calls or replace provider permissions.

Full route details live in `references/router.md`.

## Hooks

`SessionStart` adds a small boot context on startup or clear, and a thinner
continuity pointer on resume. It does not run on compact.

`PostCompact` adds only a thin continuity pointer after context compaction:
workspace id, workspace root, ledger watermark and checkpoint freshness. It does
not re-emit workflow policy.

`SessionEnd` updates the local session anchor silently when enough session
metadata is available.

`UserPromptSubmit` may add project-focus context when the user clearly selects
an indexed project from a workspace hub.

Nogra core hooks do not score prompts, emit proactive brief prompts, inspect tool
calls, change config, draft briefs, dispatch, verify, spawn agents, or read
full transcripts.

## Language

Language handling is English-first. `defaultLanguage` tells Claude the
workspace's preferred language. `translationFallback:
claude-current-prompt` means Claude may use its own current-prompt
understanding directly.
