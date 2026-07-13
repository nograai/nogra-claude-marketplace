#!/usr/bin/env node
// Nogra Sync — session-start pull. Runs BEFORE memory-load so the pin and the bound read a
// freshly merged home. OFF unless .nogra/config.json has sync.enabled + a token exists.
// Fail-open: any error emits a one-line note and never blocks the session.

import { syncPull } from "../runtime/local/sync-client.mjs";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const note = await syncPull(root);
  emit(note);
} catch {
  emit(""); // never break session start
}
