---
name: dispatch
description: Dispatch an approved Nogra brief in plugin mode. Use when the user gives GO after reviewing a Nogra brief and expects scoped execution, evidence and a verification.
---

# Nogra Dispatch

Use this skill only after a brief exists and the user has approved execution
after reviewing it. A demo request, preview request or idea selection is not GO.
A Claude Code `/goal`, test objective, auto-mode setting or Manager-inferred
"standing GO" is not GO. The user's approval must come after the approved brief
has been shown.

## Boundary

Manager owns intent, approval, control-plane calls, local Nogra bookkeeping and
the final verification. Executor owns implementation.

Manager is not Executor. Do not implement dispatched customer scope in the
Manager conversation. Do not say "in plugin mode, I am the agent."

## User-Facing UX Contract

Dispatch should feel like:

```text
brief shown -> explicit GO -> receipt/run id -> executor context
            -> concise evidence report -> Manager verification
```

Keep the main chat as a control surface, not a build log. After GO, tell the
user that execution has moved to a scoped executor context and that a concise
report will return. If the client/runtime supports background subagents, it is
fine to say the executor is running in the background. If it does not, be
honest that the executor may appear inline while still keeping the return path
clean.

Do not stream raw tool output, MCP payloads, handoff prompts, transport internals,
or long implementation chatter into the user-facing approval/return surface
unless the user explicitly asks for debug detail.

The final user-facing title is `Nogra Verification`. Do not use `Verdict` as a
heading or Nogra-owned report title. Verification words are the product surface:
`Verification: ship`, `Verification: afvigelse`, `Verification: blocked`,
`Verification: beslutning_kraeves` or `Verification: UNVERIFIED`.

## Flow

1. Confirm the approved brief id and the user's explicit GO.
   Read `.nogra/config.json` and capture `runtimePolicy` for the run:
   - `roles.agent.model`, `effort`, `context` and `maxTurns` are the desired
     executor runtime settings.
   - `roles.verifier` is used only if an independent verifier is needed.
   - `roles.manager` is advisory for the active main conversation; do not claim
     Nogra changed Claude Code's native `/model` or `/effort`.
   - `budget` is advisory in interactive plugin mode unless the runtime
     supports a hard budget flag.
2. Promote the brief if it is still a draft. In hosted/plugin mode, promotion
   is stateless: pass the full local brief payload to `brief_promote`,
   not only the brief id. If needed, read the local draft JSON from
   `.nogra/briefs/drafts/<briefId>.json` and pass it as `payload`.
3. Before calling hosted dispatch, perform a Manager-internal routing check on
   the approved brief. This is not a new scoring model, threshold system or
   user prompt by default. Nogra asks Manager because Manager is the instance
   responsible for routing the approved work.

   Ask yourself:

   ```text
   What is the right execution shape for this approved brief?
   ```

   Common execution shapes include:
   - one executor run
   - phased dispatch, with proposed phases
   - parallel scouts/research, with synthesis
   - executor + independent verifier
   - executor + provider review
   - hands-on direct
   - ask CEO

   If the situation does not fit these examples, describe the execution shape
   that does fit. The list is a guide for judgment, not an enum or picker.

   Keep the answer compact and concrete. If a phase split is appropriate, do
   not choose a phase count first. Derive phases from the shape of the work:
   chained vs fanned scope, distinct purpose, decision/evidence boundaries and
   different agent/runtime needs.

   Also notice tool needs. If the approved brief already includes
   `executionShape`, treat it as Manager-authored guidance for the runtime. If
   it does not, do not invent a provider-tool checklist during dispatch; use
   the conservative default unless the missing tool shape changes scope or risk,
   in which case stop and ask the operator.

   Use phases only when the work has distinct purpose, dependency boundaries,
   decision points or different agent/runtime needs. Do not split just to split.
   Do not keep one run just because the brief is already approved.

   For each proposed phase, include:
   - purpose;
   - scope/files;
   - evidence or return point;
   - why this phase is separate.

   Do not use visible weights, thresholds, scores, fixed phase counts, fixed
   final-phase shapes or "requires explanation" language. If the routing answer
   changes scope, authority, risk or requires a decision the current approved
   brief/GO did not cover, stop and ask the operator before dispatching.
   Otherwise continue with the chosen execution shape.
4. Call `registry` and verify that the active Nogra MCP is hosted:
   - `boundary.hostedMode` must be `true`.
   - `status` should be `v1-hosted-validation`.

   If the registry shows local/non-hosted mode, stop. This means a
   local/private MCP server is still registered as `nogra` and is winning over
   the plugin-managed hosted MCP. `nogra` is reserved for hosted/plugin mode;
   local/private development should use `nogra-dev`. Do not call
   `transport_dispatch`.
5. Call hosted Nogra for a dispatch receipt/run id for the approved brief.
   Pass the full approved brief payload inline to `transport_dispatch`.
   `brief_id` alone is not enough in hosted/plugin mode because the
   customer-local `.nogra/` store is the source of truth.
   Pass `targetModel` explicitly from the local runtime policy when present:
   `runtimePolicy.roles.agent.model`; otherwise use the approved brief's
   `targetModel`. Do not rely on hosted defaults when the workspace has chosen
   an agent model. Include the agent `effort`, `context`, `maxTurns` and
   budget mode in `manager_message` so the receipt and executor handoff show
   the user's settings.
   In hosted/plugin mode, `transport_dispatch` is a receipt builder and local
   ledger guide. It is not an agent runtime.
6. Apply receipt `localWrites` under `.nogra/` with the local ledger helper:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" apply-local-writes --root "$PWD" --json
   ```

   Pass either the full MCP response object or `{ "localWrites": [...] }` on
   stdin. The helper owns path validation, atomic writes and JSONL idempotency.
   If it returns `partial`, `error` or any rejected write, stop and surface the
   result to the operator. Do not manually repair rejected local writes by
   hand-writing `.nogra/` files.
7. Fetch `handoff_contract(kind: executor)`.
8. Spawn the plugin-provided `executor` subagent when available. It is
   the preferred runtime executor because its agent template pins the default
   model/effort in frontmatter (`model: sonnet`, `effort: high`) instead of
   relying only on prompt text. Include:
   - the executor handoff contract prompt from hosted Nogra
   - the full approved brief, not a loose summary
   - run id and brief id
   - scope files, stop criteria and required evidence
   - the local runtimePolicy agent settings: model, effort, context, maxTurns
     and budget note
   - instruction not to call Nogra MCP tools
   If the client cannot invoke `executor`, stop and surface the missing
   primitive. Do not implement inline. Do not silently fall back to generic
   subagent execution unless the user explicitly asks to leave Nogra and work
   directly. If the client supports a per-invocation model/effort override,
   request the configured runtimePolicy values; otherwise the plugin agent
   template default and handoff guidance are the source of truth.
   Describe this as a plugin-registered agent from the Nogra plugin's
   `agents/` directory. Do not tell the user it was installed into the
   workspace's `.claude/agents/`; plugin mode should not write workspace
   `.claude/` files.
9. While the executor runs, keep Manager focused on state and decisions.
   If the user asks to stop or cancel the executor, stop the executor first,
   then call `transport_abort` with the run id and current local run record
   when available. Apply the returned localWrites. Return a short cancelled or
   partial state report. Do not continue implementation, verification,
   screenshots, browser opening or file-opening unless the user asks.
10. When the executor returns, Manager first reads evidence and chooses the run
   status. Then persist report/output/run/event records locally with the local
   ledger helper:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" finalize-run --root "$PWD" --json
   ```

   Pass JSON on stdin with:
   - `runId`;
   - Manager-selected terminal `status`: `ok`, `partial`, `blocked` or `failed`;
   - `phase`: `returned`;
   - `summary`;
   - `reportText`;
   - optional `outputText`.

   The helper owns write order: report/output first, then artifact flags from
   disk, then run JSON, then terminal event, then consistency check. Manager owns
   the language and the status decision. Do not use task wrapper `completed` as
   completion evidence, and do not invent `completed/completed`.

   If the helper returns `inconsistent` or `conflict`, stop and surface the
   differences. Do not auto-fix, force-correct, or rewrite Manager's prose.
11. For an ordinary single-run, Manager compares executor evidence against the
    approved brief and returns the verification. Spawn the plugin-provided
    `verifier` only for noisy browser/log/test checks, explicit
    independent verification or larger multi-agent flows. If the verifier
    primitive is unavailable when verification is required, stop and report the
    missing primitive.
12. If the result differs from the approved brief in a material way, return
    `afvigelse` / `partial` even when the result looks good. Examples:
    requested framework/version changed, a success criterion was satisfied by
    substitute evidence, a screenshot was skipped, or scope moved without user
    approval. The user can accept the deviation; Manager should not silently
    collapse it into OK.

## Failure Handling

If any required crossing piece is missing, stop cleanly:

- no dispatch receipt or run id: stop
- no executor handoff contract: stop
- no `executor` subagent primitive: stop
- required verifier primitive missing: stop
- executor reports a stop criterion: stop and return the stop reason

Do not repair a failed crossing by doing the work inline. Do not offer
synchronous fallback, generic-subagent bypass, private Transport runtime,
`agent_exec_packet`, wrapper installs or local/private Nogra servers. The user
may explicitly override outside Nogra, but Manager must not propose the bypass.

## Hosted Tool Notes

- Hosted Nogra is the living guide and stateless judge, not the runtime agent.
- `transport_dispatch` in hosted/plugin mode returns a receipt and local write
  instructions. It does not execute the brief.
- Private Transport/Agent Exec packets are not part of plugin-mode execution.
- `handoff_contract(kind: executor)` is the hosted handoff prompt supplied to
  the plugin-provided `executor` agent.
- `transport_validate_completion` may be used after execution for hosted
  stateless validation support, but it does not replace Manager's evidence vs.
  brief verification.
