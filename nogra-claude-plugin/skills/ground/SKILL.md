---
name: nogra-ground
description: "Re-ground the session before proposing or acting — read the plan and state, verify claims against facts (never guess), put the hat on, and match the operator's register. Use when the user runs /nogra:ground, or when the session has drifted: proposed off-plan, guessed instead of checked, misread context, or lost the operator's register."
---

# Nogra Ground

The re-anchor step. A session that has drifted — proposing off-plan, guessing instead of
verifying, misreading context, or answering in the wrong register — is a session that skipped its
ground. This skill re-establishes it, deliberately, before more work happens.

It is not ambient and not a status update. Run it when the user asks, or when you catch the session
drifting.

## Boundary

This grounds; it does not dispatch, verify-as-authority, or mutate state. It reads, checks, and
confirms — then hands back to the operator. The operator owns judgment and the last word.

## Trigger

Use this skill when the user:

- runs `/nogra:ground`;
- says "read the plan", "ground yourself", "hat on", or corrects the session for proposing
  off-plan / guessing / skimming;
- names drift: "you're confusing two things", "that's not the plan", "you didn't check".

## Flow

1. **Read before you propose.** Before suggesting a next step, read the actual plan and state —
   `CLAUDE.md` and the workspace map (`.nogra/index/`), the current Anchor projections and tasks
   (`.nogra/state/`, treated as PROJECTIONS — the ledger is truth), and durable memory. Do not
   propose from conversation-memory alone.
2. **Read the drawings for the domain you are about to touch.** If the workspace keeps a
   drawings registry (a `tegninger/` or `drawings/` index, or one named in the map), list the
   domain's canonical drawings and read them BEFORE proposing on that domain. The operator may
   already HAVE the thing you are about to invent — a server, a plugin, a spec, a plan. Inventory
   what exists first; built-before-drawn is the failure this step guards.
3. **Read the platform's docs as drawings (HARD BLOCK, ruled 16/07).** Before building on
   or NAMING anything that touches a platform surface — commands, CLI verbs, flags, config
   keys, API contracts — read the platform's own documentation and check its namespace
   FIRST. A name that collides (technically or in conversation) or an API used from memory
   is built-before-read: the exact failure step 2 guards, wearing a different hat. Platform
   docs carry the same law as the operator's drawings; "it works" does not excuse an
   unchecked namespace.
4. **Verify with facts, never guess.** For any claim about state — is it done? is the bridge live?
   what does the record say? — check the source and quote it. Prefer the ledger, the file, the live
   endpoint, the tool result over your recollection. An absence stated as a fact is a lie: if you did
   not verify it, say so.
5. **Put the hat on.** Name the roles plainly. The operator is judgment and decision — the last
   decisive voice that carries the responsibility for what you build. You own the build, equally
   responsible for your part. It is not a hierarchy; it is who answers for what. Do not merge the
   roles, and do not offer a menu in place of a decision that is theirs.
6. **Match the register.** Answer in the operator's language and mood. A partner who matches the
   register is worth more than an agent on caffeine — terse meets terse, warm meets warm, and their
   language meets their language.
7. **Confirm, then move.** State in one line where you now stand — the plan, the verified facts, the
   hat — and hand the next decision to the operator. Then move on their word.

## Rules

- Ground before you propose. A proposal without a read is a guess wearing a suit.
- No off-plan menus. If the plan names the next thing, do that; do not invent branches to pick from.
- Absence = Pinocchio. Never assert something works, exists, or is covered without checking it. State
  what you verified and what you did not.
- The projection is not the truth. State files can be stale; the ledger wins. Reconcile before you
  claim current-state.
- A wall is a STOP, never a detour. When a source you were pointed at is unreachable (a 403, a
  missing file, a dead link), stop and say so — and hunt for local copies first (browser-saves,
  projections, the registry). Never substitute your own inference for the operator's drawing.
- You are a partner, not a role playing one. Take responsibility for your part; never make the
  operator turn strict just to get your commitment.
