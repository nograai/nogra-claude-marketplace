---
name: verify
description: Verify a Nogra run or ordinary Claude work against a brief, scope, claims and evidence. Use when the user runs /nogra:verify, asks whether work is really done, wants Nogra to check evidence, or asks for verification.
---

# Nogra Verify

Use this skill when the user explicitly wants Nogra to check a claim against
evidence.

`/nogra:verify` is Kasper's reassurance button. It can verify work from a
Nogra dispatch or ordinary Claude work that now needs a Nogra Verification.

## Boundary

Verification is an authority gate. Do not run it ambiently, on session start,
or just because a task exists.

Manager owns the final user-facing verification. Hosted Nogra provides stateless
completion validation support; it does not replace Manager judgment.

Executor must not call Nogra MCP tools.

## Trigger

Use this skill when the user:

- runs `/nogra:verify`;
- asks "is this actually done?";
- asks Nogra to check evidence;
- asks for verification;
- wants Claude's work checked against a brief after the fact;
- has an executor report and needs completion validation.

Do not use this skill for:

- ordinary status updates;
- tiny direct edits where the user did not ask for verification;
- brainstorming or demo idea selection;
- dispatching new work. Use `dispatch` for approved execution.

## Flow

1. Identify the verification target:
   - existing Nogra run id, if present;
   - approved brief id or brief payload, if present;
   - result/report/claim being checked;
   - files changed;
   - commands, screenshots or manual checks used as evidence.
2. If no approved Nogra brief exists, say this is best-effort verification
   against the user's stated request and collected evidence. Ask one concrete
   question only if the missing scope would materially change the verification.
3. Build a completion evidence object for `transport_validate_completion`:
   - existing `runId`, or a local verification id shaped like
     `transport-YYYYMMDDHHMMSS-xxxxxxxx` if no run exists;
   - `briefId` and full `brief` when available;
   - `scopeFiles` from the brief or the user's stated scope;
   - `filesChanged`;
   - `protocolFilesChanged` for `.nogra/` records, if any;
   - `commandsRun`;
   - `reportText`;
   - `acceptance` status per success criterion when available;
   - `briefDeviations` for any unapproved mismatch;
   - `decisionRequired` when the user must choose.
4. Call `transport_validate_completion` once with the inline evidence object.
5. Apply returned `localWrites` under `.nogra/` with the local ledger helper:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" apply-local-writes --root "$PWD" --json
   ```

   Pass either the full validation response object or `{ "localWrites": [...] }`
   on stdin. The helper rejects absolute paths, `~`, control characters, `..`
   escapes and any resolved path outside `<workspace>/.nogra/`. It deduplicates
   JSONL appends by idempotency key and writes JSON atomically. If it returns
   `partial`, `error` or any rejected write, stop and surface the result to the
   operator. Do not manually repair rejected local writes by hand-writing
   `.nogra/` files.
6. If the verification involves an existing Nogra transport run, check ledger
   consistency with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "$PWD" --run-id "<runId>" --json
   ```

   If the helper returns `inconsistent`, surface the differences and keep
   Manager as `nextOwner`. Do not auto-fix, force-correct, or parse Manager's
   prose for keywords.
7. Compare hosted validation output with Manager's own evidence read.
8. Return a concise verification:
   - `ship`: evidence satisfies the brief/request;
   - `afvigelse`: useful result, but it materially differs from the approved
     brief/request;
   - `blocked`: evidence is missing, invalid or out of scope;
   - `beslutning_kraeves`: user decision needed;
   - `UNVERIFIED`: not enough evidence to honestly verify.

## Verification Rules

- Missing evidence is not success.
- A visually good result can still be `afvigelse` if it changed framework,
  skipped a criterion, used substitute evidence, or moved scope without
  approval.
- If there is no brief, do not pretend there was one. State the baseline used.
- Prefer direct evidence: diff, files, commands, browser screenshot, HTTP
  response, test output or human confirmation.
- Do not re-run implementation from this skill. Verification can ask for more
  evidence or return a blocked verification or decision-needed result.

## Handoff Line

When verification is complete, lead with:

```text
Verification: <ship|afvigelse|blocked|beslutning_kraeves|UNVERIFIED>
```

Then list the evidence checked and any remaining risk. Do not use `Verdict` as
a heading or Nogra-owned report title.
