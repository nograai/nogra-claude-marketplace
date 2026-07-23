# Project Structure

Workspace: {{workspaceName}}
Generated: {{generatedAt}}

## Roots

- Workspace root: `{{workspacePath}}`
- Nogra state root: `.nogra/`

## Local State Lanes

- `.nogra/state/` - current Anchor/fact projections, tasks and decisions.
- `.nogra/briefs/` - brief records.
- `.nogra/runs/` - run status records.
- `.nogra/evidence/` - immutable canonical evidence receipts and their artifacts.
- `.nogra/receipts/` - operation receipts.
- `.nogra/reports/` - final reports.
- `.nogra/checkpoints/` - immutable semantic Anchors and legacy dated snapshots.
- `.nogra/ledger/` - append-only workflow events and canonical fact records.
- `.nogra/index/` - workspace/project index, risk intake, explicit
  scenario-grading record, connections/risk registry and expansion guidance.
  Hooks and transcript wording never populate the grading record.
- `.nogra/memory/sync/` - sync metadata lane. Durable memory lives in
  Claude Code's native Auto Memory store, not under `.nogra/`; memory remains
  an advisory projection rather than fact authority.
- `.nogra/transport/` - dispatch artifacts.

## Hub Shape

If this workspace manages several projects, use:

```text
projects/
  <workspaceId>/
    .nogra/
```

Hub `.nogra/` owns project discovery. Project `.nogra/` owns project state.
