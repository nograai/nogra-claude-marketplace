#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { statusPayload, workspaceRoot } from "./nogra-local.mjs";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function cleanInline(value, maxLength = 80) {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function firstExistingDir(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(String(candidate));
      if (fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Try the next Claude-provided candidate.
    }
  }
  return process.cwd();
}

function statusRoot(input) {
  return firstExistingDir([
    input?.workspace?.current_dir,
    input?.cwd,
    input?.workspace?.project_dir
  ]);
}

function localStatus(root) {
  return statusPayload(workspaceRoot({ root }, { nearestNogra: true }));
}

function hookSegment(status) {
  const liveHooks = status?.continuity?.liveHooks || {};
  const latestEvent = cleanInline(liveHooks.latestEvent || (liveHooks.exists ? "unknown" : "none"), 40);
  const summary = cleanInline(liveHooks.latestSummary, 160);
  const decision = summary.match(/\bdecision=([^\s]+)/u)?.[1] || "";
  return decision ? `hook:${latestEvent}/${cleanInline(decision, 24)}` : `hook:${latestEvent}`;
}

function contextSegment(input) {
  const raw = Number(input?.context_window?.used_percentage);
  if (!Number.isFinite(raw)) return "";
  const pct = Math.max(0, Math.min(100, Math.round(raw)));
  return `ctx:${pct}%`;
}

function formatStatusline(input, status) {
  const workspaceId = cleanInline(status?.workspace?.workspaceId || "unknown", 36);
  const version = cleanInline(status?.plugin?.version || "unknown", 32);
  const checkpoint = cleanInline(status?.ledger?.checkpointStatus || "unknown", 24);
  const continuity = cleanInline(status?.continuity?.status || "unknown", 24);
  const bridge = cleanInline(status?.bridge?.status || "unknown", 24);
  const git = status?.git || {};
  const dirty = git.status === "dirty" && Number.isFinite(Number(git.dirtyCount))
    ? String(Number(git.dirtyCount))
    : cleanInline(git.status || "unknown", 24);
  const promotion = cleanInline(status?.promotion?.status || "unknown", 24);
  const context = contextSegment(input);
  const parts = [
    `Nogra:${workspaceId}`,
    version,
    hookSegment(status),
    `checkpoint:${checkpoint}`,
    `continuity:${continuity}`,
    `bridge:${bridge}`,
    `dirty:${dirty}`,
    `promo:${promotion}`
  ];
  if (context) {
    parts.push(context);
  }
  return parts.join(" ");
}

function main() {
  try {
    const input = parseInput(readStdin());
    const status = localStatus(statusRoot(input));
    console.log(formatStatusline(input, status));
  } catch {
    console.log("Nogra:unknown");
  }
}

main();
