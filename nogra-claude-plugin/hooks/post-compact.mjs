#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
// Walls: open operational walls ride along in the recovery pointer so a compacted session does not rediscover them.
import { join, resolve } from "node:path";
import { resolveBootContext } from "../runtime/local/boot-context.mjs";
import { renderCacheSafeConvergenceGuardContext } from "../runtime/local/convergence-guard.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

function openWallsBlock(root) {
  try {
    const file = join(resolve(root), ".nogra", "state", "WALLS.md");
    if (!existsSync(file)) return "";
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("- "));
    if (lines.length === 0) return "";
    return `<NOGRA_OPEN_WALLS>\n${lines.slice(0, 6).join("\n")}\nRule: a blocker is a lookup before it is a diagnosis — check these before acting on a symptom.\n</NOGRA_OPEN_WALLS>`;
  } catch { return ""; }
}

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

function emitContext(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    })
  );
}

function compactSource(input) {
  const source = cleanInline(input.source || input.trigger || input.compactSource).toLowerCase();
  return ["manual", "auto", "compact"].includes(source) ? source : "unknown";
}

const input = parseInput(readStdin());
const root = projectRoot(input);

if (!hasNograConfig(root)) {
  process.exit(0);
}

captureSessionAnchor(root, input, "PostCompact");
const source = compactSource(input);
const boot = resolveBootContext({ cwd: root, sessionSource: "compact" });
captureLiveHookEvent(root, input, { eventName: "PostCompact", decision: "context", reason: source });

emitContext(`<!-- nogra-plugin:post-compact source=${source} -->
<NOGRA_COMPACT_POINTER>
workspaceId=${boot.workspaceId || ""}
workspaceRoot=${boot.workspaceRoot || root}
status=${boot.status || ""}
state=${boot.state || ""}

This is a thin recovery pointer after context compaction. Recovery is not Nogra GO and does not authorize continuation. Do not relitigate Nogra routing after compaction. If current-state claims matter, read only the project-local .nogra/state files and current git state needed for those claims.
</NOGRA_COMPACT_POINTER>

${renderCacheSafeConvergenceGuardContext({ root, eventName: "PostCompact" })}

${openWallsBlock(root)}`);
