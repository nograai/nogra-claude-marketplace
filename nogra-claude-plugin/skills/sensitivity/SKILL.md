---
name: sensitivity
description: Adjust Nogra automatic routing sensitivity for the current workspace. Use when the user says /nogra:sensitivity, asks to set Nogra sensitivity/heat to a percent, or asks Nogra to offer more or less often.
---

# Nogra Sensitivity

Adjust automatic Nogra offer sensitivity by updating only local
`.nogra/config.json`.

This does not call hosted Nogra and does not start a brief. It only changes the
local heat that hooks use before work starts.

Do not call Nogra MCP tools for this. Do not draft a brief. Do not dispatch.

## Meaning

`sensitivityPercent` is the user-facing heat control:

- `0%`: very conservative, almost explicit-only.
- `50%`: balanced default, effective thresholds `60/80`.
- `100%`: eager, offers Nogra for many topic-related workspace tasks.

Higher sensitivity lowers effective thresholds. Lower sensitivity raises them.
Values snap to `sensitivityStepPercent`; default step is `5%`. Use `10%` for
coarser calibration passes.

Sensitivity controls proactive Nogra offers. It does not override explicit user
intent. Extension commands such as `/nogra-*` are owned by their installed
extension plugins and are not converted into Nogra brief offers.

Use this formula for derived legacy thresholds:

```text
autoOfferThreshold = round(95 - sensitivityPercent * 0.7)
strongOfferThreshold = min(100, autoOfferThreshold + 20)
```

Examples:

```text
0%   -> 95/100
50%  -> 60/80
65%  -> 50/70
100% -> 25/45
```

## Steps

1. Read `.nogra/config.json`.
2. If the file is missing, say Nogra is not initialized in this folder and stop.
3. Parse the requested percent and clamp it to `0..100`.
   - If the user says "more sensitive" without a number, add 10 percentage
     points.
   - If the user says "less sensitive" without a number, subtract 10 percentage
     points.
   - If there is no number or direction, ask for a percentage.
4. Snap the result to `routingPolicy.sensitivityStepPercent` if present,
   otherwise to `5%`. Examples: with step `5`, `73%` becomes `75%`; with step
   `10`, `73%` becomes `70%`.
5. Update only `routingPolicy` fields:

```json
"routingPolicy": {
  "sensitivityPercent": 70,
  "sensitivityStepPercent": 5,
  "autoOfferThreshold": 46,
  "strongOfferThreshold": 66
}
```

Preserve existing `routingPolicy` fields such as `autoOfferEnabled`,
`offerOncePerIntent`, `topicGate`, `defaultLanguage`, `translationFallback`,
`dictionary`, `scoring` and unknown keys.

6. Write the JSON back with pretty two-space formatting and a trailing newline.
7. Return a short confirmation:

```text
Nogra sensitivity is now 65% (effective thresholds 50/70). The statusline will show the updated heat.
```

Always report the thresholds that were just written to `.nogra/config.json`.
Do not reuse threshold values from an example after snapping a different
percentage.
