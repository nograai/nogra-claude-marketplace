---
name: sensitivity
description: Adjust Nogra legacy routing sensitivity fields for the current workspace. Use when the user says /nogra:sensitivity or asks to inspect/change Nogra sensitivity.
---

# Nogra Sensitivity

Adjust legacy Nogra sensitivity fields by updating only local
`.nogra/config.json`.

This does not widen proactive Nogra offers. Current automatic routing is
pull-first plus a narrow irreversible-boundary tripwire. Brief drafting,
dispatch and verification stay in their own skills.

## Meaning

`sensitivityPercent` is a compatibility value for legacy status/telemetry:

- `0-35%`: conservative.
- `40-65%`: balanced default.
- `70-100%`: eager.

Sensitivity is not a precise routing formula, and it does not turn ordinary
work into proactive Nogra offers. Values snap to `sensitivityStepPercent`;
default step is `5%`. Use `10%` for coarser calibration passes.

Explicit user intent still wins. Extension commands such as `/nogra-*` stay
with their installed extension plugins instead of becoming Nogra brief offers.

The visible tripwire boundaries remain narrow regardless of this value. A few
compatibility points:

```text
0%    conservative legacy posture
50%   balanced legacy posture
100%  eager legacy posture
```

## Steps

1. Read `.nogra/config.json`.
2. If the file is missing, say Nogra is not initialized in this folder and stop.
3. Parse the requested percent and clamp it to `0..100`.
   - If the user says "more sensitive" without a number, add 10 percentage
     points.
   - If the user says "less sensitive" without a number, subtract 10 percentage
     points.
   - If there is no number or direction, show the current sensitivity with one
     sentence of context, then ask for a percentage.
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

Keep writing the threshold fields for compatibility with older config/status
surfaces. Report them as legacy heat telemetry, not routing authority.

Preserve existing `routingPolicy` fields such as `autoOfferEnabled`,
`offerOncePerIntent`, `topicGate`, `defaultLanguage`, `translationFallback`,
`scoring` and unknown keys.

6. Write the JSON back with pretty two-space formatting and a trailing newline.
7. Return a short confirmation:

```text
Nogra sensitivity is now 65% (balanced legacy posture; heat thresholds 50/70). Automatic routing remains pull-first plus irreversible tripwire.
```

Always report the posture and legacy thresholds that were just written to
`.nogra/config.json`.
Include whether automatic offers are currently on or off, because 0% sensitivity
and `/nogra:off` are different controls.
Do not reuse threshold values from an example after snapping a different
percentage.
