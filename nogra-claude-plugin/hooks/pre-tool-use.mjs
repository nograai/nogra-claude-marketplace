#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateToolConvergenceRisk } from "../runtime/local/convergence-guard.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

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

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function firstWorkspaceRoot(input) {
  if (!Array.isArray(input.workspace_roots)) return "";
  return input.workspace_roots.find((entry) => typeof entry === "string" && entry.trim() !== "") || "";
}

function hasNograConfig(root) {
  return Boolean(root) && existsSync(join(resolve(root), ".nogra", "config.json"));
}

function nearestNograRoot(start) {
  if (!start) return "";
  let current = resolve(start);
  while (true) {
    if (hasNograConfig(current)) return current;
    const next = resolve(current, "..");
    if (next === current) return "";
    current = next;
  }
}

function projectRoot(input) {
  const explicitRoot = process.env.CLAUDE_PROJECT_ROOT || process.env.CURSOR_PROJECT_DIR || "";
  if (explicitRoot) return resolve(explicitRoot);

  const workspaceRoot = firstWorkspaceRoot(input);
  if (hasNograConfig(workspaceRoot)) return resolve(workspaceRoot);

  const cwdRoot = nearestNograRoot(cleanInline(input.cwd));
  if (cwdRoot) return cwdRoot;

  return resolve(
    workspaceRoot ||
      cleanInline(input.cwd) ||
      process.cwd()
  );
}

function emitReview(result) {
  if (!result.reviewMessage) return;
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    additionalContext: result.reviewMessage
  };
  if (result.shouldAsk) {
    hookSpecificOutput.permissionDecision = "ask";
    hookSpecificOutput.permissionDecisionReason = result.reviewMessage;
  }
  process.stdout.write(
    JSON.stringify({
      systemMessage: result.reviewMessage,
      hookSpecificOutput
    })
  );
}

const input = parseInput(readStdin());
const root = projectRoot(input);

if (!hasNograConfig(root)) {
  process.exit(0);
}

captureSessionAnchor(root, input, "PreToolUse");

const result = evaluateToolConvergenceRisk({ root, input });
captureLiveHookEvent(root, input, {
  eventName: "PreToolUse",
  decision: result.shouldAsk ? "ask" : result.reviewMessage ? "review" : "silent",
  action: result.action || "",
  reason: result.reason || ""
});
if (!result.reviewMessage) {
  process.exit(0);
}

emitReview(result);
