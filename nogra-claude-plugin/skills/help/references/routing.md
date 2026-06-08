# Nogra Routing Configuration

Nogra core is pull-first.

## Defaults

- `defaultLanguage`: en
- `translationFallback`: claude-current-prompt

## Routing Authority

Nogra does not decide whether ordinary work deserves a brief. Nogra is a
workflow the user can pull when they want brief, approval, dispatch, evidence
and verification discipline.

Use Nogra when the user explicitly asks for it:

- `/nogra:brief`
- `/nogra:dispatch`
- `/nogra:verify`
- a plain-language request for a Nogra brief or workflow
- an explicit instruction to do the work through Nogra

Normal scoped work stays direct unless the user pulls Nogra. Examples that stay
direct by default: blog/content updates, contact forms, UI work, refactors,
feature implementation, explanation, Q&A and routine verification.

Irreversible, production, billing, data, permissions or secrets work still
requires judgment and Claude Code's native permission model. Nogra core does
not intercept tool calls or replace provider permissions.

## Hooks

`SessionStart` adds compact boot and policy context when `.nogra/config.json`
exists.

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
