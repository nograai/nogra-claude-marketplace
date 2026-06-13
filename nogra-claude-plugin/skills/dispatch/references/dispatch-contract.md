# Dispatch Contract

Use this reference for dispatch mechanics that should not live in the main
dispatch skill body.

## Role And Runtime

Nogra separates workflow role from runtime:

- Role = workflow responsibility shipped by the plugin as role contracts:
  `nogra:executor` and `nogra:verifier`.
- Runtime = the model/session taking that role. The role contract declares
  default runtime hints; custom runtime preferences may be requested when the
  client supports per-invocation model/effort overrides.

Use plugin-scoped role names internally. User-facing status can show the role
and runtime together, for example `Executor - Sonnet - Running`.

Never instruct the executor-role subagent to spawn a verifier. The executor-role
subagent returns evidence to the Manager phase. Verification starts there; spawn
a verifier-role subagent only when an independent pass is required.

## Public Agent Boundary

The public plugin ships a scoped-worker profile:

- spawn primitive: Claude Code `Agent`;
- public `executor` and `verifier` frontmatter must use an explicit `tools`
  allowlist;
- public `executor` and `verifier` must omit `Agent` from that allowlist, so
  they cannot spawn nested subagents;
- do not use `permissionMode` as the spawn wall for plugin agents;
- if fan-out, fork synthesis or nested delegation is required, stop and return
  to Manager for a separately approved orchestration profile instead of widening
  the public worker role.

Spawned agents start with isolated context. Manager must pass a complete context
bundle directly in the Agent prompt: approved brief, run id, scope, stop
criteria, success criteria, evidence contract and complete prior findings when
they matter. Prior findings should be structured as data, not prose-only
pointers: `claim`, `evidence`, `sourceUrl`, `documentName`, `page`, `file`,
`line`, `verificationStatus`, `confidence` and `agentId` when available.
Allowed verification statuses are `verified`, `unverified` and `claimed`.
Synthesis must preserve those statuses; confidence text does not upgrade
evidence level.

## Execution Shape

Before dispatch, choose the execution shape for the approved brief. Common
shapes include:

- one executor-role run
- phased dispatch with explicit phase boundaries
- parallel scouts/research with synthesis
- executor role plus independent verifier role
- executor role plus provider review
- hands-on direct work when the approved path changes
- ask CEO when authority is missing

The list is a guide for judgment, not an enum. Use phases only when the work has
distinct purpose, dependency boundaries, decision points or different
agent/runtime needs.

For each proposed phase, include:

- purpose
- scope/files
- evidence or return point
- why this phase is separate

## Execution Sizing

Choose `maxTurns` only after the approved brief exists and before spawning the
executor role. The brief supplies the dimensions that make turn sizing possible:

- in-scope files
- scope breadth
- success and stop criteria
- required evidence level
- execution shape, phases and tool needs
- coupling or risk signals such as migrations, hooks, workflow changes or
  cross-area edits

Do not put `maxTurns` in the draft brief. During brief-writing, make the coarse
decomposition call before writing the full proposal, then run the advisory
`brief-sizing-preview` on the selected phase before save/promote. If the preview
returns `userSurface=ask`, pause before approval and confirm the split or
single-run choice with the user. If it returns `inform`, the Manager chooses the
shape, records it, and uses at most one line only when the deliverable lands in
parts. If it returns `silent`, keep the sizing decision in the receipt and keep
the chat clean. That preview is a sanity signal only; it does not authorize
spawn metadata.
Dispatch records the chosen sizing in the local receipt as `executionMaxTurns`
and `executionSizing`; the handoff contract should receive the concrete `run-id`
so spawn metadata can carry the same value forward. Role frontmatter is only a
generic fallback when no dispatch run is available.

The default executor ceiling is a decomposition signal, not a silent failure
mode. If `runtimePolicy.roles.executor.maxTurns` is configured above the default,
it may raise the dispatch ceiling. A lower configured value must not clamp the
brief-derived budget down; use an explicit per-dispatch Manager override only
when the operator intentionally wants a smaller bounded run.

When dispatch sizing is clamped, the receipt marks
`executionSizing.requiresManagerDecision: true` and provides a one-line
`executionSizing.summary`. Manager must handle that before executor spawn by
splitting into phases, using an explicit bounded override with operator approval,
or asking for a decision.

## Agentic Loop Return

`maxTurns` is a runtime loop boundary, not proof of completion. At the spawn
adapter level, continue the loop on `stop_reason=tool_use`: execute the requested
tools, return tool results, and call the role again. The normal terminal condition
is `stop_reason=end_turn` with the executor or verifier report.

If the client reaches `maxTurns` or another turn-limit before the normal report,
return the stop as an orchestration result to Manager. Preserve `runId`, internal
`stopReason=maxTurns_exhausted`, a short plain-language `returnReason`, pending
tool/request state when available, and the known safe continuation. The
operator-facing chat surface should say the work stopped before completion with
pending work, not expose the internal turn-limit label. Manager may then continue
the same run with more budget/context, split the remaining work, or return a
blocked/partial result. Do not collapse turn-limit exhaustion into `ok`.

## Tool Shape

If the approved brief includes `executionShape.toolNeeds`, the adapter derives
toolbank families from those declarations. If the brief has no tool-shape
guidance, use the conservative default unless the missing shape changes scope or
risk. In that case, stop and ask the operator.

Use explicit `toolFamilies` only as a compatibility override. Use `knownGaps`
only when the gap changes the route, stop criteria or approval decision.

## Run Records

Local dispatch writes a queued transport run and event under
`.nogra/transport/`. Dispatch state must keep role and runtime paired, for
example `executionRole: "nogra:executor"` with
`executionRuntime: "anthropic:sonnet"`.
`owner` remains `Manager`. `nextOwner` is the next role id, for example
`nogra:executor`; when dispatch sizing requires a Manager decision, `nextOwner`
returns to `Manager` and the specific action stays in `executionSizing` and
`executionCrossing.nextStep`.

Runtime/model facts stay in the dispatch receipt and handoff metadata. The
executor prompt should not add a separate runtime-settings line.
