---
name: nogra-anchor
description: Save a factual schema-validated continuity Anchor without granting GO or claiming readiness. Use when the user runs /nogra:anchor or explicitly asks Nogra to preserve what is verified, claimed, unknown, blocked and next.
---

# Nogra Anchor

Anchor is Nogra's explicit continuity action. It complements Claude Code's
native rewind checkpoints; it does not copy them and does not treat transcript
memory as project truth.

Nogra's canonical product language is English-first. `Anchor` is the product
term. Do not introduce translated command or contract names.

## Boundary

- Anchor records state; it never grants GO, dispatches work or returns a
  readiness verdict.
- `/nogra:verify` owns evidence-based verdicts.
- Every verified/claimed completion statement must bind an active canonical
  `nogra.fact.v1` record. A verified fact additionally requires canonical
  evidence and verified operator or ship-verdict authority.
- Executor or assistant reports remain `claimedDone` until Manager has
  independently verified them.
- Missing or conflicting evidence belongs in `unknown` or `blockers`.
- Do not read a transcript to reconstruct completion state.
- Do not silently rewrite an invalid current Anchor. Surface the validation
  error and stop.

## Trigger

Use this skill only when the user:

- runs `/nogra:anchor`;
- explicitly asks Nogra to save an Anchor or factual continuity record;
- asks to preserve verified work, open state and the next owner for another
  session or machine.

An ordinary request to remember a preference belongs in native memory or the
appropriate local decision record. It does not automatically require an
Anchor.

## Flow

Claude Code Bash-safe command style: use one simple command per Bash tool call
with absolute paths. Do not use `$PWD`, `&&`, heredocs or root assignments.
Write the structured input with `Write` to a transient file under
`.nogra/runtime/`, then pass that absolute file with `--input`.

1. Resolve the exact Nogra workspace. Do not save a parent or neighboring
   workspace by accident.
2. Read the contract once:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" anchor-contract --root "<absolute-workspace-root>" --json
   ```

3. Read only the records needed to classify the current state:
   - current Anchor/checkpoint and ledger tail;
   - approved brief and approval when authority mode is `approved`;
   - referenced runs, canonical facts/evidence and verdicts;
   - current tasks and decisions when relevant.
4. Choose exactly one authority mode:
   - `approved`: provide `briefId` and `approvalId`; the runtime derives the
     objective, scope and hashes from those canonical records;
   - `direct`: use the user's explicitly chosen direct-work objective and
     scope; do not fabricate GO records;
   - `observation`: preserve read-only discovery or continuity state without
     implying execution authority.
5. Build the completion object:
   - `verifiedDone`: structured claims with the active verified `factId`,
     `observedAt`, canonical evidence path and verified provenance;
   - `claimedDone`: structured claims with an active non-verified `factId`,
     claimant, timestamp and reported, edited or tested provenance;
   - `unknown`: subject, reason, next check and source reference.
6. If a completion statement has not yet been recorded as a fact, use
   `evidence-save` first when evidence is required, then `fact-record`. Never
   derive a verified fact from MEMORY.md, USER.md, sync content or an executor
   report. Same-subject corrections require explicit `supersedes`.
7. Add material decisions, blockers, next owner and canonical
   brief/approval/run/fact/evidence/verdict references. Never place secrets in
   an Anchor; record redactions instead.
8. Leave `native.checkpointRef` absent unless a documented platform surface
   actually supplied one. Claude Code hooks currently provide session and
   transcript identity, not a native rewind checkpoint id.
9. Validate the completed input:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" anchor-validate --root "<absolute-workspace-root>" --input "<absolute-workspace-root>/.nogra/runtime/tmp-anchor-input.json" --json
   ```

10. If validation fails, stop. Do not downgrade a `verifiedDone` claim merely
   to make validation pass; correct the classification or collect evidence.
11. Save through the runtime:

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" anchor-save --root "<absolute-workspace-root>" --input "<absolute-workspace-root>/.nogra/runtime/tmp-anchor-input.json" --json
    ```

12. Remove the transient input after the runtime returns. Do not edit the
    immutable Anchor JSON, current JSON projection, Markdown projection or
    ledger event by hand.
13. Return a compact receipt: Anchor id, source watermark, verified/claimed/
    unknown counts, Git status, whether the save deduplicated or recovered,
    and the next owner.

## Runtime Guarantees

The local runtime:

- validates `nogra.anchor.v1`;
- derives approved authority from canonical brief and approval records;
- checks referenced local evidence files exist and completion claims match
  active canonical fact records;
- captures Git commit, branch and dirty-content fingerprint read-only;
- writes immutable JSON under `.nogra/checkpoints/`;
- atomically writes `.nogra/state/CURRENT-ANCHOR.json` and the human-readable
  `.nogra/state/SESSION-CHECKPOINT.md` projection;
- binds the Anchor to the append-only ledger watermark;
- deduplicates identical fresh state;
- creates `supersedes` links when state has moved;
- recovers interrupted projection writes from an immutable record plus its
  ledger event.

## Output

Lead with:

```text
Anchor: <anchorId> · watermark <n> · <fresh|stale>
```

Then state the three completion counts and next owner. Never translate
`claimedDone` into verified prose.
