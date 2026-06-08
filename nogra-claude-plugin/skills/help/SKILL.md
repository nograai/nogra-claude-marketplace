---
name: help
description: Explain and use Nogra in Claude Code. Use when the user asks what Nogra is, how to start, how to write a brief, how dispatch or evidence works, or says they want Nogra help in a workspace.
---

# Nogra Help

Use this skill to answer Nogra help questions and choose the right Nogra flow.
Keep the response compact and user-facing.

Read `references/usage.md` as the source for general help content. For routing
and language defaults, read `references/routing.md`. For runtime,
model/effort preference and status/version details, read
`references/runtime.md`. Summarize the relevant section instead of dumping the
full reference unless the user explicitly asks for the full text.

If the current folder is not Nogra-enabled yet, guide the user toward
`/nogra:setup` or the `setup` skill. If the user is asking about an existing
project, prefer the setup-then-adapt explanation from the reference.

Do not print raw runtime payloads, schema contracts, handoff prompts,
transport receipts or debug internals unless the user explicitly asks for
debug output. Those records belong in `.nogra/`.
