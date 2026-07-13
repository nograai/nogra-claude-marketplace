#!/usr/bin/env node
// Nogra Sync — session-end push. Sends the two bounded files to the user's cloud brain,
// but only when they changed since the last push (never pay for unchanged state).
// OFF unless sync is enabled + a token exists. Fail-open: errors leave a receipt, never a crash.

import { syncPush } from "../runtime/local/sync-client.mjs";

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  await syncPush(root);
} catch {
  // receipts are written inside syncPush; a crash here must never disturb session end
}
process.stdout.write("{}");
