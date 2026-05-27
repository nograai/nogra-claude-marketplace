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

Runtime/model facts stay in the dispatch receipt and handoff metadata. The
executor prompt should not add a separate runtime-settings line.
