---
name: off
description: Turn off Nogra automatic routing offers for the current workspace. Use when the user says /nogra:off, /nogra off, disable Nogra, or a local dictionary toggleOff alias.
---

# Nogra Off

For normal `/nogra:off`, the routing hook already set `.nogra/config.json`
`routingPolicy.autoOfferEnabled` to `false`. If no hook context is present, set
that field yourself.

Preserve existing `routingPolicy` fields. Do not call Nogra MCP, draft a
brief, dispatch, verify or spawn an agent.

Return only:

```text
Nogra automatic offers are off. Explicit /nogra:* commands still work.
```
