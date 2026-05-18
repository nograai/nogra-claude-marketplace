---
name: on
description: Turn on Nogra automatic routing offers for the current workspace. Use when the user says /nogra:on, /nogra on, enable Nogra, or a local dictionary toggleOn alias.
---

# Nogra On

For normal `/nogra:on`, the routing hook already set `.nogra/config.json`
`routingPolicy.autoOfferEnabled` to `true`. If no hook context is present, set
that field yourself.

Preserve existing `routingPolicy` fields. Do not call Nogra MCP, draft a
brief, dispatch, verify or spawn an agent.

Return only:

```text
Nogra automatic offers are on.
```
