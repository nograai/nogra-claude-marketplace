#!/usr/bin/env node

// Nogra Stop delivery gate — the message to the operator must be a delivery, not a claim.
// See runtime/local/delivery-gate.mjs for the three checks and the workspace config.
// Blocks the stop with a reason the model can act on (add the receipt / move the decision to the
// board / drop the loopback link). When Claude Code reports stop_hook_active (it already blocked
// once this turn) the gate only emits a systemMessage — never a loop. Fails open on any error.
// Workspace opt-out: .nogra/config.json { "deliveryGate": { "enabled": false } }.

import { existsSync, readFileSync } from "node:fs";
import {
  appendGateEvent,
  cleanInline,
  evaluate,
  findWorkspaceRoot,
  readGateConfig,
  recentReceiptHosts
} from "../runtime/local/delivery-gate.mjs";

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

function lastAssistantText(input) {
  const direct = String(input.last_assistant_message || input.lastAssistantMessage || "");
  if (direct.trim()) return direct;
  const transcriptPath = cleanInline(input.transcript_path || input.transcriptPath || "", 1000);
  if (!transcriptPath || !existsSync(transcriptPath)) return "";
  try {
    const lines = readFileSync(transcriptPath, "utf8").split(/\r?\n/u).filter((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.type === "assistant" && Array.isArray(entry.message?.content)) {
        const text = entry.message.content
          .filter((part) => part?.type === "text")
          .map((part) => part.text)
          .join("\n");
        if (text.trim()) return text;
      }
    }
  } catch {
    return "";
  }
  return "";
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
  const config = readGateConfig(root);
  if (!config.enabled) return;
  const text = lastAssistantText(input);
  if (!text) return;

  const reasons = evaluate(text, { config, receiptHosts: recentReceiptHosts(root, config) });
  if (!reasons.length) return;

  const reason = `DELIVERY GATE (Nogra Stop hook): ${reasons.join(" | ")}`;
  if (input.stop_hook_active === true) {
    appendGateEvent(root, config, { decision: "warned", reason, metadata: { stopHookActive: true } });
    process.stdout.write(JSON.stringify({ systemMessage: reason }));
    return;
  }
  appendGateEvent(root, config, { decision: "blocked", reason, metadata: {} });
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

try {
  main();
} catch {
  // fail open
}
process.exit(0);
