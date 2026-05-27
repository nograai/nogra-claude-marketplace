# Nogra Routing Configuration

This reference describes how Nogra decides when to offer a brief for ordinary
workspace work. Routing is local judgment plus `.nogra/config.json`
`routingPolicy`.

## Defaults

- `sensitivityPercent`: 50
- `sensitivityStepPercent`: 5
- `autoOfferThreshold`: 60
- `strongOfferThreshold`: 80
- `offerOncePerIntent`: true
- `autoOfferEnabled`: true
- `defaultLanguage`: en
- `translationFallback`: claude-current-prompt
- `scoring`: local signal weights for the catch-rule

## Sensitivity Mechanics

Treat `sensitivityPercent` as the user-facing sensitivity control. Higher sensitivity
means Claude offers Nogra more often by lowering effective score thresholds.
Lower sensitivity means Claude stays more direct by raising effective score
thresholds. The default `50%` maps to effective thresholds `60/80`. Values snap
to `sensitivityStepPercent`; default step is `5%`.

`defaultLanguage` sets the workspace language baseline. `translationFallback`
means Claude may use its own understanding of the current prompt directly when
structured routing needs judgment fallback. Transcript and history files stay
outside routing input.

## Triggers

Routing uses Nogra's structured-primary + judgment-fallback shape. The local
score path is preferred first. If hook context contains
the judgment-fallback marker, the template score missed but the prompt still has
product-work shape; use current-prompt judgment before tools. Offer Nogra for
build/change/redesign/research/verify work on a product or workspace surface;
stay direct for meta chat, pure Q&A and explicit direct/simple work.

If the score reaches the effective auto threshold, offer Nogra once and stop. If
it reaches the effective strong threshold, recommend Nogra more firmly and stop.
Wait for the user to accept the brief flow before entering the Nogra runtime or
drafting the brief. The score creates an offer; runtime calls, dispatch,
verification and subagents start from accepted user intent.

If `autoOfferEnabled` is false, do not proactively offer Nogra for ordinary
workspace prompts. Explicit `/nogra:*` commands still work.

## Topic Gate

Only score topic-related workspace work: building, changing, fixing,
refactoring, designing, verifying, or deciding something in this
workspace. For non-topic chat or pure explanation, do not offer Nogra.

Extension plugins own their own `/nogra-*` commands and hooks. If a prompt is
for an installed Nogra extension, let that extension append its behavior; do not
turn the extension request into Nogra ceremony.

## Score Signals

- `createIntent`: default +25
- `productSurface`: default +20
- `evidenceNeed`: default +20
- `completionClaim`: default +20
- `qualityCritical`: default +15
- `riskyDomain`: default +15
- `ambiguity`: default +10
- `lowRiskEdit`: default -30
- `singleFileLowScope`: default -15
- `directOverride`: default -40
- `pureQuestion`: default -50
