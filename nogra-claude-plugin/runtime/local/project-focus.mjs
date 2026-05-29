#!/usr/bin/env node

import fs from "node:fs";
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
    if (name === "json") {
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

function configuredStatePath(config, key, fallbackName) {
  const stateRoot = safeWorkspaceRelativePath(config?.paths?.stateRoot, ".nogra/state");
  return safeWorkspaceRelativePath(config?.paths?.[key], path.posix.join(stateRoot, fallbackName));
}

function normalize(value) {
  return cleanInline(value)
    .toLowerCase()
    .replace(/æ/gu, "ae")
    .replace(/ø/gu, "oe")
    .replace(/å/gu, "aa")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function slug(value) {
  return normalize(value).replace(/\s+/gu, "-");
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

function workspaceIndexPath(root, config, explicitIndex) {
  if (explicitIndex) return path.resolve(explicitIndex);
  const configured = config?.paths?.workspaceIndex;
  if (typeof configured === "string" && configured.trim() !== "") {
    return path.isAbsolute(configured)
      ? configured
      : path.join(root, configured);
  }
  return path.join(root, ".nogra", "index", "workspaces.jsonl");
}

function readWorkspaceIndex(indexPath) {
  if (!indexPath || !exists(indexPath)) return [];
  const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/u).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.path) {
        entries.push({ ...entry, path: path.resolve(String(entry.path)) });
      }
    } catch {
      // Ignore invalid registry lines. Focus must stay quiet.
    }
  }
  return entries;
}

function managerHubOptions(config) {
  const policy = config?.bootPolicy || {};
  const hub =
    policy.managerHub && typeof policy.managerHub === "object"
      ? policy.managerHub
      : {};
  const enabled = policy.managerHub === true || hub.enabled === true || policy.mode === "manager-hub";
  return { enabled, hub };
}

function isManagerHub(config) {
  return managerHubOptions(config).enabled;
}

function visibleEntries(entries, hubConfig) {
  const { hub } = managerHubOptions(hubConfig);
  const self = cleanInline(hubConfig?.workspaceId);
  const exclude = new Set(
    (Array.isArray(hub.excludeWorkspaceIds) ? hub.excludeWorkspaceIds : [])
      .map((id) => cleanInline(id))
      .filter(Boolean)
  );
  if (hub.includeSelf !== true && self) exclude.add(self);
  return entries.filter((entry) => !exclude.has(cleanInline(entry.workspaceId)));
}

function extractCheckpointSummary(root, config, fallback = "") {
  const checkpoint = workspaceFile(root, config?.paths?.currentCheckpoint, ".nogra/state/SESSION-CHECKPOINT.md");
  if (!exists(checkpoint)) return cleanInline(fallback || "No checkpoint yet.");
  const text = readText(checkpoint, 6000);
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
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
        if (/^\d+\./u.test(line)) {
          if (paragraph.length) break;
          continue;
        }
        paragraph.push(line.replace(/^-\s*/u, ""));
        if (cleanInline(paragraph.join(" ")).length >= 220) break;
      }
      if (paragraph.length) return cleanInline(paragraph.join(" ")).slice(0, 260);
    }
  }
  const first = lines.find((line) => line && !line.startsWith("#") && !/^(workspace|created|updated):/iu.test(line));
  return cleanInline(first || fallback || "No checkpoint summary found.").slice(0, 260);
}

function entryLabels(entry) {
  const name = cleanInline(entry.workspaceName || entry.workspaceId || path.basename(entry.path));
  const id = cleanInline(entry.workspaceId || name);
  return new Set([normalize(name), normalize(id), slug(name), slug(id)].filter(Boolean));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsLabel(text, label) {
  if (!label) return false;
  const spaced = label.replace(/-/gu, " ");
  const candidates = new Set([label, spaced].filter(Boolean));
  return [...candidates].some((candidate) => {
    if (candidate.includes(" ")) {
      return text.includes(candidate);
    }
    return new RegExp(`(?:^|\\s)${escapeRegExp(candidate)}(?:\\s|$)`, "u").test(text);
  });
}

function hasFocusLanguage(text) {
  return /\b(?:arbejd(?:e|er)?\s+(?:paa|pa|med|i)|work(?:ing)?\s+(?:on|in)|focus\s+(?:on|in)|fokus(?:er|ere)?\s+(?:paa|pa|i)|skift\s+til|switch\s+to|open|aabn|abn|vaelg|select)\b/u.test(text);
}

function promptLooksLikeFocus(prompt, entries) {
  const text = normalize(prompt);
  const trimmed = prompt.trim();
  if (!text) return [];

  const explicit = text.match(/^(?:focus|fokus|skift til|switch to|arbejd i|arbejd paa|arbejd pa|arbejde i|arbejde paa|arbejde pa|work in|work on|working in|working on|open|aabn|abn|vaelg|select)\s+(.+)$/u);
  const candidateText = explicit ? normalize(explicit[1]) : text;
  const candidateSlug = slug(candidateText);
  const isBare = !/[?.,:;]/u.test(trimmed) && text.split(/\s+/u).length <= 4;
  const focusLanguage = hasFocusLanguage(text);

  return entries.filter((entry) => {
    const labels = entryLabels(entry);
    if (labels.has(candidateText) || labels.has(candidateSlug)) return true;
    if (focusLanguage && [...labels].some((label) => containsLabel(text, label))) return true;
    if (!isBare) return false;
    return [...labels].some((label) => label && candidateText === label);
  });
}

function focusContext(entry, summary, config) {
  const name = cleanInline(entry.workspaceName || entry.workspaceId || path.basename(entry.path));
  const id = cleanInline(entry.workspaceId || name);
  const checkpoint = configuredStatePath(config, "currentCheckpoint", "SESSION-CHECKPOINT.md");
  const tasks = configuredStatePath(config, "currentTasks", "CURRENT-TASKS.md");
  const decisions = configuredStatePath(config, "decisions", "DECISIONS.md");
  const structure = configuredStatePath(config, "projectStructure", "PROJECT-STRUCTURE.md");

  return `<!-- nogra-plugin:project-focus workspaceId=${id} -->
<NOGRA_PROJECT_FOCUS>
The user selected project \`${name}\` from the Manager hub.

Project root: ${entry.path}
Workspace id: ${id}
Current checkpoint summary: ${summary}

Use this project as the active focus for the next answer. Read project-local state before making claims or acting:
- ${path.join(entry.path, checkpoint)}
- ${path.join(entry.path, tasks)}
- ${path.join(entry.path, decisions)}
- ${path.join(entry.path, structure)}

This focus switch is read-only. Do not write files, dispatch, verify, run commands, or treat memory as authority until the user gives a concrete task or GO.
</NOGRA_PROJECT_FOCUS>`;
}

export function resolveProjectFocus(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const prompt = String(options.prompt || "");
  const hubWorkspace = nearestWorkspace(cwd);
  if (!hubWorkspace || !isManagerHub(hubWorkspace.config)) {
    return { schema: "nogra.project_focus.v1", status: "not-hub", writes: [], autoLoaded: false };
  }

  const indexPath = workspaceIndexPath(hubWorkspace.root, hubWorkspace.config, options.index);
  const entries = visibleEntries(readWorkspaceIndex(indexPath), hubWorkspace.config);
  const matches = promptLooksLikeFocus(prompt, entries);

  if (matches.length === 0) {
    return { schema: "nogra.project_focus.v1", status: "none", writes: [], autoLoaded: false };
  }

  if (matches.length > 1) {
    return {
      schema: "nogra.project_focus.v1",
      status: "ambiguous",
      candidates: matches.map((entry) => ({
        workspaceId: cleanInline(entry.workspaceId),
        workspaceName: cleanInline(entry.workspaceName || entry.workspaceId),
        path: entry.path
      })),
      writes: [],
      autoLoaded: false,
      additionalContext: `<NOGRA_PROJECT_FOCUS_AMBIGUOUS>
The user prompt matched more than one indexed Nogra project. Ask which project to focus before loading project state.
</NOGRA_PROJECT_FOCUS_AMBIGUOUS>`
    };
  }

  const entry = matches[0];
  const configPath = path.join(entry.path, ".nogra", "config.json");
  const config = exists(configPath)
    ? readJson(configPath)
    : { workspaceName: entry.workspaceName, workspaceId: entry.workspaceId, paths: { stateRoot: entry.stateRoot, memoryIndex: entry.memoryIndex } };
  const summary = extractCheckpointSummary(entry.path, config, entry.lastCheckpointSummary);

  return {
    schema: "nogra.project_focus.v1",
    status: "focused",
    workspaceId: cleanInline(entry.workspaceId),
    workspaceName: cleanInline(entry.workspaceName || entry.workspaceId),
    workspaceRoot: entry.path,
    checkpointSummary: summary,
    writes: [],
    autoLoaded: false,
    additionalContext: focusContext(entry, summary, config)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = resolveProjectFocus({
    cwd: args.cwd,
    index: args.index,
    prompt: args.prompt || args._.join(" ")
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.additionalContext) {
    console.log(result.additionalContext);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`project-focus: ${error.message}`);
    process.exit(1);
  });
}
