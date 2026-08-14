# Nogra Contract Spine

The canonical local workflow is:

```text
nogra.brief.v1
  -> nogra.approval.v1
  -> nogra.run.v2
  -> nogra.role.lease.v1
  -> nogra.role.report.v1
  -> nogra.run.event.v2
  -> nogra.evidence.v1
  -> nogra.verdict.v1
```

`brief.v1` remains the stable brief contract. `run.v2` is the canonical run
contract and separates `lifecycle`, executor `outcome`, and verifier `verdict`.
Approvals carry both the canonical brief hash and a dispatch `actionHash`; they
are single-use dispatch capabilities. Canonical run
records live under `.nogra/runs/`, canonical run events share the append-only
`.nogra/ledger/events.jsonl`, and execution/validation artifacts remain under
`.nogra/transport/artifacts/`.

`nogra.evidence.v1` is an immutable, content-addressed observation receipt.
Artifact digests are computed from workspace-local files. A canonical ship
verdict must reference at least one evidence ID; free-text evidence references
cannot satisfy verification.

`nogra.fact.v1` shares the append-only ledger but sits beside the workflow
spine. One stable subject has at most one active fact. Corrections and evidence
upgrades require explicit `supersedes`, evidence strength cannot regress, and
memory/sync sources are capped at `reported`. `.nogra/state/CURRENT-FACTS.json`
is only a rebuildable projection; ledger records own identity.

`nogra.dispatch.receipt.v2` is the validated command-response projection that
embeds the consumed approval and canonical run. It is not itself a run record.

`nogra.role.lease.v1` is a short-lived, Manager-issued capability for one
run revision and one public role. Executor leases bind writable paths to the
approved brief; Verifier leases contain only Read, Grep and Glob. `agent_type`
and `agent_id` bind the active Claude subagent at PreToolUse. Missing, expired,
mismatched and out-of-scope leases fail closed.

`nogra.role.report.v1` is the schema-valid return boundary. Executor reports
remain claims and cannot recommend a verdict. Verifier reports are read-only
recommendations bound to canonical evidence. Manager alone writes
`nogra.verdict.v1`.

`nogra.boot.context.v2` and `nogra.memory.resolution.v1` are Claude-adapter
contracts beside the provider-neutral workflow spine. Boot context exposes
`fresh`, `detected`, `focused`, `resumed` and `recovering` without loading
checkpoint contents or granting authority. Native memory resolution records
the settings/runtime/repository provenance used by pinning, sync, diagnostics
and consolidation; unresolved, disabled and unsafe default paths fail closed.

`nogra.transcript.diagnostic.v1` is an optional Claude-adapter diagnostic, not
part of the workflow spine. It can run only through the explicit user-only
`/nogra:transcript-diagnostic` skill or direct local command. It has no numeric
score, severity, permission decision, GO inference, routing/dispatch effect,
evidence/fact upgrade or verdict. Preview is read-only; persistence requires
an explicit `--write`.

`run.v1`, `run-event.v1`, `nogra.transport.run.v1`, and
`nogra.transport.event.v1` are frozen legacy read formats. Runtime readers may
project them into the current status surface, but writers must not silently
rewrite them or create new shadow legacy records.

Every bundled schema uses the Draft 2020-12 dialect. The dependency-free local
validator is bundle-closed: all schema keywords used here must be implemented,
and the conformance smoke fails if a new unsupported keyword is introduced.

`nogra.anchor.v1` is the canonical continuity contract beside the workflow
spine. It does not grant GO or add a run lifecycle state. Immutable Anchor
records live under `.nogra/checkpoints/`; the current JSON and Markdown files
under `.nogra/state/` are atomic projections. Anchor keeps `verifiedDone`,
`claimedDone` and `unknown` separate, binds approved authority to canonical
brief/approval hashes, binds completion claims to active canonical facts, and
binds freshness to both ledger watermark and Git state.

Legacy `SESSION-CHECKPOINT.md` files are preserved and may continue to provide
a human resume hint. Setup adds the current Anchor path to config, but it never
converts legacy prose into `verifiedDone`. The first `/nogra:anchor` call
creates the canonical JSON record from explicitly classified, validated input.
