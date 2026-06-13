# Nogra State

This folder stores local Nogra records for `{{workspaceName}}`.

`config.json` is the only runtime config file in this root. Workflow records
live in domain folders:

- `state/` - current project state, tasks, decisions and checkpoint.
- `briefs/` - brief records.
- `runs/` - run status records.
- `evidence/` - evidence files and references.
- `receipts/` - operation receipts.
- `reports/` - final reports.
- `checkpoints/` - dated checkpoint snapshots.
- `ledger/` - append-only state facts used for checkpoint freshness.
- `index/` - workspace index, risk intake, behavior score, risk registry and
  expansion guidance.
- `memory/local/` - local continuity notes.
- `memory/sync/` - sync metadata only when sync is enabled.
- `transport/` - dispatch artifacts.
