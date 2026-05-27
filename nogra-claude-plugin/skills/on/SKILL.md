---
name: on
description: Turn on Nogra automatic routing offers for the current workspace. Use when the user says /nogra:on, /nogra on, enable Nogra, or turn on Nogra.
---

# Nogra On

This skill is the actor for `/nogra:on`, `/nogra on` and natural-language
enable requests. Hooks may detect the request and add
context, but hooks do not write config and do not block the user prompt.

Read `.nogra/config.json` and set `routingPolicy.autoOfferEnabled` to `true`.
If `.nogra/config.json` is missing, tell the user Nogra is not initialized in
this folder and do not write files.

Preserve existing `routingPolicy` fields. This toggle only updates local
config; brief drafting, dispatch, verification and agent spawning stay in their
own skills.

Return only:

```text
Nogra automatic offers are on.
```
