#!/usr/bin/env node
// Nogra Sync — session-end push. Sends the two bounded files to the user's cloud brain,
// but only when they changed since the last push (never pay for unchanged state).
// OFF unless sync is enabled + a token exists. Fail-open: errors leave a receipt, never a crash.

import { syncPush } from "../runtime/local/sync-client.mjs";
import { readFileSync } from "node:fs";

try {
  let input = {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    input = raw ? JSON.parse(raw) : {};
  } catch {}
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  await syncPush(root, { hookInput: input });
} catch {
  // receipts are written inside syncPush; a crash here must never disturb session end
}
process.stdout.write("{}");
