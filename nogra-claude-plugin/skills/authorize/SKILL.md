---
name: nogra-authorize
description: Authorize a risk boundary class for the running Nogra intent so the convergence gate treats it as an explicit standing GO. Use when the user runs /nogra:authorize, or gives a direct GO for a boundary (git-history, production-deploy, instruction-surface, etc.) without writing a full brief.
---

# Nogra Authorize

Record an explicit GO for a risk boundary class into the running intent, so the
convergence gate allows that class without asking on every action. The running
intent is the standing GO; this skill binds a boundary to it.

This is the lighter path to authorization. The heavier path is a full
`/nogra:brief` + `/nogra:dispatch`. Use authorize when the user has already
given a clear GO for a specific boundary and a full brief would be overkill.

## Boundary

Read and write only `.nogra/runtime/active-intent.json`. App files, `.claude/`,
`CLAUDE.md`, `.nogra/config.json`, package files, hooks, plugin files and agent
spawning stay outside this skill.

Within that file, write only `gate.authorize` and the `updatedAt` timestamp. Do
not modify `gate.nonGoals`, `objective`, `currentPlan`, or any other field.

If `.nogra/runtime/active-intent.json` is missing or its status is not `active`,
say there is no running intent to authorize against, suggest `/nogra:setup` or
starting an intent, and stop. If the file is invalid JSON, stop and ask before
replacing it.

## What authorize means

- It is **per boundary class**, **per running intent**, **reversible**, and
  **recorded** (written into the intent state with an updated timestamp).
- It is **not** a blanket allow. It opens exactly the named classes, nothing
  else. Every other risk boundary still asks.
- It does **not** override a declared non-goal. The gate checks non-goals first;
  if a class is both authorized and a non-goal, the non-goal wins and the action
  still blocks. Warn the user instead of silently overriding.
- It only affects this workspace's local `.nogra` state. Anyone who never runs
  authorize sees unchanged default behavior.

## Recognized boundary classes

Authorize only these exact class names — they are what the gate matches:

```text
git-history          git push/tag/reset/clean/merge/rebase/checkout/restore
production-deploy     vercel/wrangler/firebase/netlify deploy, --prod
instruction-surface   CLAUDE.md, AGENTS.md, hooks, skills, plugin/settings files
data-migration        supabase/prisma db push, migrate, reset; psql mutations
billing               stripe/customer/email send, charge, refund
destructive-write     rm -rf, find -delete/-exec
boligscout            edits under a boligscout path
```

If the user names something outside this list, do not invent a class. Show the
recognized list and ask which one they mean.

## Commands To Support

Interpret these forms:

- `/nogra:authorize` -> show the running intent's authorized boundaries and the
  recognized list. No write.
- `/nogra:authorize <boundary>` -> add `<boundary>` to `gate.authorize`.
- `/nogra:authorize revoke <boundary>` -> remove `<boundary>` from
  `gate.authorize`.
- `/nogra:authorize clear` -> empty `gate.authorize`.

## Write Rules

When adding, revoking or clearing:

1. Read `.nogra/runtime/active-intent.json`.
2. If there is no `gate` object, create `gate: { "authorize": [] }`. Do not
   scaffold `gate.nonGoals`; the gate treats an absent `gate.nonGoals` as empty,
   and creating non-goals is not this skill's job. Leave any existing top-level
   `nonGoals` prose array untouched; the gate reads `gate.nonGoals`, which is
   separate.
3. Normalize the boundary to lowercase and validate it against the recognized
   list. Refuse unknown classes and show the valid ones.
4. Apply the change to `gate.authorize` only: add (deduplicated), remove, or
   empty. Do not touch `gate.nonGoals` here.
5. If the boundary is also present in `gate.nonGoals`, warn that the non-goal
   pre-check runs first and will still block it; authorizing is not enough, so
   the user must revisit the non-goal first. Do not silently override the
   non-goal.
6. Preserve every other key (`objective`, `currentPlan`, `currentBlock`,
   `doneWhen`, `nonGoals`, `changePolicy`, `startedAt`, `schema`, `project`,
   and any unknown keys). Set `updatedAt` to the current ISO timestamp.
7. Write two-space JSON with a trailing newline.
8. Surface the receipt below.

## Receipt Shape

Keep it short. Start with one confirmation line, then the state:

```text
Authorized git-history for the running intent.
The gate now allows it without asking. Undo with /nogra:authorize revoke git-history.

Nogra authorize
Intent      Trial the active-intent runtime ...
Authorized  git-history, production-deploy
Recognized  git-history, production-deploy, instruction-surface,
            data-migration, billing, destructive-write, boligscout
```

For a bare `/nogra:authorize` with no change, skip the confirmation line and
show only the state block.

## Safety Notes

- Authorize is reversible at any time (`revoke` / `clear`).
- It leaves the `gate.mode` setting in `.nogra/config.json` as it is. With
  advisory gating an authorized class is simply skipped instead of asked about;
  with hard gating it is allowed instead of denied.
- The written `gate.authorize` is local workspace state and is git-trackable, so
  the standing GO stays auditable.
