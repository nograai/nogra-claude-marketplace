---
name: verify
description: Verify a Nogra run or ordinary Claude work against a brief, scope, claims and evidence. Use when the user runs /nogra:verify, asks whether work is really done, wants Nogra to check evidence, or asks for verification.
---

# Nogra Verify

Use this skill when the user explicitly wants Nogra to check a claim against
evidence.

`/nogra:verify` is the reassurance step. It can verify work from a
Nogra dispatch or ordinary Claude work that now needs a Nogra Verification.

## Boundary

Verification is an authority gate. Do not run it ambiently, on session start,
or just because a task exists.

The Manager phase owns the final user-facing verification. The local runtime
records verification support under `.nogra/`; Manager judgment remains the
authority.

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
   - commands, native file/diff checks, tests, screenshots or manual checks
     used as evidence.
2. If no approved Nogra brief exists, say this is best-effort verification
   against the user's stated request and collected evidence. Ask one concrete
   question only if the missing scope would materially change the verification.
3. Build a completion evidence object for the local runtime:
   - existing `runId`, or a local verification id shaped like
     `transport-YYYYMMDDHHMMSS-xxxxxxxx` if no run exists;
   - explicit local run `status`: `ok` for `ship`, `partial` for
     `deviation`, `blocked` for `blocked`, `failed` for failed execution;
   - `briefId` and full `brief` when available;
   - `scopeFiles` from the brief or the user's stated scope;
   - `filesChanged`;
   - `protocolFilesChanged` for `.nogra/` records, if any;
   - `commandsRun`;
   - `reportText`;
   - `acceptance` status per success criterion when available;
   - `briefDeviations` for any unapproved mismatch;
   - `decisionRequired` when the user must choose;
   - `verification` or `verdict`: `ship`, `deviation`, `blocked`,
     `decision_required` or `unverified`;
   - `reason` for every non-`ship` verdict: what is missing, deviating or
     blocking, and what evidence would move it to `ship`.
   Do not leave status implicit when Manager has already made the verification
   judgment. The local runtime can infer a conservative status from acceptance
   rows, but Manager's explicit judgment is the product authority.
4. If there is an existing local Nogra transport run, record verification
   support with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" verify --root "$PWD" --run-id "<runId>" --json
   ```

   Pass the evidence object on stdin or with `--input`. The local runtime writes
   `.nogra/transport/artifacts/<runId>/validation.json`, updates the run record
   and appends a local transport event.
5. If there is no existing Nogra transport run, verify best-effort against the
   user's stated request and collected evidence. Do not invent a run id unless
   the user explicitly wants a local Nogra record created.
6. If the verification involves an existing Nogra transport run, check ledger
   consistency with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "$PWD" --run-id "<runId>" --json
   ```

   If the helper returns `inconsistent`, surface the differences and keep
   Manager as `nextOwner`. Do not auto-fix, force-correct, or parse Manager's
   prose for keywords.
7. Compare local runtime verification support with Manager's own evidence read.
8. Return a concise verification:
   - `ship`: evidence satisfies the brief/request;
   - `deviation`: useful result, but it materially differs from the approved
     brief/request;
   - `blocked`: verification completed and the work is not acceptable on the
     evidence;
   - `decision_required`: user decision needed;
   - `unverified`: verification could not complete because there is not enough
     evidence to form an honest verdict.
   Before returning any verdict other than `ship`, answer: what specifically is
   missing, deviating or blocking, and what evidence would move it to `ship`.
   Do not return a non-`ship` verdict until that answer is explicit.

## Verification Rules

- Missing evidence is not success.
- A visually good result can still be `deviation` if it changed framework,
  skipped a criterion, used substitute evidence, or moved scope without
  approval.
- If there is no brief, do not pretend there was one. State the baseline used.
- Prefer direct native evidence: diff, files, grep/search, commands, existing
  repo tests, artifact content or human confirmation.
- For UI-heavy work, static preview evidence and interaction/use evidence prove
  different claims. When the request, brief, changed files or surfaced routing
  signals indicate a visual/product surface, verify relevant interactions,
  states, persistence, responsiveness and design-language consistency when
  evidence exists. If the brief required interaction evidence and it is missing,
  do not treat a good-looking static result as complete.
- Browser screenshots, Playwright/Puppeteer checks, Chrome automation,
  `file://` browsing, local HTTP serving and console/network inspection are
  optional adapter evidence. Do not make them required for Nogra
  verification unless the approved brief explicitly required that external
  adapter/tool and the user accepts the dependency.
- Preserve claim strength in methodology verification: confidence and evidence
  level matter. A single run, preliminary cost number, or early structural read
  should not verify as settled methodology.
- Do not re-run implementation from this skill. Verification can ask for more
  evidence or return a blocked verification or decision-needed result.

## Handoff Line

When verification is complete, lead with:

```text
Verification: <ship|deviation|blocked|decision_required|unverified>
```

For any non-`ship` verdict, include a `Why:` line with the reason from the
forcing answer: what is missing, deviating or blocking, and what evidence would
move it to `ship`. Then list the evidence checked and any remaining risk. The
Nogra-owned report title is `Nogra Verification`.
