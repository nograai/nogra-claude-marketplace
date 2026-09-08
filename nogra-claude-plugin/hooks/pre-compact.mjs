#!/usr/bin/env node
// PreCompact — stamp the compaction in the ledger BEFORE the context is folded.
//
// Until 0.9.8 PreCompact was observe-only (live-hook log). The ledger — the one
// writer of "now" — never learned that a session lost its working context, so
// the post-compact SessionStart channel rebuilt its pointer blind. This hook
// appends one `compaction` event (trigger manual|auto, session, transcript)
// through the plugin's single locked ledger door, then records the live event
// as every other observer does. Fail-open: a ledger problem never blocks the
// compaction itself.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendLedgerEvent } from "../runtime/local/ledger-append.mjs";
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
  for (;;) {
    if (hasNograConfig(current)) return current;
    const next = resolve(current, "..");
    if (next === current) return "";
    current = next;
  }
}

function projectRoot(input) {
  const explicitRoot = process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDE_PROJECT_ROOT || process.env.CURSOR_PROJECT_DIR || "";
  if (explicitRoot) return resolve(explicitRoot);
  const workspaceRoot = firstWorkspaceRoot(input);
  if (hasNograConfig(workspaceRoot)) return resolve(workspaceRoot);
  const cwdRoot = nearestNograRoot(cleanInline(input.cwd));
  if (cwdRoot) return cwdRoot;
  return resolve(workspaceRoot || cleanInline(input.cwd) || process.cwd());
}

function workspaceIdOf(root) {
  try {
    const config = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
    return cleanInline(config?.workspaceId) || "workspace";
  } catch {
    return "workspace";
  }
}

const input = parseInput(readStdin());
const root = projectRoot(input);
if (!hasNograConfig(root)) {
  process.exit(0);
}

const eventName = cleanInline(input.hook_event_name || input.hookEventName || "PreCompact");
const trigger = cleanInline(input.trigger) || "unknown";
const sessionId = cleanInline(input.session_id || input.sessionId);
const transcriptPath = cleanInline(input.transcript_path || input.transcriptPath);
const customInstructions = cleanInline(input.custom_instructions || input.customInstructions).slice(0, 200);

captureSessionAnchor(root, input, eventName);

let ledger = "not-written";
try {
  const result = appendLedgerEvent(root, {
    type: "compaction",
    trigger: `pre-compact:${trigger}`,
    workspaceId: workspaceIdOf(root),
    sessionId,
    transcriptId: transcriptPath ? transcriptPath.split("/").pop().replace(/\.jsonl$/u, "") : "",
    summary: `Context compaction (${trigger}) — the session folds its working context; ground again from the ledger tail before current-state claims${customInstructions ? ` · instructions: ${customInstructions}` : ""}`
  });
  ledger = `${result.status}:#${result.event.ledgerWatermark}`;
} catch (error) {
  ledger = `failed:${cleanInline(error?.message).slice(0, 120)}`;
}

captureLiveHookEvent(root, input, { eventName, decision: "observed", note: `compaction trigger=${trigger} ledger=${ledger}` });
