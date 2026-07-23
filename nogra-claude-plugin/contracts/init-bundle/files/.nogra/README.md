# Nogra State

Local Nogra records for `{{workspaceName}}`. `config.json` is the only
runtime config file in this root; everything else lives in domain folders:

- `state/` - current Anchor/fact projections, tasks and decisions.
- `briefs/`, `runs/`, `evidence/`, `receipts/`, `reports/` - workflow records.
  Canonical evidence receipts are immutable, content-addressed JSON.
- `checkpoints/` - immutable semantic Anchor records and legacy dated
  snapshots. `ledger/` - append-only workflow events and canonical fact identity.
- `index/` - workspace map, risk intake, explicit scenario-grading record and
  expansion guidance. It is never populated from transcript wording or hooks.
- `memory/sync/` - sync metadata lane (durable memory lives in Claude's
  native store, not under `.nogra/`). Native memory is advisory projection
  context; it cannot upgrade ledger facts.
- `transport/` - dispatch artifacts.
