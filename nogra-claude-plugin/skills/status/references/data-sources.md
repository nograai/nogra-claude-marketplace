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

## Anchor State

- `.nogra/state/CURRENT-ANCHOR.json` is the schema-valid current Anchor
  projection.
- `.nogra/checkpoints/anchor-*.json` contains immutable Anchor records.
- `.nogra/state/SESSION-CHECKPOINT.md` is the human-readable compatibility
  projection; it is not the canonical record.
- Compare the Anchor `sourceWatermark` with `.nogra/ledger/events.jsonl`.
- Use the local runtime's `anchorStatus`; do not recompute or collapse
  `stale_ledger` and `stale_git` into a generic success state.
- Never infer verified completion from the Markdown rendering. Preserve
  `verifiedDone`, `claimedDone` and `unknown` from the validated JSON record.

## Fact And Evidence State

- `nogra.fact.v1` records in `.nogra/ledger/events.jsonl` own fact identity.
- `.nogra/state/CURRENT-FACTS.json` is a rebuildable read projection only.
- `.nogra/evidence/evidence-*.json` contains immutable content-addressed
  receipts; artifact digests must still match before the receipt supports a
  fact or verdict.
- Show projection freshness and counts only by default. Do not print claims,
  evidence bodies or memory content unless the user asks for details.
- MEMORY.md, USER.md and sync receipts are advisory projections. They can
  support recall but cannot be reported as verified facts.

## Run And Artifact State

- Inspect canonical `.nogra/runs/*.json` first for the newest active run and
  newest run overall.
- Read `.nogra/transport/runs/*.json` only as the frozen legacy lane. Do not
  silently rewrite a legacy record into v2.
- Execution and validation artifacts remain under
  `.nogra/transport/artifacts/<runId>/`.
- When the helper is available, check the newest run with:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-ledger.mjs" check-run --root "<absolute-workspace-root>" --run-id <runId> --json
```

Use one simple command per Bash tool call with absolute paths. Do not use
`$PWD`, `&&`, heredocs or root assignments in Bash tool calls.

- For `nogra.run.v2`, show `lifecycle`, executor `outcome`, and verifier
  `verdict` as separate facts. A compatibility `status` may be shown for old
  clients, but it must not collapse or overwrite those fields.
- Show only structured facts: run id, lifecycle/outcome/verdict, target/runtime,
  elapsed/duration, artifact flags and helper consistency result.
- If the newest run includes `verificationRole` / `verificationRuntime`, show
  that pair separately from the executor pair. Do not collapse verifier state
  into `executionRole`.
- If helper status is `inconsistent`, `missing` or `conflict`, surface the
  differences and `nextOwner: Manager`. Do not auto-fix and do not rewrite
  Manager's prose.
