---
name: off
description: Turn off Nogra automatic routing offers for the current workspace. Use when the user says /nogra:off, /nogra off, disable Nogra, or turn off Nogra.
---

# Nogra Off

This skill is the actor for `/nogra:off`, `/nogra off` and natural-language
disable requests. Hooks may detect the request and add context, but hooks do not
write config and do not block the user prompt.

Read `.nogra/config.json` and set `routingPolicy.autoOfferEnabled` to `false`.
If `.nogra/config.json` is missing, tell the user Nogra is not initialized in
this folder and do not write files.

Preserve existing `routingPolicy` fields. This toggle only updates local
config and clears stale routing telemetry by writing route-none state to
`.nogra/runtime/last-routing-score.json`; brief drafting, dispatch,
verification and agent spawning stay in their own skills.

Return only:

```text
Nogra automatic offers are off. Explicit /nogra:* commands still work.
```
