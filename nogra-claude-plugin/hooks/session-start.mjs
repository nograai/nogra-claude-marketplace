#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveBootContext } from "../runtime/local/boot-context.mjs";
import { renderConvergenceGuardContext } from "../runtime/local/convergence-guard.mjs";
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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : "";
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

  const cwdRoot = nearestNograRoot(nonEmptyString(input.cwd));
  if (cwdRoot) return cwdRoot;

  return resolve(
    workspaceRoot ||
      nonEmptyString(input.cwd) ||
      process.cwd()
  );
}

function readConfig(root) {
  const configPath = join(root, ".nogra", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function pluginInstallInfo() {
  const root = resolve(process.env.CLAUDE_PLUGIN_ROOT || join(new URL(".", import.meta.url).pathname, ".."));
  const parts = root.split(/[\\/]+/u).filter(Boolean);
  const cacheIndex = parts.lastIndexOf("cache");
  let source = "source";
  let name = "nogra";
  let ref = "";

  if (cacheIndex >= 0 && parts.length > cacheIndex + 3) {
    source = parts[cacheIndex + 1] || source;
    name = parts[cacheIndex + 2] || name;
    ref = parts[cacheIndex + 3] || "";
  }

  const pluginJson = readConfigJson(join(root, ".claude-plugin", "plugin.json"));
  const declaredName = cleanLabel(pluginJson?.name, name);
  const declaredVersion = cleanLabel(pluginJson?.version, "");
  return {
    id: source === "source" ? declaredName : `${declaredName}@${source}`,
    ref: ref || declaredVersion || "source",
    root,
  };
}

function readConfigJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function cleanLabel(value, fallback = "") {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ") : fallback;
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

function bootContextBlock(root) {
  const boot = resolveBootContext({ cwd: root });
  const lines = [
    "<NOGRA_BOOT_CONTEXT>",
    boot.message,
    "",
    `status=${boot.status}`,
    `workspaceId=${boot.workspaceId || ""}`,
    `workspaceRoot=${boot.workspaceRoot || ""}`,
    `ledgerWatermark=${boot.ledgerWatermark ?? 0}`,
    `checkpointSourceWatermark=${boot.checkpointSourceWatermark ?? 0}`,
    `checkpointStatus=${boot.checkpointStatus || "fresh"}`,
    "writes=[]",
    "autoLoaded=false",
    "</NOGRA_BOOT_CONTEXT>"
  ];
  return `<!-- nogra-plugin:boot-context status=${boot.status} -->\n${lines.join("\n")}`;
}

function sessionStartSource(input) {
  const source = cleanLabel(input.source || input.trigger || input.sessionStartSource || "", "").toLowerCase();
  return ["startup", "resume", "clear", "compact"].includes(source) ? source : "startup";
}

function sessionBootContext(root, config, source) {
  const plugin = pluginInstallInfo();
  return `<!-- nogra-plugin:session-boot source=${source} -->
<NOGRA_SESSION_BOOT>
Nogra plugin: ${plugin.id} ref=${plugin.ref}.
Nogra is pull-first. Explicit /nogra:* commands and direct Nogra requests start Nogra flows; ordinary workspace work stays direct.
Use the thin Nogra intent router from workspace guidance/skills to choose a flow; if no Nogra route matches, stay direct.
Hooks keep local workspace/project/session context visible. They do not score prompts, write routing telemetry, dispatch, verify, spawn agents, draft briefs or promote checkpoints.
PreToolUse is a narrow deterministic convergence gate for git/action risk only. It does not score prompts or start Nogra flows; it asks when a permanent-risk tool call has no current dispatch receipt.
Session state lives in local .nogra/ records. Ledger state is the truth source; checkpoint state is a human-readable projection.
</NOGRA_SESSION_BOOT>

${bootContextBlock(root)}

${renderConvergenceGuardContext({ root, eventName: "SessionStart" })}`;
}

function resumePointerContext(root, config, source) {
  const boot = resolveBootContext({ cwd: root });
  const plugin = pluginInstallInfo();
  return `<!-- nogra-plugin:session-resume source=${source} -->
<NOGRA_SESSION_RESUME>
Nogra plugin: ${plugin.id} ref=${plugin.ref}.
workspaceId=${boot.workspaceId || ""}
workspaceRoot=${boot.workspaceRoot || root}
ledgerWatermark=${boot.ledgerWatermark ?? 0}
checkpointSourceWatermark=${boot.checkpointSourceWatermark ?? 0}
checkpointStatus=${boot.checkpointStatus || "fresh"}
status=${boot.status || ""}

This is a continuity pointer after a resumed session. Do not treat compacted or resumed chat summaries as project truth. If current-state claims matter, read the project-local .nogra/state files before acting.
</NOGRA_SESSION_RESUME>

${renderConvergenceGuardContext({ root, eventName: "SessionStart" })}`;
}

const input = parseInput(readStdin());
const root = projectRoot(input);
const config = readConfig(root);

if (!config) {
  const plugin = pluginInstallInfo();
  emitContext(`<!-- nogra-plugin:installed-status -->
<NOGRA_PLUGIN_STATUS>
Current installed Nogra plugin: ${plugin.id} ref=${plugin.ref}.
This folder is not Nogra-initialized yet because .nogra/config.json was not found.

When the user asks for Nogra ledger/state or version, include this plugin ref and say the folder is not initialized. If the user asks what to do next, suggest /nogra:setup.
</NOGRA_PLUGIN_STATUS>`);
  process.exit(0);
}

const source = sessionStartSource(input);
captureSessionAnchor(root, input, "SessionStart");
captureLiveHookEvent(root, input, { eventName: "SessionStart", decision: "context", reason: source });

if (source === "resume") {
  emitContext(resumePointerContext(root, config, source));
} else {
  emitContext(sessionBootContext(root, config, source));
}
