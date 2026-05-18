---
name: offer
description: First Nogra routing move before implementation. Use before frontend/design/build/refactor/debug/workspace-changing skills when a request may deserve a Nogra brief due to scope, risk, ambiguity, multiple files, browser/screenshot/build/test evidence, verification, deploy, auth, data, production impact, or hard-to-revert work.
user-invocable: false
---

# Nogra Offer Gate

This skill is the local routing gate before Nogra ceremony. It may be invoked
automatically. It must not call Nogra MCP tools, write files, draft a brief,
spawn agents or run project-changing commands.

Nogra calls are authority gates, not ambient polling. Detecting that work might
benefit from Nogra is local Claude judgment; it is not a hosted call.

## First Action

If the user has not explicitly asked for Nogra, `/nogra:brief`, verification,
dispatch, or a brief flow, your entire response must be one of:

- a brief/direct offer, then stop
- direct work, only when the score is below threshold

If the user explicitly asks for direct work, skip brief, no ceremony, or "uden
Nogra", treat that as a hard direct override even if sensitivity is high.

Do not call MCP. Do not draft the brief. Do not say you are writing the brief.

## Score

Read `.nogra/config.json` `routingPolicy` when available:

- `sensitivityPercent`: default 50
- `sensitivityStepPercent`: default 5
- `autoOfferThreshold`: default 60
- `strongOfferThreshold`: default 80
- `offerOncePerIntent`: default true
- `topicGate`: default true
- `defaultLanguage`: default `en`
- `translationFallback`: default `claude-current-prompt`
- `dictionary`: signal-specific local phrases checked after the English-first
  core

Only score topic-related workspace work: building, changing, fixing,
refactoring, deploying, designing, verifying, or deciding something in the
workspace. If the request is pure chat, explanation, status, or Q&A, do not
offer Nogra.

Language handling is English-first plus dictionary. The hook checks stable
English/technical terms first, then local `dictionary` terms such as translated
verbs, direct overrides and verification words. `translationFallback` means
Claude may use its own current-prompt understanding when dictionary matching is
insufficient. It is not an external translation call.

Score signals:

- +25 build, refactor, debug, or behavior change
- +20 multiple files or unknown blast radius
- +20 needs test, screenshot, diff, browser check, evidence, or verification
- +20 user asks whether work is done or wants a claim checked
- +15 visual, quality-critical, database, auth, payment, deploy, production,
  or security work
- +10 unclear scope, user uncertainty, or hard-to-revert work
- -30 one obvious low-risk file edit
- hard direct override when the user asks for direct/simple/no ceremony
- -50 pure Q&A

Treat `sensitivityPercent` as the user-facing heat control. Higher sensitivity
lowers effective thresholds and makes offers more likely. Lower sensitivity
raises thresholds and keeps work more direct. Default `50%` maps to effective
thresholds `60/80`. Values snap to `sensitivityStepPercent`, default `5%`.

If the score is below the effective auto threshold, work directly and do not
call Nogra.

If the score reaches the effective auto threshold, offer and stop:

```text
This has enough scope that a Nogra brief would help. I can write the brief
first, or work directly if you prefer.
```

If the score reaches the effective strong threshold, recommend more firmly and
stop:

```text
This is scoped enough that I recommend a Nogra brief before work starts. I can
write the brief first, or work directly if you prefer.
```

Wait for the user's choice. If the user accepts the brief flow, use the
`nogra:brief` skill. If the user chooses direct work, do not call Nogra.
