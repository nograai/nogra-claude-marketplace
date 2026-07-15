#!/usr/bin/env node
// Nogra Sync — session-start pull. Runs BEFORE memory-load so the pin and the bound read a
// freshly merged home. OFF unless .nogra/config.json has sync.enabled + a token exists.
// Fail-open: any error emits a one-line note and never blocks the session.

import { syncPull, syncNudge } from "../runtime/local/sync-client.mjs";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  // Knock BEFORE the pull: "diff" must mean lines a previous session never pushed,
  // not the noise of the merge that is about to happen. Facts only — the Manager
  // turns them into the operator's register.
  let nudge = "";
  try {
    nudge = syncNudge(root);
  } catch {}
  const note = await syncPull(root);
  emit([nudge, note].filter(Boolean).join("\n"));
} catch {
  emit(""); // never break session start
}
