#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  BOOT_CONTEXT_SCHEMA_V2,
  assertBootContextSemantics
} from "./contract-spine.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      out._.push(value);
      continue;
    }
    const equal = value.indexOf("=");
    if (equal > -1) {
      out[value.slice(2, equal)] = value.slice(equal + 1);
      continue;
    }
    const name = value.slice(2);
    if (["json", "strict"].includes(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) throw new Error(`Missing value for --${name}`);
    out[name] = next;
    index += 1;
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node boot-context.mjs [--cwd <dir>] [--index <jsonl>] [--session-source startup|resume|clear|compact] [--json]",
    "",
    "Read-only. Detects/focuses a Nogra workspace without loading checkpoint or ledger content."
  ].join("\n");
}

function exists(file) {
  try {
    fs.accessSync(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function safeWorkspaceRelativePath(value, fallback) {
  const fallbackValue = cleanInline(fallback).replaceAll("\\", "/");
  const raw = cleanInline(value || fallbackValue).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.includes("\0")) return fallbackValue;
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) return fallbackValue;
  return parts.join("/");
}

function workspaceFile(root, value, fallback) {
  return path.join(root, safeWorkspaceRelativePath(value, fallback));
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nearestWorkspace(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    const configPath = path.join(current, ".nogra", "config.json");
    if (exists(configPath)) return { root: current, configPath, config: readJson(configPath) };
    const next = path.dirname(current);
    if (next === current) return null;
    current = next;
  }
}

function defaultIndexPath() {
  return path.join(os.homedir(), ".nogra", "index", "workspaces.jsonl");
}

function readWorkspaceIndex(indexPath) {
  if (!indexPath || !exists(indexPath)) return [];
  const entries = [];
  for (const line of fs.readFileSync(indexPath, "utf8").split(/\r?\n/u).filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.path) entries.push({ ...entry, path: path.resolve(String(entry.path)) });
    } catch {
      // One malformed registry line must not widen boot.
    }
  }
  return entries;
}

function resolveWorkspaceIndexPath(root, config, explicitIndex) {
  if (explicitIndex) return path.resolve(explicitIndex);
  const configured = config?.paths?.workspaceIndex;
  if (typeof configured === "string" && configured.trim()) {
    return path.isAbsolute(configured) ? configured : path.join(root, configured);
  }
  return defaultIndexPath();
}

function normalizeSessionSource(value) {
  const source = cleanInline(value).toLowerCase();
  return ["startup", "resume", "clear", "compact"].includes(source) ? source : "unknown";
}

function stateFor(status, sessionSource) {
  if (status === "missing") return "fresh";
  if (status === "ambiguous" || status === "hub") return "detected";
  if (sessionSource === "resume") return "resumed";
  if (sessionSource === "compact") return "recovering";
  return "focused";
}

function candidate(entry) {
  return {
    workspaceId: cleanInline(entry.workspaceId),
    workspaceName: cleanInline(entry.workspaceName || entry.workspaceId || path.basename(entry.path)),
    path: path.resolve(entry.path),
    lastCheckpointSummary: cleanInline(entry.lastCheckpointSummary)
  };
}

function checkpointSignal(root, config) {
  const file = workspaceFile(root, config?.paths?.currentCheckpoint, ".nogra/state/SESSION-CHECKPOINT.md");
  const available = exists(file);
  return {
    checkpointAvailable: available,
    checkpointLoaded: false,
    checkpointStatus: available ? "available" : "missing"
  };
}

function finish(value) {
  return assertBootContextSemantics({
    schema: BOOT_CONTEXT_SCHEMA_V2,
    state: stateFor(value.status, value.sessionSource),
    source: "",
    workspaceName: "",
    workspaceId: "",
    workspaceRoot: "",
    stateRoot: "",
    focusReason: "none",
    checkpointAvailable: false,
    checkpointLoaded: false,
    checkpointStatus: "missing",
    candidates: [],
    writes: [],
    autoLoaded: false,
    authorization: "none",
    message: "",
    ...value
  });
}

function focusedWorkspace(root, config, source, focusReason, sessionSource) {
  const name = cleanInline(config?.workspaceName || config?.workspaceId || path.basename(root));
  const checkpoint = checkpointSignal(root, config);
  const state = stateFor("project", sessionSource);
  const stateLine =
    state === "resumed"
      ? "Claude Code supplied an explicit native resume signal."
      : state === "recovering"
        ? "Claude Code supplied a compact recovery signal."
        : "The runtime project root focuses this workspace; it does not resume prior work.";
  const checkpointLine = checkpoint.checkpointAvailable
    ? "A local checkpoint is available as a pull-only continuity signal; its contents were not loaded."
    : "No local checkpoint was detected.";
  return finish({
    status: "project",
    sessionSource,
    source,
    workspaceName: name,
    workspaceId: cleanInline(config?.workspaceId || name),
    workspaceRoot: root,
    stateRoot: config?.paths?.stateRoot || ".nogra/state",
    focusReason,
    ...checkpoint,
    message: [
      `Hi. I am focused on \`${name}\`.`,
      stateLine,
      checkpointLine,
      "Current-state reads remain lazy, and no boot state grants GO or authorizes continuation."
    ].join("\n")
  });
}

function detectedProjects(cwd, entries, sessionSource, status = "ambiguous", source = "workspace-index-detection") {
  const sorted = entries
    .slice()
    .sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")))
    .slice(0, 8)
    .map(candidate);
  const names = sorted.map((entry) => `\`${entry.workspaceName}\``).join(", ");
  return finish({
    status,
    sessionSource,
    source,
    focusReason: status === "hub" ? "workspace-hub" : "workspace-index-detection",
    candidates: sorted,
    message: sorted.length
      ? `Nogra detected ${names}. Choose a project to focus it; no checkpoint or ledger content was loaded.`
      : "Nogra detected a workspace hub with no registered projects. No state was loaded."
  });
}

function managerHubOptions(config) {
  const policy = config?.bootPolicy || {};
  const hub =
    policy.workspaceHub && typeof policy.workspaceHub === "object"
      ? policy.workspaceHub
      : policy.managerHub && typeof policy.managerHub === "object"
        ? policy.managerHub
        : {};
  const enabled =
    policy.workspaceHub === true ||
    policy.managerHub === true ||
    hub.enabled === true ||
    policy.mode === "workspace-hub" ||
    policy.mode === "manager-hub";
  return { enabled, hub, policy };
}

function managerHub(root, config, entries, sessionSource) {
  const name = cleanInline(config?.workspaceName || config?.workspaceId || path.basename(root));
  const workspaceId = cleanInline(config?.workspaceId || name);
  const { hub, policy } = managerHubOptions(config);
  const maxProjects = Number(hub.maxProjects || policy.maxRecentProjects || 8);
  const exclude = new Set(
    (Array.isArray(hub.excludeWorkspaceIds) ? hub.excludeWorkspaceIds : [])
      .map(cleanInline)
      .filter(Boolean)
  );
  if (hub.includeSelf !== true) exclude.add(workspaceId);
  const selected = entries
    .filter((entry) => !exclude.has(cleanInline(entry.workspaceId)))
    .sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")))
    .slice(0, maxProjects);
  const detected = detectedProjects(root, selected, sessionSource, "hub", "workspace-hub-index");
  return finish({
    ...detected,
    workspaceName: name,
    workspaceId,
    workspaceRoot: root,
    stateRoot: config?.paths?.stateRoot || ".nogra/state",
    message: [
      `Hi. I am in the \`${name}\` workspace hub.`,
      detected.message,
      "The hub itself is detected, not resumed; say the project name to focus it."
    ].join("\n")
  });
}

function missing(cwd, sessionSource) {
  return finish({
    status: "missing",
    sessionSource,
    source: "none",
    message: `Hi. I do not find Nogra state at \`${cwd}\`.\nSay the project, or run \`/nogra:setup\` here.`
  });
}

export function resolveBootContext(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const sessionSource = normalizeSessionSource(options.sessionSource);
  const nearest = nearestWorkspace(cwd);
  if (nearest) {
    if (managerHubOptions(nearest.config).enabled) {
      const indexPath = resolveWorkspaceIndexPath(nearest.root, nearest.config, options.index);
      return managerHub(nearest.root, nearest.config, readWorkspaceIndex(indexPath), sessionSource);
    }
    return focusedWorkspace(nearest.root, nearest.config, "nearest-cwd", "runtime-project-root", sessionSource);
  }

  const indexPath = path.resolve(options.index || defaultIndexPath());
  const entries = readWorkspaceIndex(indexPath);
  const containing = entries
    .filter((entry) => isInside(cwd, entry.path))
    .sort((left, right) => right.path.length - left.path.length);
  if (containing.length > 0) {
    const entry = containing[0];
    const configPath = path.join(entry.path, ".nogra", "config.json");
    const config = exists(configPath)
      ? readJson(configPath)
      : { workspaceName: entry.workspaceName, workspaceId: entry.workspaceId, paths: { stateRoot: entry.stateRoot } };
    return focusedWorkspace(entry.path, config, "workspace-index-containing", "cwd-contained", sessionSource);
  }

  const contained = entries.filter((entry) => isInside(entry.path, cwd));
  if (contained.length > 0) return detectedProjects(cwd, contained, sessionSource);
  return missing(cwd, sessionSource);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = resolveBootContext({
    cwd: args.cwd,
    index: args.index,
    sessionSource: args["session-source"]
  });
  console.log(args.json ? JSON.stringify(result, null, 2) : result.message);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`boot-context: ${error.message}`);
    process.exit(1);
  });
}
