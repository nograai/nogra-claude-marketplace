---
name: dispatch
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
   Before any transient `cd`, pin the Nogra workspace root once and use that
   absolute path for every local runtime or ledger command:

   ```bash
   NOGRA_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
   ```

   The runtime helpers resolve a nested root to the nearest parent containing
   `.nogra/`, and fall back to the requested root when no `.nogra/` exists so
   fresh setup still works. Pinning the root is still the Manager contract:
   verification/test commands may change cwd, but control-plane calls must not
   depend on a mutable `$PWD`.
2. Promote the brief if it is still a draft with the local runtime:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brief-promote --root "$NOGRA_ROOT" --brief-id "<briefId>" --json
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
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" registry --root "$NOGRA_ROOT" --json
   ```

   The default dispatch control plane is plugin-local.
5. Create a local dispatch receipt/run id for the approved brief:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" dispatch --root "$NOGRA_ROOT" --brief-id "<briefId>" --target executor --json
   ```

   Pass `--target-model` only for an explicit per-dispatch override. Otherwise
   the local runtime resolves the configured runtime policy or release default.
   Pass `--max-turns` only when Manager intentionally overrides the brief-derived
   sizing for this dispatch. Otherwise the local runtime derives `executionMaxTurns`
   from the approved brief and records the factors in `executionSizing`.
   The local runtime writes the queued transport run and event under
   `.nogra/transport/`.
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
7. Fetch the local handoff contract:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" handoff-contract --root "$NOGRA_ROOT" --kind executor --run-id "<runId>" --json
   ```

8. If any local runtime write fails, stop and surface the failure. Local runtime
   helpers own transport record writes.
9. Spawn a subagent in the plugin-provided `nogra:executor` role when
   available. It is the preferred execution role contract because the plugin
   role file defines the responsibility while the local runtime resolves
   runtime metadata. Include:
   - the executor handoff contract prompt from the local runtime
   - the full approved brief, not a loose summary
   - run id and brief id
   - scope files, stop criteria and required evidence
   Runtime/model facts stay in the dispatch receipt and handoff metadata.
   If the client supports per-invocation turn limits, pass
   `targetSubagent.maxTurnsHint` from the handoff contract to the spawn
   primitive. With a concrete run id, that value comes from the dispatch receipt,
   not role frontmatter.
   Long-running commands should set Bash timeout directly for the scaffold,
   build or test step. Progress monitoring uses `run_in_background` rather than
   sleep-poll command chains.
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
10. While the executor-role subagent runs, keep the main chat focused on state
   and decisions. If the user asks to stop or cancel it, stop that subagent first,
   then update the local run through the local ledger/finalize path or return a
   short cancelled or partial state report if no terminal record can be safely
   written. Further implementation, verification, screenshots, browser opening
   or file-opening require a fresh user ask.
11. When the executor-role subagent returns, read evidence in the Manager phase
   and choose the run status. Then persist report/output/run/event records
   locally with the local ledger helper:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" finalize-run --root "$NOGRA_ROOT" --json
   ```

   Pass JSON on stdin with:
   - `runId`;
   - Manager-phase terminal `status`: `ok`, `partial`, `blocked` or `failed`;
   - `phase`: `returned`;
   - `summary`;
   - `reportText`;
   - optional `outputText`.
   - if an independent verifier-role pass actually ran, also include:
     `verificationRole: "nogra:verifier"`, `verificationRuntime`,
     `verificationRuntimeSource`, and `verificationStatus`.

   The helper owns write order: report/output first, then artifact flags from
   disk, then run JSON, then terminal event, then consistency check. The
   Manager phase owns the language and the status decision. Do not use task
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
12. For an ordinary single-run, compare executor-role evidence against the
    approved brief and return the verification. Spawn a subagent in the
    plugin-provided `nogra:verifier` role only for noisy log/test checks,
    explicit independent verification, explicitly requested adapter evidence or
    larger multi-agent flows. If the `nogra:verifier` primitive is unavailable
    when independent verification is required, stop and report the missing
    primitive. When a verifier-role subagent is used, final Nogra state must
    preserve that second role/runtime pair beside the executor pair. Use
    `verificationRole: "nogra:verifier"`, the verifier runtime hint or resolved
    runtime when available, and `verificationStatus` such as `ship`,
    `deviation`, `blocked`, `decision_required` or `unverified` in the
    `finalize-run` payload. Do not overwrite `executionRole`; that remains the
    executor-role run.
13. If the result differs from the approved brief in a material way, return
    `deviation` / `partial` even when the result looks good. Examples:
    requested framework/version changed, a success criterion was satisfied by
    substitute evidence, a screenshot was skipped, or scope moved without user
    approval. The user can accept the deviation; do not silently collapse it
    into OK.

## Failure Handling

If any required crossing piece is missing, stop cleanly:

- no dispatch receipt or run id: stop
- no executor handoff contract: stop
- no `nogra:executor` role primitive: stop
- required `nogra:verifier` role primitive missing: stop
- executor-role subagent reports a stop criterion: stop and return the stop
  reason; if its report includes `Safe Continuation`, include that path and
  whether it needs a fresh Manager/user decision

A failed crossing returns to the operator instead of turning into inline
implementation. Recovery paths outside plugin dispatch need explicit user
direction; do not propose a bypass from this flow.

## Local Runtime Notes

- Local dispatch uses `scripts/nogra-local.mjs` as the control-plane runtime.
- Local dispatch returns a receipt/run id and writes local `.nogra/transport/`
  records. Execution starts at the agent handoff.
- Private transport packets are outside plugin-mode execution.
- `handoff-contract --kind executor --run-id <runId>` returns the local handoff
  prompt supplied to the plugin-provided `nogra:executor` role subagent, with
  dispatch-derived sizing when the run id is available.
- Default dispatch support is plugin-local.
