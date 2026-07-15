#!/usr/bin/env node
// PostToolBatch (async): the RAMMEN tick — sync that runs BY ITSELF mid-session, so
// push/pull is never a manual act. Debounced + diff-gated in the client (cheap no-op
// when converged); fail-open by construction — the client logs its own receipts and
// this hook never blocks or delays a batch (async: true).
import { syncTick } from "../runtime/local/sync-client.mjs";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  await syncTick(root);
} catch {
  // fail-open: the receipt (if any) is already on disk; a tick must never break a session
}
process.exit(0);
