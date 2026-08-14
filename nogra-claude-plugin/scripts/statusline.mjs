#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compatibilityRunStatus, listRunRecords } from "../runtime/local/contract-spine.mjs";
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

// Gate-mode + active-run/executor segments: read-only projections mirroring
// the operator reference statusline (label grammar + filter rules), so a
// user watching the shipped statusline sees the same gate state and
// delegation chain visibility. Every reader below fails open to "" on any
// error — never throws, never writes.

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function dateMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const TERMINAL_TRANSPORT_STATUSES = new Set(["returned", "ok", "partial", "blocked", "failed", "cancelled", "acknowledged"]);
const STATUSLINE_ACTIVE_RUN_STATUSES = new Set(["queued", "running", "returning", "in_progress"]);
const STATUSLINE_RUN_TTL_MS = 12 * 60 * 60 * 1000;

function readTransportRuns(root) {
  if (!root) return [];
  try {
    return listRunRecords(root)
      .map((record) => {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(record.sourcePath).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return { ...record, __mtimeMs: mtimeMs };
      });
  } catch {
    return [];
  }
}

function runSortMs(record) {
  return Math.max(dateMs(record.updatedAt), dateMs(record.completedAt), dateMs(record.createdAt), asNumber(record.__mtimeMs, 0));
}

function runStatusOf(record) {
  return cleanInline(compatibilityRunStatus(record), 32).toLowerCase();
}

function runAgeMs(record) {
  const anchor = dateMs(record?.updatedAt) || dateMs(record?.createdAt) || runSortMs(record);
  return anchor ? Date.now() - anchor : 0;
}

function runNextOwner(record) {
  return cleanInline(record?.nextOwner || record?.metadata?.nextOwner || "", 64);
}

function runRequiresManagerDecision(record) {
  return Boolean(
    record?.requiresManagerDecision ||
      record?.executionSizing?.requiresManagerDecision ||
      record?.metadata?.executionSizing?.requiresManagerDecision ||
      record?.metadata?.requiresManagerDecision ||
      record?.executionCrossing?.sizingDecisionRequired
  );
}

function isActiveTransportRun(record) {
  const status = runStatusOf(record);
  if (!status || TERMINAL_TRANSPORT_STATUSES.has(status)) return false;
  if (!STATUSLINE_ACTIVE_RUN_STATUSES.has(status)) return false;
  if (!cleanInline(record?.briefId, 128)) return false;
  if (runRequiresManagerDecision(record)) return false;
  if (!runNextOwner(record).startsWith("nogra:")) return false;
  return runAgeMs(record) <= STATUSLINE_RUN_TTL_MS;
}

function shortRunId(runId) {
  const cleaned = cleanInline(runId, 128);
  const parts = cleaned.split("-").filter(Boolean);
  const suffix = parts[parts.length - 1] || cleaned;
  return suffix.length <= 12 ? suffix : suffix.slice(-8);
}

function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Math.floor(asNumber(seconds, 0)));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h${remainingMinutes}m` : `${hours}h`;
}

function runExecutorModel(record) {
  const runtime = cleanInline(record?.executionRuntime || record?.metadata?.executionRuntime || record?.targetModel, 64);
  const alias = runtime.includes(":") ? runtime.split(":").pop() : runtime;
  if (alias) return alias.charAt(0).toUpperCase() + alias.slice(1);
  const label = cleanInline(record?.executionLabel, 160);
  const mid = label.split("·")[1];
  return mid ? mid.trim() : "";
}

function activeRunSegment(root) {
  try {
    const activeRuns = readTransportRuns(root)
      .filter(isActiveTransportRun)
      .sort((a, b) => runSortMs(b) - runSortMs(a));
    if (!activeRuns.length) return "";

    const run = activeRuns[0];
    const status = runStatusOf(run);
    const phase = cleanInline(run.lifecycle || run.phase, 32).toLowerCase();
    const state = phase && phase !== status ? `${status}/${phase}` : status;
    const startMs = dateMs(run.createdAt) || dateMs(run.updatedAt) || runSortMs(run);
    const elapsed = startMs ? formatElapsed((Date.now() - startMs) / 1000) : "";
    const extra = activeRuns.length > 1 ? ` +${activeRuns.length - 1}` : "";
    const model = runExecutorModel(run);
    const executor = model ? `▶ executor: ${model} · ` : "";

    return executor + [`Run ${shortRunId(run.runId)}`, state, elapsed].filter(Boolean).join(" ") + extra;
  } catch {
    return "";
  }
}

// gate accepts legacy string form ("hard"/"advisory") or object form
// { mode, autoApprove }. Literal true only — the
// statusline is a visibility surface for standing delegations, so it must
// never show ON for anything but an explicit opt-in. Mirrors the reference
// gateState/gateLabel grammar exactly.
function gateState(config) {
  const gate = config?.gate;
  if (typeof gate === "string") {
    return { mode: cleanInline(gate, 24).toLowerCase() || "advisory", autoApprove: false };
  }
  if (gate && typeof gate === "object") {
    return {
      mode: cleanInline(gate.mode, 24).toLowerCase() || "advisory",
      autoApprove: gate.autoApprove === true
    };
  }
  return { mode: "advisory", autoApprove: false };
}

function gateLabel(config) {
  const state = gateState(config);
  const auto = state.autoApprove ? "auto ON" : "auto off";
  const hard = state.mode === "hard" ? " · hard" : "";
  return `Nogra ⛩ ${auto}${hard}`;
}

function gateSegment(root) {
  try {
    if (!root) return "";
    const config = readJsonFile(path.join(root, ".nogra", "config.json"));
    if (!config) return "";
    return gateLabel(config);
  } catch {
    return "";
  }
}

function formatStatusline(input, status) {
  const workspaceId = cleanInline(status?.workspace?.workspaceId || "unknown", 36);
  const version = cleanInline(status?.plugin?.version || "unknown", 32);
  const anchor = cleanInline(status?.ledger?.anchorStatus || "unknown", 24);
  const continuity = cleanInline(status?.continuity?.status || "unknown", 24);
  const activeIntent = status?.continuity?.activeIntent?.active ? "active" : "";
  const bridge = cleanInline(status?.bridge?.status || "unknown", 24);
  const git = status?.git || {};
  const dirty = git.status === "dirty" && Number.isFinite(Number(git.dirtyCount))
    ? String(Number(git.dirtyCount))
    : cleanInline(git.status || "unknown", 24);
  const promotion = cleanInline(status?.promotion?.status || "unknown", 24);
  const context = contextSegment(input);
  const root = status?.workspace?.root || "";
  const gate = gateSegment(root);
  const activeRun = activeRunSegment(root);
  const parts = [
    `Nogra:${workspaceId}`,
    version,
    hookSegment(status),
    `anchor:${anchor}`,
    `continuity:${continuity}`,
    activeIntent ? `intent:${activeIntent}` : "",
    `bridge:${bridge}`,
    `dirty:${dirty}`,
    `promo:${promotion}`,
    gate,
    activeRun
  ];
  if (context) {
    parts.push(context);
  }
  return parts.filter(Boolean).join(" ");
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
