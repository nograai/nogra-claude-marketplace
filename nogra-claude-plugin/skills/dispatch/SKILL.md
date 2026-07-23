---
name: nogra-dispatch
description: Dispatch an approved Nogra brief through the plugin workflow. Use when the user gives GO after reviewing a Nogra brief and expects scoped execution, evidence and a verification.
---

# Nogra Dispatch

Use this skill only after a brief exists and the user has approved execution
after reviewing it. A demo request, preview request or idea selection is not GO.
A Claude Code `/goal`, test objective, auto-mode setting or Manager-inferred
"standing GO" is not GO. The user's approval must come after the approved brief
has been shown.

## Boundary

The *Manager phase* is the main Claude Code conversation you are talking to —
as opposed to the *executor*, a separate scoped subagent that does the work. The
Manager phase owns intent, approval, local Nogra bookkeeping and final
verification. A subagent taking the executor role owns scoped implementation for
its run.

The Manager phase is not the executor-role runtime. Do not implement dispatched
customer scope in the main chat. Do not claim the main chat is the agent because
the plugin workflow is active.

## Role And Runtime

Use `references/dispatch-contract.md` for role/runtime and execution-shape
mechanics.

Read `references/dispatch-gotchas.md` before dispatching a risky brief, when a
run returns weak evidence, or when the runtime cannot prove whether a subagent
will return before the command exits.

Dispatch is a Manager-phase action in the current conversation: create the
receipt, hand off the approved brief, receive evidence, decide whether
independent verification is needed, then roll up to the user.

## User-Facing UX Contract

Dispatch should feel like:

```text
brief shown -> explicit GO -> receipt/run id -> executor-role subagent
            -> concise evidence report -> Manager verification
```

Keep the main chat as a control surface, not a build log. After GO, tell the
user that execution has moved to a scoped subagent in the executor role and
that a concise report will return. If the client/runtime supports background
subagents, it is fine to say `Executor · <runtime>` is running in the
background. If it does not, be honest that the role-runtime may appear inline
while still keeping the return path clean.

The internal agent primitive appears as `nogra:executor` because Claude Code
namespaces plugin-provided role contracts. That is correct internal routing.
In user-facing status, describe role plus runtime, for example
`Executor · Sonnet`, or simply `executor` in casual prose. `Nogra executor`,
`Nogra verifier` and tier labels are not owned surface terms. User-facing
status should stay with role plus runtime.

`nogra:executor` does not mean "Nogra is an executor." It means "the executor
role provided by the Nogra plugin, taken on by the selected runtime for this
run." Nogra state should expose both axes together: `executionRole` plus
`executionRuntime`, and user-facing status should preserve that pairing.
`owner` is the Manager-owned control-plane contract. `nextOwner` is the next
role expected to act, normally `nogra:executor`; use Manager action fields and
`executionCrossing.nextStep` for prose such as sizing review or spawn guidance.

Only promise to wait when the current Claude Code client can actually deliver
the executor-role return before the command exits. In one-shot/non-interactive
smoke runs, a background role-runtime may continue after the Manager response.
In that case return the queued run id and say verification is pending instead
of saying Manager will wait.

Keep the user-facing approval/return surface concise. Raw tool output, runtime
payloads, handoff prompts, transport internals and long implementation chatter
belong in debug detail only when the user explicitly asks for it.

After GO, the main chat gets a one-to-two line dispatch confirmation: what was
dispatched, that the executor role runs in the background, and that a report
returns. The dispatch telemetry — run id, brief id, role, phase, spec, expected
output, next step — lives in the local dispatch receipt under `.nogra/` and the
client's native background-tasks view. Do not render it as a verbose inline
block in the main chat.

Example confirmation:

```text
Dispatched <brief title> → Executor (Sonnet, background). Run id is in the
ledger; I'll return a concise report + verification when it lands.
```

The final user-facing title is `Nogra Verification`. Verification words are the product surface:
`Verification: ship`, `Verification: deviation`, `Verification: blocked`,
`Verification: decision_required` or `Verification: unverified`.

## Flow

1. Confirm the approved brief id and the user's explicit GO.
   Read `.nogra/config.json` and capture the runtime facts needed for the run.
   Use `skills/help/references/runtime.md` for runtime-policy meaning and
   `references/dispatch-contract.md` for dispatch shape mechanics.
   Claude Code Bash-safe command style: confirm the absolute Nogra workspace
   root once and use that literal path for every local runtime or ledger
   command. Use one simple command per Bash tool call. Do not use `$PWD`, `&&`,
   heredocs or root assignments in Bash tool calls. If a finalize/verification
   payload is needed, write it with
   `Write` to a workspace-local temp file under `.nogra/transport/` first, then
   pass it with `--input` when the helper supports it. Replace
   `<absolute-workspace-root>` below with the confirmed absolute path.

   The runtime helpers resolve a nested root to the nearest parent containing
   `.nogra/`, and fall back to the requested root when no `.nogra/` exists so
   fresh setup still works. Pinning the root is still the Manager contract:
   verification/test commands may change cwd, but control-plane calls must not
   depend on a mutable working directory.
2. Promote the brief if it is still a draft with the local runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-promote --root "<absolute-workspace-root>" --brief-id "<briefId>" --json
```

   The default dispatch control plane is local.
3. Before local dispatch, perform a Manager-internal routing and sizing check
   on the approved brief. This is not a new scoring model, threshold system or
   user prompt by default. This step asks the Manager phase to choose the
   execution shape and `maxTurns` sizing for the approved work. Concrete
   `maxTurns` belongs here after the approved brief exists. The brief flow
   should already have made the coarse decomposition call before writing the
   proposal and then run `brief-sizing-preview` on the selected phase before
   approval. Treat `sizingPreview.userSurface=ask` as the only pre-approval
   user prompt by default; `inform` is a one-line execution-shape note when the
   deliverable lands in parts, and `silent` stays in the receipt. If preview was
   skipped, treat dispatch sizing as a late decomposition gate instead of
   spawning automatically.

   Ask yourself:

   ```text
   What is the right execution shape and turn budget for this approved brief?
   ```

   Use `references/dispatch-contract.md` for execution-shape examples, phase
   criteria, execution sizing and tool-shape handling.

   Keep routing rationale qualitative and brief. If the routing answer changes
   scope, authority, risk or requires a decision the current approved brief/GO
   did not cover, stop and ask the operator before dispatching.
   Otherwise continue with the chosen execution shape.
4. Read local status/registry and keep the dispatch path local unless the
   workspace is intentionally connected:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" registry --root "<absolute-workspace-root>" --json
```

   The default dispatch control plane is plugin-local.
5. Record the just-observed explicit GO as a brief-hashed, action-hashed,
   single-use approval record. Do this only once for that user GO:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" approval-create --root "<absolute-workspace-root>" --brief-id "<briefId>" --approved-by "operator" --json
```

   Then use the returned `approvalId` to create exactly one canonical run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" dispatch --root "<absolute-workspace-root>" --brief-id "<briefId>" --approval-id "<approvalId>" --json
```

   Target role and runtime are part of the approved brief hash. Do not use
   `--target` or `--target-model` to change them after GO; update the brief,
   show the changed brief, and obtain a fresh GO instead.
   Pass `--max-turns` only when Manager intentionally overrides the brief-derived
   sizing for this dispatch. Otherwise the local runtime derives `executionMaxTurns`
   from the approved brief and records the factors in `executionSizing`.
   The local runtime writes `nogra.run.v2` under `.nogra/runs/`, consumes the
   approval, and appends `nogra.run.event.v2` to
   `.nogra/ledger/events.jsonl`. Execution artifacts remain under
   `.nogra/transport/artifacts/<runId>/`. It does not create a shadow legacy
   transport run.
6. Inspect `executionSizing` in the dispatch receipt before spawning. If
   `executionSizing.requiresManagerDecision` is true, do not continue to handoff
   and spawn by default. Treat this as a decomposition gate:

   - split into phases when the approved brief and GO already cover that route
   - rerun dispatch with an explicit bounded `--max-turns` override only when the
     operator wants one larger run
   - ask the operator when splitting, widening runtime budget or changing the run
     shape needs a fresh decision

   Surface the receipt's `executionSizing.summary` in one line when a decision is
   needed.
7. Enter the strict executor role lease before spawning:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-enter --root "<absolute-workspace-root>" --run-id "<runId>" --role executor --json
   ```

   The returned `nogra.role.lease.v1` binds this run revision, role, operation
   set and normalized `scope.files`. Do not spawn on `blocked`, an empty/missing
   lease, or a lease for another run. Only one active public role lease may
   exist in a workspace.
8. Fetch the local handoff contract after lease entry so it carries the exact
   lease id and role-report template:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" handoff-contract --root "<absolute-workspace-root>" --kind executor --run-id "<runId>" --json
   ```

9. If any local runtime write fails, stop and surface the failure. Local runtime
   helpers own transport record writes.
10. Spawn with the Claude Code `Agent` primitive into the plugin-provided
   `nogra:executor` role when available. It is the preferred execution role
   contract because the plugin role file defines the responsibility while the
   local runtime resolves runtime metadata. Include:
   - the executor handoff contract prompt from the local runtime
   - the full approved brief, not a loose summary
   - run id and brief id
   - scope files, stop criteria and required evidence
   - complete prior findings when relevant, with attribution such as source URL,
     document/page or file/line, `verificationStatus`, confidence and agent id
   Runtime/model facts stay in the dispatch receipt and handoff metadata.
   Spawned agents start with isolated context. Do not rely on parent chat
   history, shared memory or files Manager already read; put the needed context
   directly into the Agent prompt or context bundle.
   The public executor/verifier roles intentionally omit `Agent` from their
   frontmatter `tools` allowlist. They must not spawn nested subagents. If
   fan-out is required, stop and route it to an internal or enterprise
   orchestration path rather than widening the public plugin role.
   If the client supports per-invocation turn limits, pass
   `targetSubagent.maxTurnsHint` from the handoff contract to the spawn
   primitive. With a concrete run id, that value comes from the dispatch receipt,
   not role frontmatter.
   Treat the spawned role as an agentic loop: continue when the client reports
   `stop_reason=tool_use`, execute the requested tools, feed results back, and
   stop normally only when `stop_reason=end_turn` returns the role report. If the
   client turn limit or `maxTurns` is hit before a normal report, return control
   to Manager. Record `stopReason=maxTurns_exhausted` only as internal
   ledger/continuation state; face the operator with `partial` or `blocked` plus
   a plain reason such as "work stopped before completion with pending tool
   work". Carry the run id, any pending tool/request state available, and the
   known safe continuation. Do not treat a max-turn wrapper return as completion.
   The strict public executor also omits `Bash`. It returns required command
   checks in `requestedProbes`; Manager runs those probes after the role return
   and stores canonical evidence. Never widen the role with arbitrary shell.
   If the client cannot invoke `nogra:executor`, stop and surface the missing
   role primitive. Inline implementation is outside the dispatch path. Generic
   subagent execution belongs to direct work only when the user explicitly asks
   to leave Nogra. If the client supports a per-invocation model/effort
   override, request the configured runtimePolicy values; otherwise rely on the
   local runtime and handoff guidance.
   Internally, this is a plugin-registered role contract from the Nogra
   plugin's `agents/` directory. User-facing labels should describe the role
   and runtime. Describe it as plugin-provided, not as a workspace-installed
   `.claude/agents/` file.
   If the active client is a one-shot/non-interactive runner and cannot return
   the background agent result to Manager before exit, leave the local run
   queued and tell the operator to resume/check/verify the run in an
   interactive Claude Code session.
11. While the executor-role subagent runs, keep the main chat focused on state
   and decisions. If the user asks to stop or cancel it, stop that subagent first,
   then update the local run through the local ledger/finalize path or return a
   short cancelled or partial state report if no terminal record can be safely
   written. Further implementation, verification, screenshots, browser opening
   or file-opening require a fresh user ask.
12. When the executor-role subagent returns, close its lease and validate the
   exact structured return before choosing the executor outcome:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-exit --root "<absolute-workspace-root>" --lease-id "<leaseId>" --reason "executor returned control to Manager" --json
   ```

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" role-report-save --root "<absolute-workspace-root>" --input ".nogra/transport/tmp-executor-role-report.json" --json
   ```

   A report that names an out-of-scope file, another run/brief/lease or an
   Executor verdict fails closed. The accepted report remains a claim surface.
   Manager then runs any `requestedProbes`, saves canonical evidence, chooses
   the executor outcome, and persists report/output/run/event records with:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" finalize-run --root "<absolute-workspace-root>" --json
   ```

   Pass JSON on stdin with:
   - `runId`;
   - executor `status`/outcome: `ok`, `partial`, `blocked` or `failed`;
   - `phase`: `returned`;
   - `summary`;
   - `reportText`;
   - optional `outputText`.
   - optional `stopReason`, `returnReason` and `pendingState` when the role
     returns without a normal report because the client loop hit a turn/runtime
     limit.

   The helper owns write order: report/output first, then artifact flags from
   disk, then canonical run JSON, then canonical run event, then consistency
   check. This transition sets `lifecycle=returned` and `outcome`; it never
   writes a verifier verdict. The Manager phase owns the language and the
   outcome decision. Do not use task
   wrapper `completed` as completion evidence, and do not invent
   `completed/completed`.
   Executor self-report is never verdict evidence. Complete, truncated, missing
   or polished reports are claim surfaces only; Manager derives `ship`,
   `deviation`, `blocked` or `failed` from independent tree, artifact, command
   and diff evidence. Report quality can explain why self-report evidence is
   unavailable, but it is never in itself `ship` or failure.

   If the helper returns `inconsistent` or `conflict`, stop and surface the
   differences. Do not auto-fix, force-correct, or rewrite Manager's prose.
   When an executor report is `blocked` because a pre-flight stop criterion fired,
   read its `Safe Continuation` section before returning to the user. If a safe
   route is present, include both the blocker and that route in the Manager
   verification/return surface.
13. For an ordinary single-run, compare executor-role evidence against the
    approved brief and return the verification. Spawn a subagent in the
    plugin-provided `nogra:verifier` role only for noisy log/test checks,
    explicit independent verification, explicitly requested adapter evidence or
    larger multi-agent flows. The verifier is restricted to Read, Grep and Glob;
    it has no Bash or mutation tool. Manager runs commands and persists their
    canonical evidence before the verifier pass. If the `nogra:verifier` primitive is unavailable
    when independent verification is required, stop and report the missing
    primitive. When a verifier-role subagent is used, include
    the complete evidence receipts and a verifier handoff contract. Before
    spawn, enter `--role verifier`. After return, close the lease and save the
    `nogra.role.report.v1` exactly as above. Pass its `roleReportId` to
    verification; do not translate free text into a verifier verdict:

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" verify --root "<absolute-workspace-root>" --run-id "<runId>" --input ".nogra/transport/tmp-verification-input.json" --json
    ```

    This writes a canonical `nogra.verdict.v1`, transitions the run from
    `returned` to `verified`, and appends `run_verified`. It preserves
    `executionRole` and executor `outcome`; verification only adds the separate
    verifier role/runtime and `verdict`.
14. If the result differs from the approved brief in a material way, return
    `deviation` / `partial` even when the result looks good. Examples:
    requested framework/version changed, a success criterion was satisfied by
    substitute evidence, a screenshot was skipped, or scope moved without user
    approval. The user can accept the deviation; do not silently collapse it
    into OK.

## Failure Handling

If any required crossing piece is missing, stop cleanly:

- no dispatch receipt or run id: stop
- no executor handoff contract: stop
- no active run-bound executor lease: stop
- malformed, mismatched or out-of-scope structured role report: stop
- no Claude Code `Agent` primitive or no `nogra:executor` role primitive: stop
- required Claude Code `Agent` primitive or `nogra:verifier` role primitive
  missing: stop
- client loop hits `maxTurns` before a normal role report: stop, return
  internal `stopReason=maxTurns_exhausted`, preserve pending state when
  available, and leave continuation with Manager instead of marking the run
  complete. The chat-facing reason should say the work stopped before completion,
  not expose the internal turn-limit label.
- executor-role subagent reports a stop criterion: stop and return the stop
  reason; if its report includes `Safe Continuation`, include that path and
  whether it needs a fresh Manager/user decision

A failed crossing returns to the operator instead of turning into inline
implementation. Recovery paths outside plugin dispatch need explicit user
direction; do not propose a bypass from this flow.

## Local Runtime Notes

- Local dispatch uses `scripts/nogra-local.mjs` as the control-plane runtime.
- Local dispatch returns a receipt/run id, writes the canonical run under
  `.nogra/runs/`, and leaves execution artifacts under `.nogra/transport/`.
  Execution starts at the agent handoff.
- Private transport packets are outside plugin-mode execution.
- `handoff-contract --kind executor --run-id <runId>` returns the local handoff
  prompt supplied to the plugin-provided `nogra:executor` role subagent, with
  dispatch-derived sizing when the run id is available.
- Default dispatch support is plugin-local.
