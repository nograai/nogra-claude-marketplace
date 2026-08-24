---
name: nogra-authorize
description: Authorize a risk boundary class as a standing GO for the running Nogra intent — starting a minimal intent (user-confirmed) when none is running. Use when the user runs /nogra:authorize or gives a direct GO for a boundary (git-history, production-deploy, etc.) without a full brief.
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

Within that file, write only `gate.authorize`, `gate.grants` and the `updatedAt` timestamp. Do
not modify `gate.nonGoals`, `objective`, `currentPlan`, or any other field. The
single exception: creating a fresh minimal intent when none exists (below),
after the user's explicit confirmation.

If `.nogra/runtime/active-intent.json` is missing or its status is not `active`,
say there is no running intent — then offer to start a minimal one binding the
requested boundary (see "Starting a minimal intent"). Only write it after the
user confirms. If the file exists but is invalid JSON, stop and ask before
replacing it — never overwrite silently.

## Starting a minimal intent

When the user asks to authorize a boundary and no intent is running, offer to
start one. On explicit confirmation, write `.nogra/runtime/active-intent.json`:

```json
{
  "schema": "nogra.activeIntent.v1",
  "status": "active",
  "startedAt": "<now ISO>",
  "updatedAt": "<now ISO>",
  "objective": "<the user's own words for what this GO is for, one line>",
  "gate": {
    "authorize": ["<boundary>"],
    "scope": ["<concrete command or path patterns, only if the user named them>"]
  }
}
```

- `objective` comes from the user's words — ask one short question if you have
  nothing to quote. Never invent it.
- `scope` bounds where the authorization applies (e.g. `vercel --prod`,
  `projects/site/**`). Leave it out rather than guess: without a declared
  scope the gate skips the ask for that class but never auto-allows; with a
  matching scope (and `gate.autoApprove` on in `.nogra/config.json`) it can
  emit an allow. Say which of the two the user is getting.
- **Glob semantics — command patterns need `**`.** A single `*` never crosses
  `/` (correct for path patterns, a silent trap for commands): `npx wrangler
  deploy*` does NOT match `npx wrangler deploy -c ops/site/wrangler.toml`,
  because the argument contains slashes. Write command patterns with `**`
  (`npx wrangler deploy**`, `git **`). Measured 20/08: an intent fell through
  on exactly this, silently — the gate asked as if no scope existed.
- Closing it later: set `status` to `done` (or delete the file). Mention this
  in the receipt so the standing GO never outlives the work invisibly.

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
<product-class>       edits under a path the workspace protects via `gate.pathClasses` (e.g. your product repo)
```

If the user names something outside this list, do not invent a class. Show the
recognized list and ask which one they mean.

## Commands To Support

Interpret these forms:

- `/nogra:authorize` -> show the running intent's authorized boundaries and the
  recognized list. No write.
- `/nogra:authorize <boundary>` -> add `<boundary>` to `gate.authorize`. If no
  intent is running, offer to start a minimal one binding `<boundary>` (see
  above); write only after the user confirms.
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

When a minimal intent was just created, lead with that instead:

```text
Started a minimal intent ("<objective>") and authorized production-deploy.
Scope: vercel --prod. Close it with status "done" when the work lands.
```

```text
Authorized git-history for the running intent.
The gate now allows it without asking. Undo with /nogra:authorize revoke git-history.

Nogra authorize
Intent      Trial the active-intent runtime ...
Authorized  git-history, production-deploy
Recognized  git-history, production-deploy, instruction-surface,
            data-migration, billing, destructive-write, <product-class>
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

## Ask-grants — the operator's words as the receipt

An ask-grant is the lighter-still path: the operator's LITERAL words in chat
("gider du køre det fix"), bound to ONE boundary class, with an optional scope
and a TTL. The gate then treats the class like `authorize` (no scope = skip
its ask, never allow; scope match + `gate.autoApprove` = allow) and stamps
every use as ONE ledger line (`ask-grant-used`) that quotes the ask verbatim —
so the receipt IS the intent, readable in the clock afterwards.

Record it with the deterministic hand, never by editing JSON by hand:

```bash
node "<plugin-root>/scripts/nogra-grant.mjs" add --root "<workspace-root>" \
  --class destructive-write --scope "rm -rf ~/.bun**" --ttl turn \
  --ask "gider du køre det fix vi manglede så champ for at kunne bruge bun"
node "<plugin-root>/scripts/nogra-grant.mjs" list   --root "<workspace-root>"
node "<plugin-root>/scripts/nogra-grant.mjs" revoke --root "<workspace-root>" --id <grant-id>
```

Rules — each one is a door that stays closed:

- **The ask is quoted, never paraphrased.** `--ask` carries the operator's own
  words. A grant covers what those words say; the Manager's own additions (a
  cleanup, a "while I'm here") still ask. Measured 21/08: "kør fixet for bun"
  covered the install, not the `rm -rf ~/.bun` that followed — the gate asked,
  and that was correct.
- **Echo the binding in chat BEFORE acting.** The Manager says what it binds
  ("binder: destructive-write · scope `rm -rf ~/.bun**` · ttl turn — dine ord:
  '…'") and then records it. Intent and action meet in Nogra before the risk,
  where the operator can still say no.
- **Never automatic.** The runtime does not derive grants from prompt text —
  no classifier, no scoring, no "it sounded like a yes". The producing hand is
  the operator's `/nogra:authorize` or the Manager's explicit echo. Nogra
  invites; it does not enforce.
- **TTL is the default shape.** `turn` dies at the operator's next prompt
  (the UserPromptSubmit hook ticks it), `next` at the one after, `N turns`,
  `30m`/`1h`/`1d`, or `intent` (lives with the intent, like `authorize`).
  Prefer the shortest TTL that covers the work; `revoke` closes one early.
- **gate-arming can never be granted** — dropped at normalize, unreachable by
  evaluation order, and refused by the CLI. A live human approval is the only
  door to the gate's own rules.
- **Scope globs follow the authorize rule:** command patterns need `**`
  (`rm -rf ~/.bun**`, `npx wrangler deploy**`).

The receipt to the operator: grant id, class, scope, ttl and the quoted ask —
and whether the door is skip-only or allow-capable in this workspace.

