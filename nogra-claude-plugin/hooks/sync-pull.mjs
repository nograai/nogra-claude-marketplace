#!/usr/bin/env node
// Nogra Sync — ordered SessionStart memory adapter. Pull first, then render
// USER pin/bound from the same resolved native memory identity.

import { syncPull, syncNudge } from "../runtime/local/sync-client.mjs";
import { readFileSync } from "node:fs";
import { memoryContext } from "./memory-load.mjs";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

try {
  let input = {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    input = raw ? JSON.parse(raw) : {};
  } catch {}
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  // Knock BEFORE the pull: "diff" must mean lines a previous session never pushed,
  // not the noise of the merge that is about to happen. Facts only — the Manager
  // turns them into the operator's register.
  let nudge = "";
  try {
    nudge = syncNudge(root, { hookInput: input });
  } catch {}
  const note = await syncPull(root, { hookInput: input });
  const memory = memoryContext(input);
  emit([nudge, note, memory].filter(Boolean).join("\n"));
} catch {
  emit(""); // never break session start
}
