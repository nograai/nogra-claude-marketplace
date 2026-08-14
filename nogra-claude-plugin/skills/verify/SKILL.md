---
name: nogra-verify
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

Read `references/evidence-gotchas.md` before returning a verdict when evidence
is missing, self-reported, visual-only, stale, out of scope or produced by the
same agent that did the work.

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
- dispatching new work. Use `nogra-dispatch` for approved execution.

## Flow

Claude Code Bash-safe command style: use one simple command per Bash tool call
with absolute paths. Do not use `$PWD`, `&&`, heredocs or root assignments in
Bash tool calls. When passing a completion evidence object,
write it with `Write` to a workspace-local temp file under `.nogra/transport/`
first, then pass `--input <path>`. Replace `<absolute-workspace-root>` below
with the confirmed absolute path of the workspace.

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
3. Save each evidence package as an immutable canonical receipt before asking
   for `ship`:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" evidence-save --root "<absolute-workspace-root>" --input ".nogra/transport/tmp-evidence-input.json" --json
   ```

   The runtime computes artifact digests from existing workspace-local files.
   Do not provide a free-text path as a substitute for the returned
   `evidenceId`. Missing or stale artifact integrity blocks verification.
4. When independent verification is needed, enter a verifier role lease, fetch
   the verifier handoff, and spawn the plugin role with the approved brief,
   executor claims and canonical evidence:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-enter --root "<absolute-workspace-root>" --run-id "<runId>" --role verifier --json
   ```

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" handoff-contract --root "<absolute-workspace-root>" --kind verifier --run-id "<runId>" --json
   ```

   Verifier has only Read, Grep and Glob. It cannot run Bash, edit, install,
   clean, deploy or commit. If another observation is required, Verifier puts
   it in `requestedProbes`; Manager runs the probe, saves its canonical evidence
   and starts a new bounded verifier pass.

   After return, Manager closes the lease and saves the exact structured
   report:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-exit --root "<absolute-workspace-root>" --lease-id "<leaseId>" --reason "verifier returned control to Manager" --json
   ```

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-report-save --root "<absolute-workspace-root>" --input ".nogra/transport/tmp-verifier-role-report.json" --json
   ```

   A missing/malformed report, mutation claim, mismatched run/brief/lease or
   `ship` recommendation without canonical evidence fails closed.
5. Build a completion evidence object for the local runtime:
   - existing `runId`;
   - optional coarse verification `status`: `ok` for `ship`, `partial` for
     `deviation`, or `blocked` for a non-ship verdict. This is a compatibility
     projection and never replaces the executor `outcome`;
   - `briefId` and full `brief` when available;
   - `scopeFiles` from the brief or the user's stated scope;
   - `filesChanged`;
   - `protocolFilesChanged` for `.nogra/` records, if any;
   - `commandsRun`;
   - `evidenceIds` returned by `evidence-save` (mandatory for `ship`);
   - `reportText`;
   - `acceptance` status per success criterion when available;
   - `briefDeviations` for any unapproved mismatch;
   - `decisionRequired` when the user must choose;
   - `verification` or `verdict`: `ship`, `deviation`, `blocked`,
     `decision_required` or `unverified`;
   - `reason` for every non-`ship` verdict: what is missing, deviating or
     blocking, and what evidence would move it to `ship`.
   - `roleReportId` when a `nogra:verifier` pass was used. Claiming
     `verificationRole: "nogra:verifier"` without this schema-valid report is
     blocked.
   Do not leave status implicit when Manager has already made the verification
   judgment. The local runtime can infer a conservative status from acceptance
   rows, but Manager's explicit judgment is the product authority.
6. If there is an existing local Nogra run, first require a recorded executor
   outcome and `lifecycle=returned`, then record verification support with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" verify --root "<absolute-workspace-root>" --run-id "<runId>" --input ".nogra/transport/tmp-verification-input.json" --json
   ```

   Pass the evidence object on stdin or with `--input`. For `nogra.run.v2`, the
   local runtime writes
   `.nogra/receipts/verdicts/verdict-<runId>.json`, writes the compatibility
   validation artifact under `.nogra/transport/artifacts/<runId>/`, transitions
   only `lifecycle` and `verdict`, and appends `run_verified` to the canonical
   ledger. It preserves the executor `outcome`.
7. If there is no existing Nogra run, verify best-effort against the
   user's stated request and collected evidence. Do not invent a run id unless
   the user explicitly asks for a new brief/GO/dispatch flow; the verification
   helper does not fabricate standalone runs.
8. If the verification involves an existing Nogra run, check ledger
   consistency with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "<absolute-workspace-root>" --run-id "<runId>" --json
   ```

   If the helper returns `inconsistent`, surface the differences and keep
   Manager as `nextOwner`. Do not auto-fix, force-correct, or parse Manager's
   prose for keywords.
9. Compare local runtime verification support with Manager's own evidence read.
   If the user is explicitly grading Nogra behavior or scenario probes, compare
   evidence against `.nogra/index/behavior-score.md`'s expected shape when it
   exists: scenario id, mode, drift cluster, expected guard, observed behavior,
   evidence path and verdict. Do not treat structural file presence as behavior
   success.
10. Return a concise verification:
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
- A path or prose statement is not a canonical evidence receipt. `ship`
  requires a schema-valid, content-addressed evidence ID whose artifacts still
  match their recorded digests.
- Executor self-report is never verdict evidence. Complete, truncated, missing
  or polished reports are claim surfaces only; verify against independent tree,
  artifact, command and diff evidence. Report quality can explain why
  self-report evidence is unavailable, but it does not decide `ship`, `blocked`
  or `failed`.
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
