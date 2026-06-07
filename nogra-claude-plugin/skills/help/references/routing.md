# Nogra Routing Configuration

This reference describes when Nogra should interrupt ordinary workspace work.
The model is pull-first plus a narrow irreversible-boundary tripwire.

## Defaults

- `sensitivityPercent`: 50
- `sensitivityStepPercent`: 5
- `autoOfferThreshold`: 60
- `strongOfferThreshold`: 80
- `offerOncePerIntent`: true
- `autoOfferEnabled`: true
- `defaultLanguage`: en
- `translationFallback`: claude-current-prompt
- `scoring`: legacy local heat signals for telemetry and regression tests

The threshold and sensitivity fields stay in config for compatibility and
telemetry. They are not broad routing authority.

## Routing Authority

Nogra does not decide whether ordinary work deserves a brief. Nogra is a system
Claude can align to, not a prompt judge. Regex matches executable danger, not
meaning.

Automatic routing has only three proactive jobs:

1. Respect `/nogra:on` and `/nogra:off`.
2. Keep explicit `/nogra:*` commands available on pull.
3. Interrupt only when an actual tool input crosses an irreversible or
   externally expensive command/file boundary.

Normal scoped work stays direct unless the user pulls Nogra. Examples that
should stay direct by default: blog/content updates, contact forms, UI work,
refactors, feature implementation, explanation, Q&A and routine verification.

Nogra invites; it does not enforce. A tripwire creates a visible direct/Nogra
choice, not a forced brief.

## Tripwire Boundaries

The tripwire class is intentionally small:

- production deploy or externally visible release
- data migration commands, destructive SQL, or data-loss commands
- auth, security, permissions, or secrets
- payment, Stripe, checkout, billing, or subscription changes
- destructive bulk edits/deletes
- external customer-impacting sends, webhooks, or integrations

When a tool call crosses one of these boundaries, surface the direct/Nogra
choice before tools. If the user chooses direct, proceed directly for that task
while Nogra stays on. Natural-language descriptions of these topics remain
Claude judgment, not regex triggers.

## Hooks

`UserPromptSubmit` does not emit tripwires from natural language. It handles
toggle/pull/focus behavior and writes bounded heat telemetry.

`PreToolUse` is the last-minute safety rail. It inspects the actual tool input,
so promptless or vague work can still be caught right before commands or file
writes such as production deploys, migrations, destructive deletes, secret/env
writes or billing commands.

If `autoOfferEnabled` is false, do not proactively emit tripwires for ordinary
workspace prompts or tools. Explicit `/nogra:*` commands still work.

## Legacy Heat Signals

The local heat fields remain for observability and regression testing:

- `createIntent`: default +25
- `productSurface`: default +20
- `evidenceNeed`: default +20
- `completionClaim`: default +20
- `qualityCritical`: default +15
- `riskyDomain`: default +15
- `ambiguity`: default +10
- `lowRiskEdit`: default -30
- `singleFileLowScope`: default -15
- `directOverride`: default -40 in old configs
- `pureQuestion`: default -50

Do not create a second score, tier table, threshold table or automatic
high/medium/low routing rule. Heat is telemetry, not UX.
