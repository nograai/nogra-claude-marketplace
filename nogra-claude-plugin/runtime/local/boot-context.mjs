#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      out._.push(value);
      continue;
    }
    const eq = value.indexOf("=");
    if (eq > -1) {
      out[value.slice(2, eq)] = value.slice(eq + 1);
      continue;
    }
    const name = value.slice(2);
    if (["json", "strict"].includes(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    out[name] = next;
    i += 1;
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node boot-context.mjs [--cwd <dir>] [--index <jsonl>] [--json]",
    "",
    "Read-only. Resolves the current Nogra workspace and emits a tiny boot hint."
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
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readText(file, maxBytes = 20000) {
  const buffer = fs.readFileSync(file);
  return buffer.subarray(0, maxBytes).toString("utf8");
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function safeWorkspaceRelativePath(value, fallback) {
  const fallbackValue = cleanInline(fallback).replaceAll("\\", "/");
  const raw = cleanInline(value || fallbackValue).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.includes("\0")) {
    return fallbackValue;
  }
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) {
    return fallbackValue;
  }
  return parts.join("/");
}

function workspaceFile(root, value, fallback) {
  return path.join(root, safeWorkspaceRelativePath(value, fallback));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function nearestWorkspace(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    const configPath = path.join(current, ".nogra", "config.json");
    if (exists(configPath)) {
      return { root: current, configPath, config: readJson(configPath) };
    }
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
  const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.path) {
        entries.push({ ...entry, path: path.resolve(String(entry.path)) });
      }
    } catch {
      // Ignore invalid registry lines. Boot must be quiet.
    }
  }
  return entries;
}

function resolveWorkspaceIndexPath(root, config, explicitIndex) {
  if (explicitIndex) return path.resolve(explicitIndex);
  const configured = config?.paths?.workspaceIndex;
  if (typeof configured === "string" && configured.trim() !== "") {
    return path.isAbsolute(configured)
      ? configured
      : path.join(root, configured);
  }
  return defaultIndexPath();
}

function extractCheckpointSummary(root, config, fallback = "") {
  const checkpoint = workspaceFile(root, config?.paths?.currentCheckpoint, ".nogra/state/SESSION-CHECKPOINT.md");
  if (!exists(checkpoint)) return cleanInline(fallback || "No checkpoint yet.");
  const text = readText(checkpoint, 6000);
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const preferredHeadings = ["## Current State", "## Current", "## Status", "## Next"];
  for (const heading of preferredHeadings) {
    const index = lines.findIndex((line) => line.toLowerCase() === heading.toLowerCase());
    if (index >= 0) {
      const paragraph = [];
      for (const line of lines.slice(index + 1)) {
        if (!line) {
          if (paragraph.length) break;
          continue;
        }
        if (line.startsWith("#")) break;
        if (line.match(/^\d+\./)) {
          if (paragraph.length) break;
          continue;
        }
        paragraph.push(line.replace(/^-\s*/, ""));
        if (cleanInline(paragraph.join(" ")).length >= 180) break;
      }
      if (paragraph.length) return cleanInline(paragraph.join(" ")).slice(0, 240);
    }
  }
  const first = lines.find((line) => line && !line.startsWith("#") && !line.match(/^(workspace|created|updated|sourcewatermark):/i));
  return cleanInline(first || fallback || "No checkpoint summary found.").slice(0, 240);
}

function ledgerWatermark(root) {
  const file = path.join(root, ".nogra", "ledger", "events.jsonl");
  if (!exists(file)) return 0;
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).length;
}

function checkpointSourceWatermark(root, config) {
  const checkpoint = workspaceFile(root, config?.paths?.currentCheckpoint, ".nogra/state/SESSION-CHECKPOINT.md");
  if (!exists(checkpoint)) return 0;
  const match = readText(checkpoint, 6000).match(/^SourceWatermark:\s*(\d+)\s*$/imu);
  return match ? Number(match[1]) : 0;
}

function checkpointFreshness(root, config) {
  const current = ledgerWatermark(root);
  const source = checkpointSourceWatermark(root, config);
  return {
    ledgerWatermark: current,
    checkpointSourceWatermark: source,
    checkpointStatus: current > source ? "stale" : "fresh"
  };
}

function bootHintForWorkspace(root, config, source, fallbackSummary = "") {
  const name = cleanInline(config?.workspaceName || config?.workspaceId || path.basename(root));
  const policy = config?.bootPolicy || {};
  const maxBytes = Number(policy.maxHintBytes || 1200);
  const summary = extractCheckpointSummary(root, config, fallbackSummary);
  const freshness = checkpointFreshness(root, config);
  const lines = [
    `Hi. I am in \`${name}\`.`,
    `Nogra found a local checkpoint: "${summary}".`,
    "I will load the rest only when we continue the work."
  ];
  const message = lines.join("\n").slice(0, maxBytes);
  return {
    schema: "nogra.boot_context.v1",
    status: "project",
    source,
    workspaceName: name,
    workspaceId: cleanInline(config?.workspaceId || name),
    workspaceRoot: root,
    stateRoot: config?.paths?.stateRoot || ".nogra/state",
    memoryIndex: config?.paths?.memoryIndex || ".nogra/memory/local/MEMORY.md",
    checkpointSummary: summary,
    ...freshness,
    writes: [],
    autoLoaded: false,
    message
  };
}

function bootHintForAmbiguous(cwd, entries, maxRecent = 5) {
  const sorted = entries
    .slice()
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
    .slice(0, maxRecent);
  const names = sorted.map((entry) => `\`${cleanInline(entry.workspaceName || entry.workspaceId || path.basename(entry.path))}\``).join(", ");
  return {
    schema: "nogra.boot_context.v1",
    status: "ambiguous",
    cwd,
    candidates: sorted.map((entry) => ({
      workspaceId: cleanInline(entry.workspaceId),
      workspaceName: cleanInline(entry.workspaceName || entry.workspaceId),
      path: entry.path,
      lastCheckpointSummary: cleanInline(entry.lastCheckpointSummary)
    })),
    writes: [],
    autoLoaded: false,
    message: `Hi. This folder contains multiple Nogra projects: ${names}.\nWhich project are we working in?`
  };
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

function isManagerHub(config) {
  return managerHubOptions(config).enabled;
}

function bootHintForManagerHub(root, config, entries) {
  const name = cleanInline(config?.workspaceName || config?.workspaceId || path.basename(root));
  const workspaceId = cleanInline(config?.workspaceId || name);
  const { hub, policy } = managerHubOptions(config);
  const maxProjects = Number(hub.maxProjects || policy.maxRecentProjects || 8);
  const exclude = new Set(
    (Array.isArray(hub.excludeWorkspaceIds) ? hub.excludeWorkspaceIds : [])
      .map((id) => cleanInline(id))
      .filter(Boolean)
  );
  if (hub.includeSelf !== true) exclude.add(workspaceId);

  const sorted = entries
    .filter((entry) => !exclude.has(cleanInline(entry.workspaceId)))
    .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
    .slice(0, maxProjects);

  const projectLines = sorted.length
    ? sorted.map((entry) => {
        const projectName = cleanInline(entry.workspaceName || entry.workspaceId || path.basename(entry.path));
        const projectId = cleanInline(entry.workspaceId || projectName);
        const summary = cleanInline(entry.lastCheckpointSummary || "No checkpoint summary.");
        return `- \`${projectName}\` (${projectId}) - ${summary}`;
      })
    : ["- No registered projects yet."];

  const maxBytes = Number(policy.maxHintBytes || 1600);
  const freshness = checkpointFreshness(root, config);
  const lines = [
    `Hi. I am in the \`${name}\` workspace hub.`,
    "Nogra projects in the index:",
    ...projectLines,
    "Say the project name to focus it. I will not load the project's full checkpoint before you choose it."
  ];

  return {
    schema: "nogra.boot_context.v1",
    status: "hub",
    source: "workspace-hub-index",
    workspaceName: name,
    workspaceId,
    workspaceRoot: root,
    candidates: sorted.map((entry) => ({
      workspaceId: cleanInline(entry.workspaceId),
      workspaceName: cleanInline(entry.workspaceName || entry.workspaceId),
      path: entry.path,
      lastCheckpointSummary: cleanInline(entry.lastCheckpointSummary)
    })),
    ...freshness,
    writes: [],
    autoLoaded: false,
    message: lines.join("\n").slice(0, maxBytes)
  };
}

function bootHintForMissing(cwd) {
  return {
    schema: "nogra.boot_context.v1",
    status: "missing",
    cwd,
    writes: [],
    autoLoaded: false,
    message: "Hi. I do not find Nogra state in this folder.\nSay the project, or run `/nogra:setup` here."
  };
}

export function resolveBootContext(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const nearest = nearestWorkspace(cwd);
  if (nearest) {
    if (isManagerHub(nearest.config)) {
      const indexPath = resolveWorkspaceIndexPath(nearest.root, nearest.config, options.index);
      return bootHintForManagerHub(nearest.root, nearest.config, readWorkspaceIndex(indexPath));
    }
    return bootHintForWorkspace(nearest.root, nearest.config, "nearest-cwd");
  }

  const indexPath = path.resolve(options.index || defaultIndexPath());
  const entries = readWorkspaceIndex(indexPath);
  const containing = entries
    .filter((entry) => isInside(cwd, entry.path))
    .sort((a, b) => b.path.length - a.path.length);
  if (containing.length > 0) {
    const entry = containing[0];
    const configPath = path.join(entry.path, ".nogra", "config.json");
    const config = exists(configPath)
      ? readJson(configPath)
      : { workspaceName: entry.workspaceName, workspaceId: entry.workspaceId, paths: { stateRoot: entry.stateRoot, memoryIndex: entry.memoryIndex } };
    return bootHintForWorkspace(entry.path, config, "workspace-index-containing", entry.lastCheckpointSummary);
  }

  const contained = entries.filter((entry) => isInside(entry.path, cwd));
  if (contained.length > 1) {
    return bootHintForAmbiguous(cwd, contained);
  }
  if (contained.length === 1) {
    const entry = contained[0];
    const configPath = path.join(entry.path, ".nogra", "config.json");
    const config = exists(configPath)
      ? readJson(configPath)
      : { workspaceName: entry.workspaceName, workspaceId: entry.workspaceId, paths: { stateRoot: entry.stateRoot, memoryIndex: entry.memoryIndex } };
    return bootHintForWorkspace(entry.path, config, "workspace-index-child", entry.lastCheckpointSummary);
  }

  return bootHintForMissing(cwd);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = resolveBootContext({ cwd: args.cwd, index: args.index });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.message);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`boot-context: ${error.message}`);
    process.exit(1);
  });
}
