---
name: nogra-decide
description: Record an operator decision as a durable, receipted record — decision, why, alternatives considered, owner and linked evidence, appended to the workspace decision log. Use when the user runs /nogra:decide, locks a decision ("lås den", "that's law", "LOCK"), or asks for a ruling to be recorded so it can never be relitigated or silently drift.
---

# Nogra Decide

A decision that lives only in a conversation is a memory; a decision in the log is LAW until the
operator changes it. This skill captures the ruling in the workspace's drawn decision shape and
leaves a receipt — so "who decided what, why, and what applies now" always has an answer.

## Boundary

This records; it never decides. The OPERATOR owns every ruling and every name. Claude may OFFER
candidate wordings or names — the operator picks. A decision is appended, never edited or deleted;
a superseding ruling gets its own entry that names what it replaces.

## Trigger

Use this skill when the user:

- runs `/nogra:decide`;
- locks a ruling in conversation ("det er LOV", "lås den", "LOCK it") and expects it recorded;
- asks what applies ("hvilken dom gælder?") — then READ the log instead of writing.

## Flow

1. **Capture the ruling in the drawn shape.** The decision log (`.nogra/state/DECISIONS.md`)
   defines the shape — use it exactly:

   ```text
   Date:
   Decision:
   Why:
   Alternatives considered:
   Owner:
   Linked brief/run/evidence:
   ```

   The Decision line is the operator's ruling, in their words where they gave words. Why carries
   the reasoning that makes drift visible later. Alternatives show what was weighed. Owner is the
   human who ruled. Linked evidence points at the ledger watermark, brief, run or drawing that
   grounds it.

2. **Offer, never invent.** If the ruling needs a name (a verb, a skill, an identifier), present
   English-first candidates and wait for the operator's pick. Names are product surface — the
   operator's domain.

3. **Append and receipt.** Append the entry to `.nogra/state/DECISIONS.md` (newest first under the
   current-era heading; NEVER rewrite existing entries) and log one ledger event
   (`type: "decision"`) whose summary quotes the Decision line.

4. **Apply it forward.** From this moment the decision binds: plans and briefs that touch its
   domain cite it; a proposal that contradicts it is off-plan until the operator rules again.

## Rules

- Append-only. Superseding rulings reference the entry they replace; nothing is deleted.
- The projection is not the truth: if the log and the ledger disagree, the ledger wins.
- One entry per ruling — no bundling of unrelated decisions.
- English-first for anything that names or describes code; the operator's own words are quoted
  as given.
- Recording is not relitigating: capture the ruling as made, even when Claude argued otherwise.
