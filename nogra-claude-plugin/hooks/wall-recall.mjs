#!/usr/bin/env node
// Wall recall (UserPromptSubmit + PostToolUse + PostToolUseFailure): when the prompt or a tool result
// describes a blocker, search the ledger for earlier events carrying the same symptom and inject the
// latest matches as context BEFORE the next action. Never blocks; silent when nothing matches;
// fail-open on any error. Workspace config: .nogra/config.json → "walls".
import fs from "node:fs";
import { findWorkspaceRoot, readWallsConfig, recallBlock } from "../runtime/local/walls.mjs";

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function pickText(input) {
  const ev = input.hook_event_name || "";
  if (ev === "UserPromptSubmit") return String(input.prompt || "");
  const r = input.tool_response;
  const e = input.error || input.tool_error || "";
  if (typeof r === "string") return r + " " + e;
  if (r && typeof r === "object") return JSON.stringify(r).slice(0, 4000) + " " + e;
  return String(e || "");
}
try {
  const input = JSON.parse(readStdin() || "{}");
  const root = findWorkspaceRoot([process.env.CLAUDE_PROJECT_ROOT || "", input.cwd || "", process.cwd()]);
  if (!root) process.exit(0);
  const config = readWallsConfig(root);
  if (config.enabled === false) process.exit(0);
  const text = pickText(input);
  if (!text || text.length < 8) process.exit(0);
  // Successful tool results recall only on STRONG signals (error page, permission denied, ECONN ...);
  // prompts and failed tool calls keep the full signal set.
  const strong = (input.hook_event_name || "PostToolUse") === "PostToolUse";
  const block = recallBlock(root, text, { config, strong });
  if (!block) process.exit(0);
  const ev = input.hook_event_name || "PostToolUse";
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: block } }));
} catch { /* fail-open */ }
process.exit(0);
