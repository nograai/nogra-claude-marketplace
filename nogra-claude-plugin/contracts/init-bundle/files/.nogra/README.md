# Nogra State

Local Nogra records for `{{workspaceName}}`. `config.json` is the only
runtime config file in this root; everything else lives in domain folders:

- `state/` - project state, tasks, decisions, checkpoint.
- `briefs/`, `runs/`, `evidence/`, `receipts/`, `reports/` - workflow records.
- `checkpoints/` - dated snapshots. `ledger/` - checkpoint-freshness facts.
- `index/` - workspace map, risk intake, behavior score, expansion guidance.
- `memory/local/` - advisory continuity. `memory/sync/` - sync metadata,
  only when sync is enabled.
- `transport/` - dispatch artifacts.
