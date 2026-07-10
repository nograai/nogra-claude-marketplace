# Status Data Sources

Use these sources when building `/nogra:status`. Keep the visible ledger/state output
compact and human-readable; this reference is for data collection only.

## Version Data

- Current plugin session context for installed plugin id/ref.
- Local runtime status payload when available.

## Runtime State

- Workspace id from the local runtime.
- `.nogra/config.json` for pull-first routing posture and workspace
  language.
- `.nogra/runtime/live-hooks.log`, `.nogra/runtime/live-hooks.jsonl` and
  `.nogra/runtime/live-hooks.latest.json` for local hook/event observability.
  Show only counts, paths and compact summaries; never print prompt bodies,
  tool output or raw event payloads by default.
- `/nogra:watch` uses the same local runtime source for an explicit bounded
  snapshot or opt-in live follow. It is not an always-on monitor.
- Do not show mode fields while local is the only shipped mode. The runtime may
  expose them for tools, but the human status surface should stay
  current-reality-only until a second mode ships.

## Transport State

- Inspect `.nogra/transport/runs/*.json` directly for the newest active run and
  newest run overall.
- When the helper is available, check the newest run with:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "<absolute-workspace-root>" --run-id <runId> --json
```

Use one simple command per Bash tool call with absolute paths. Do not use
`$PWD`, `&&`, heredocs or root assignments in Bash tool calls.

- Show only structured facts: run id, status, phase, target/runtime,
  elapsed/duration, artifact flags and helper consistency result.
- If the newest run includes `verificationRole` / `verificationRuntime`, show
  that pair separately from the executor pair. Do not collapse verifier state
  into `executionRole`.
- If helper status is `inconsistent`, `missing` or `conflict`, surface the
  differences and `nextOwner: Manager`. Do not auto-fix and do not rewrite
  Manager's prose.
