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
- `/nogra:anchor`
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

Irreversible, production, billing, data, permissions, secrets or git-history
work still requires judgment and Claude Code's native permission model. The
local runtime includes a narrow deterministic `PreToolUse` convergence gate for
those risk boundaries: it asks when a permanent-risk tool call has no
current dispatch receipt. It may also emit a visible Nogra match review for
read-only public fetches or risk-boundary actions already matched to the current
dispatch receipt. Match reviews add context only; they do not send
`permissionDecision: allow`, score prompts, start Nogra flows or replace
provider permissions.

Full route details live in `references/router.md`. The five-anchor local index
for risk intake, behavior score, connections/risk registry, decision shape and
expansion guidance lives in `references/index.md`.

## Hooks

`SessionStart` emits the bounded `nogra.boot.context.v2` state:
`fresh`, `detected`, `focused` or `resumed`. Checkpoint existence is detection
only; only Claude Code's native `resume` source can produce `resumed`, and no
boot state grants GO or loads checkpoint contents.

`PostCompact` projects `recovering` and adds only a thin continuity pointer.
It does not authorize continuation or re-emit workflow policy.

The ordered SessionStart memory adapter performs an optional sync pull and
then reads USER/bound state from the same `nogra.memory.resolution.v1`
directory. Unresolved or disabled memory is never mutated.

`SessionEnd` updates the local session anchor silently when enough session
metadata is available.

`UserPromptSubmit` may add project-focus context when the user clearly selects
an indexed project from a workspace hub.

`PreToolUse` asks only at deterministic git/action risk boundaries when there is
no current dispatch receipt. It can emit non-blocking match-review context for
conservative read-only public fetches and receipt-matched risk actions.

Nogra core hooks do not score prompts, emit proactive brief prompts, change
config, draft briefs, dispatch, verify, spawn agents, or read full transcripts.

## Language

Language handling is English-first. `defaultLanguage` tells Claude the
workspace's preferred language. `translationFallback:
claude-current-prompt` means Claude may use its own current-prompt
understanding directly.
