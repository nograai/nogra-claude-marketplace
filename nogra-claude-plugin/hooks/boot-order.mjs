#!/usr/bin/env node

// Bounded SessionStart boot-state adapter. Checkpoint existence is detection,
// never proof that Claude Code resumed and never authorization to continue.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBootContext } from "../runtime/local/boot-context.mjs";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" }
    })
  );
}

function readInput() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function render(boot) {
  if (boot.state === "fresh") return "";
  const common = [
    "<nogra-boot-state>",
    `state=${boot.state}`,
    `sessionSource=${boot.sessionSource}`,
    `workspaceId=${boot.workspaceId}`,
    `workspaceRoot=${boot.workspaceRoot}`,
    `checkpointAvailable=${boot.checkpointAvailable}`,
    "checkpointLoaded=false",
    "authorization=none"
  ];
  if (boot.state === "detected") {
    common.push(
      "Nogra state was detected but no project was focused. Ask the operator to choose; do not load project checkpoints or ledger state before focus."
    );
  } else if (boot.state === "focused") {
    common.push(
      "The runtime focused this workspace. This is not a resume signal. Load checkpoint, tasks or ledger only when the user's intent needs continuity."
    );
  } else if (boot.state === "resumed") {
    common.push(
      "Claude Code supplied an explicit native resume signal. If continuing prior work, read SESSION-CHECKPOINT.md and CURRENT-TASKS.md, then reconcile factual claims with the ledger. Native resume is not Nogra GO."
    );
  } else if (boot.state === "recovering") {
    common.push(
      "Claude Code supplied a compact recovery signal. Treat summaries as pointers; re-read only the project-local state needed for current claims. Recovery is not Nogra GO."
    );
  }
  common.push(
    "A checkpoint is a continuity signal only. A brief is never GO, and no boot state authorizes dispatch, mutation or the next phase.",
    "</nogra-boot-state>"
  );
  return common.join("\n");
}

try {
  const input = readInput();
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const boot = resolveBootContext({ cwd: root, sessionSource: input.source });
  emit(render(boot));
} catch {
  emit("");
}
