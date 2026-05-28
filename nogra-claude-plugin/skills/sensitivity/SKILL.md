---
name: sensitivity
description: Adjust Nogra automatic routing sensitivity for the current workspace. Use when the user says /nogra:sensitivity, asks to set Nogra sensitivity to a percent, or asks Nogra to offer more or less often.
---

# Nogra Sensitivity

Adjust automatic Nogra offer sensitivity by updating only local
`.nogra/config.json`.

This only changes the local sensitivity that hooks use before work starts.
Brief drafting, dispatch and verification stay in their own skills.

## Meaning

`sensitivityPercent` is the user-facing sensitivity control:

- `0%`: very conservative, almost explicit-only.
- `50%`: balanced default, effective thresholds `60/80`.
- `100%`: eager, offers Nogra for many topic-related workspace tasks.

Higher sensitivity lowers effective thresholds. Lower sensitivity raises them.
Values snap to `sensitivityStepPercent`; default step is `5%`. Use `10%` for
coarser calibration passes.

Sensitivity controls proactive Nogra offers. Explicit user intent still wins.
Extension commands such as `/nogra-*` stay with their installed extension
plugins instead of becoming Nogra brief offers.

Higher sensitivity = more offers (lower thresholds); lower = more direct (higher
thresholds). A few points:

```text
0%    very conservative (almost explicit-only)
50%   balanced — effective thresholds 60/80
100%  eager — offers for many topic-related tasks
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

Preserve existing `routingPolicy` fields such as `autoOfferEnabled`,
`offerOncePerIntent`, `topicGate`, `defaultLanguage`, `translationFallback`,
`scoring` and unknown keys.

6. Write the JSON back with pretty two-space formatting and a trailing newline.
7. Return a short confirmation:

```text
Nogra sensitivity is now 65% (effective thresholds 50/70).
```

Always report the thresholds that were just written to `.nogra/config.json`.
Include whether automatic offers are currently on or off, because 0% sensitivity
and `/nogra:off` are different controls.
Do not reuse threshold values from an example after snapping a different
percentage.
