#!/usr/bin/env node

// Nogra UserPromptSubmit pace hook — the operator's tempo as state.
// "slow down" in the operator's own words -> PACE: SLOW (persisted); "full speed" -> NORMAL.
// While SLOW, inject ONE context line per turn. Fails open; never blocks the prompt.
// See runtime/local/pace.mjs and scripts/nogra-pace.mjs.

import { readFileSync } from "node:fs";
import { findWorkspaceRoot } from "../runtime/local/delivery-gate.mjs";
import { matchPhrase, readPace, readPaceConfig, renderPaceContext, writePace } from "../runtime/local/pace.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Only the operator's own text sets the pace — strip injected <tag>…</tag> blocks (system/hook context).
function operatorText(prompt) {
  return String(prompt || "").replace(/<[A-Za-z_][\w-]*>[\s\S]*?<\/[A-Za-z_][\w-]*>/gu, " ");
}

function main() {
  const input = parseInput(readStdin());
  const root = findWorkspaceRoot([
    process.env.CLAUDE_PROJECT_ROOT || "",
    ...(Array.isArray(input.workspace_roots) ? input.workspace_roots : []),
    input.cwd,
    process.cwd()
  ]);
  if (!root) return;
  const config = readPaceConfig(root);
  const text = operatorText(input.prompt || input.message || "");
  let pace = readPace(root);
  const slowHit = text ? matchPhrase(text, config.slowPhrases) : "";
  const normalHit = text ? matchPhrase(text, config.normalPhrases) : "";
  if (slowHit && pace.pace !== "slow") pace = writePace(root, "slow", "operator (prompt)", slowHit, config.workspaceId);
  else if (normalHit && pace.pace === "slow") pace = writePace(root, "normal", "operator (prompt)", normalHit, config.workspaceId);
  if (pace.pace !== "slow") return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: renderPaceContext(pace) }
  }));
}

try {
  main();
} catch {
  // fail open
}
process.exit(0);
