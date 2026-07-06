#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { activeIntentPath, readActiveIntent } from "../runtime/local/active-intent.mjs";
import { analyzeSessionQuality, sessionQualityLatestPath, writeSessionQualityReceipt } from "../runtime/local/session-quality.mjs";

const BRIEF_SCHEMA = "nogra.brief.v1";
const INIT_BUNDLE_SCHEMA = "nogra.init.bundle.v1";
const WORKSPACE_CONFIG_RELEASE_VERSION = "v1.0.0";
const TRANSPORT_STATUSES = new Set(["queued", "running", "returning", "returned", "ok", "partial", "blocked", "failed", "cancelled", "acknowledged"]);
const BRIEF_STATUSES = new Set(["draft", "ready", "approved", "in_progress", "returned", "accepted", "archived"]);
const EVIDENCE_LEVELS = new Set(["reported", "edited", "tested", "verified"]);
const DEFAULT_EXECUTOR_TURN_CEILING = 96;
const ABSOLUTE_EXECUTOR_TURN_CEILING = 192;

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const contractsRoot = path.join(pluginRoot, "contracts");

function usage() {
  return [
    "Usage:",
    "  node scripts/nogra-local.mjs status [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs watch [--root <dir>] [--lines <n>] [--json]",
    "  node scripts/nogra-local.mjs registry [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs init-bundle [--root <dir>] [--workspace-name <name>] [--json]",
    "  node scripts/nogra-local.mjs init --apply [--root <dir>] [--workspace-name <name>] [--json]",
    "  node scripts/nogra-local.mjs create-project <name> [--root <hub-dir>] [--workspace-id <id>] [--project-path <relative-dir>] [--apply] [--json]",
    "  node scripts/nogra-local.mjs brain-init [--apply] [--root <dir>] [--workspace-name <name>] [--json]",
    "  node scripts/nogra-local.mjs brief-contract [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs brief-validate [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs brief-sizing-preview [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs brief-save [--root <dir>] [--input <file>] [--source <label>] [--json]",
    "  node scripts/nogra-local.mjs brief-promote [--root <dir>] [--brief-id <id>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs ledger-smoke [--root <dir>] [--label <text>] [--json]",
    "  node scripts/nogra-local.mjs quality [--root <dir>] [--transcript <file>] [--write] [--json]",
    "  node scripts/nogra-local.mjs handoff-contract [--root <dir>] --kind executor|verifier [--run-id <id>] [--json]",
    "  node scripts/nogra-local.mjs dispatch [--root <dir>] --brief-id <id> [--target executor] [--target-model <model>] [--max-turns <n>] [--scratch-root <dir>]... [--json]",
    "  node scripts/nogra-local.mjs verify [--root <dir>] --run-id <id> [--input <file>] [--json]",
    "",
    "All commands use local plugin contracts and workspace-local records."
  ].join("\n");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      out._.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals > -1) {
      out[value.slice(2, equals)] = value.slice(equals + 1);
      continue;
    }
    const name = value.slice(2);
    if (["json", "apply", "dry-run", "migrate-local", "help", "write"].includes(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    out[name] = next;
    index += 1;
  }
  return out;
}

// parseArgs keeps only the LAST occurrence of a flag; a few CLI flags (e.g.
// dispatch --scratch-root) are deliberately repeatable, so this reads the raw
// argv directly rather than depending on parseArgs' single-value map.
function collectRepeatableFlag(argv, flagName) {
  const values = [];
  const prefix = `--${flagName}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === `--${flagName}`) {
      const next = argv[index + 1];
      if (next != null && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }
      continue;
    }
    if (value.startsWith(prefix)) {
      values.push(value.slice(prefix.length));
    }
  }
  return values;
}

function now() {
  return new Date().toISOString();
}

function timestamp() {
  return now().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function cleanText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function slugify(value, fallback = "brief") {
  const normalized = cleanInline(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const slug = normalized.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  return slug || fallback;
}

function directoryExists(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function normalizeDirectory(value) {
  const resolved = path.resolve(String(value || process.cwd()));
  if (!fs.existsSync(resolved)) return resolved;
  const stat = fs.statSync(resolved);
  const directory = stat.isDirectory() ? resolved : path.dirname(resolved);
  return fs.realpathSync(directory);
}

function nearestNograWorkspaceRoot(start) {
  let current = normalizeDirectory(start);
  while (true) {
    if (directoryExists(path.join(current, ".nogra"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return "";
    }
    current = parent;
  }
}

function workspaceRoot(options, behavior = {}) {
  const requested = options.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const fallback = normalizeDirectory(requested);
  if (behavior.nearestNogra === false) {
    return fallback;
  }
  return nearestNograWorkspaceRoot(fallback) || fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {};
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return {};
  }
  const frontmatter = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = cleanInline(match[2]);
    }
  }
  return frontmatter;
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

function readJsonIfValid(file) {
  try {
    return readJsonIfExists(file);
  } catch {
    return null;
  }
}

function writeTextAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, payload) {
  writeTextAtomic(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function appendJsonlIfMissing(file, payload, idField = "eventId") {
  ensureDir(path.dirname(file));
  const key = cleanInline(payload?.[idField]);
  if (key && fs.existsSync(file)) {
    const exists = readText(file)
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          return String(JSON.parse(line)?.[idField] ?? "") === key;
        } catch {
          return false;
        }
      });
    if (exists) return "skipped";
  }
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
  return "written";
}

function nonEmptyLineCount(file) {
  if (!fs.existsSync(file)) return 0;
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).length;
}

function safeRelativePath(value) {
  const raw = cleanInline(value).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.includes("\0")) {
    throw new Error(`invalid relative path: ${raw || "(empty)"}`);
  }
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`path escapes root: ${raw}`);
  }
  if (!parts.length) throw new Error("invalid relative path: (empty)");
  return parts.join("/");
}

function resolveWorkspacePath(root, relative) {
  const normalized = safeRelativePath(relative);
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  const target = path.resolve(rootReal, normalized);
  if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${relative}`);
  }
  return { normalized, target };
}

function safeProjectRelativePath(value) {
  const normalized = safeRelativePath(value);
  const parts = normalized.split("/");
  if (parts[0] !== "projects" || parts.length < 2) {
    throw new Error("project path must be under projects/<workspaceId>");
  }
  if (parts.some((part) => part.startsWith("."))) {
    throw new Error("project path cannot contain hidden path segments");
  }
  return normalized;
}

function nograDir(root) {
  return path.join(root, ".nogra");
}

function configPath(root) {
  return path.join(nograDir(root), "config.json");
}

function readWorkspaceConfig(root) {
  try {
    return readJsonIfExists(configPath(root));
  } catch (error) {
    return { __invalid: true, error: error.message };
  }
}

function workspaceConfigContractView(config = {}) {
  return {
    schema: cleanInline(config?.schema),
    releaseVersion: cleanInline(config?.releaseVersion),
    bootPolicyMode: cleanInline(config?.bootPolicy?.mode),
    hasDefaultTargetModel: Object.hasOwn(config || {}, "defaultTargetModel")
  };
}

function workspaceConfigContractCheck(hubConfig = {}, projectConfig = {}) {
  const hub = workspaceConfigContractView(hubConfig);
  const project = workspaceConfigContractView(projectConfig);
  const mismatches = [];
  if (!hub.schema) mismatches.push("hub schema is missing");
  if (!project.schema) mismatches.push("project schema is missing");
  if (hub.schema && project.schema && hub.schema !== project.schema) {
    mismatches.push(`schema mismatch: hub=${hub.schema} project=${project.schema}`);
  }
  if (!hub.releaseVersion) mismatches.push("hub releaseVersion is missing");
  if (!project.releaseVersion) mismatches.push("project releaseVersion is missing");
  if (hub.releaseVersion && project.releaseVersion && hub.releaseVersion !== project.releaseVersion) {
    mismatches.push(`releaseVersion mismatch: hub=${hub.releaseVersion} project=${project.releaseVersion}`);
  }
  return {
    status: mismatches.length ? "CONFIG_CONTRACT_DRIFT" : "ok",
    hub,
    project,
    mismatches
  };
}

function pluginJson() {
  return readJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
}

function pluginInstallContext() {
  const root = path.resolve(process.env.CLAUDE_PLUGIN_ROOT || pluginRoot);
  const parts = root.split(/[\\/]+/u).filter(Boolean);
  const cacheIndex = parts.lastIndexOf("cache");
  if (cacheIndex >= 0 && parts.length > cacheIndex + 3) {
    return {
      root,
      source: "cache",
      marketplace: parts[cacheIndex + 1] || "",
      pluginName: parts[cacheIndex + 2] || "",
      ref: parts[cacheIndex + 3] || ""
    };
  }
  return {
    root,
    source: "source",
    marketplace: "",
    pluginName: "",
    ref: ""
  };
}

function claudePluginsRoot() {
  const home = os.homedir();
  return home ? path.join(home, ".claude", "plugins") : "";
}

function readPluginManifest(dir) {
  try {
    return readJson(path.join(dir, ".claude-plugin", "plugin.json"));
  } catch {
    return null;
  }
}

function marketplacePluginRecord(file, pluginName) {
  try {
    const payload = readJson(file);
    const plugin = Array.isArray(payload.plugins)
      ? payload.plugins.find((item) => item && item.name === pluginName)
      : null;
    if (!plugin) return null;
    return {
      marketplace: cleanInline(payload.name) || path.basename(path.dirname(path.dirname(file))),
      path: file,
      pluginName: cleanInline(plugin.name),
      version: cleanInline(plugin.version),
      description: cleanInline(plugin.description)
    };
  } catch {
    return null;
  }
}

function marketplaceCandidates(context, pluginName) {
  const candidates = [
    path.join(context.root, ".claude-plugin", "marketplace.json"),
    path.join(path.dirname(context.root), ".claude-plugin", "marketplace.json")
  ];
  const pluginsRoot = claudePluginsRoot();
  if (context.marketplace && pluginsRoot) {
    candidates.push(path.join(pluginsRoot, "marketplaces", context.marketplace, ".claude-plugin", "marketplace.json"));
  }
  const seen = new Set();
  return candidates
    .filter((file) => file && fs.existsSync(file))
    .filter((file) => {
      const resolved = path.resolve(file);
      if (seen.has(resolved)) return false;
      seen.add(resolved);
      return true;
    })
    .map((file) => marketplacePluginRecord(file, pluginName))
    .filter(Boolean);
}

function listInstalledNograPlugins() {
  const pluginsRoot = claudePluginsRoot();
  const cacheRoot = pluginsRoot ? path.join(pluginsRoot, "cache") : "";
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return [];
  const entries = [];
  for (const marketplace of fs.readdirSync(cacheRoot)) {
    const marketplaceDir = path.join(cacheRoot, marketplace);
    if (!fs.statSync(marketplaceDir).isDirectory()) continue;
    for (const pluginName of fs.readdirSync(marketplaceDir)) {
      if (!pluginName.startsWith("nogra")) continue;
      const pluginDir = path.join(marketplaceDir, pluginName);
      if (!fs.statSync(pluginDir).isDirectory()) continue;
      for (const ref of fs.readdirSync(pluginDir)) {
        const refDir = path.join(pluginDir, ref);
        if (!fs.statSync(refDir).isDirectory()) continue;
        const manifest = readPluginManifest(refDir);
        if (!manifest) continue;
        entries.push({
          name: cleanInline(manifest.name || pluginName),
          version: cleanInline(manifest.version),
          marketplace,
          ref,
          orphaned: fs.existsSync(path.join(refDir, ".orphaned_at")),
          path: refDir
        });
      }
    }
  }
  return entries.sort((a, b) => `${a.name}:${a.marketplace}:${a.ref}`.localeCompare(`${b.name}:${b.marketplace}:${b.ref}`));
}

function strictPublicPluginMode() {
  return process.env.NOGRA_STRICT_PUBLIC_PLUGIN === "1" || process.env.NOGRA_PUBLIC_GRADE_STRICT === "1";
}

function isPrivateLaneNograInstall(item) {
  const label = [
    item.name,
    item.marketplace,
    item.ref
  ].map((value) => cleanInline(value).toLowerCase()).join(" ");
  return /\bprivate\b/u.test(label) || /nogra-private/u.test(label) || /private-beta/u.test(label) || /private-stable/u.test(label);
}

function publicIsolationDiagnostics(installed, context) {
  const strict = strictPublicPluginMode();
  const contextRoot = path.resolve(context.root || "");
  const privateLanePlugins = installed
    .filter((item) => !item.orphaned && item.name === "nogra" && isPrivateLaneNograInstall(item))
    .filter((item) => path.resolve(item.path) !== contextRoot)
    .map(({ name, version, marketplace, ref, orphaned, path: itemPath }) => ({
      name,
      version,
      marketplace,
      ref,
      orphaned,
      path: itemPath
    }));
  return {
    strict,
    status: privateLanePlugins.length && strict ? "blocked" : "ok",
    privateLanePlugins
  };
}

function pluginDiagnostics(plugin) {
  const context = pluginInstallContext();
  const installed = listInstalledNograPlugins();
  const activeCoreInstalls = installed.filter((item) => item.name === "nogra" && !item.orphaned);
  const marketplaces = marketplaceCandidates(context, plugin.name);
  const publicIsolation = publicIsolationDiagnostics(installed, context);
  const versionMismatches = marketplaces
    .filter((item) => item.version && item.version !== plugin.version)
    .map((item) => ({
      marketplace: item.marketplace,
      expectedVersion: item.version,
      installedVersion: plugin.version,
      path: item.path,
      blocking: false
    }));
  const warnings = [];
  if (activeCoreInstalls.length > 1) {
    warnings.push({
      code: "multiple-nogra-plugins-installed",
      severity: "warning",
      blocking: false,
      message: "Multiple non-orphaned Nogra plugin installs were found in Claude Code's plugin cache. Verify the active plugin ref before init or dispatch.",
      plugins: activeCoreInstalls.map(({ name, version, marketplace, ref, path: itemPath }) => ({
        name,
        version,
        marketplace,
        ref,
        path: itemPath
      }))
    });
  }
  if (publicIsolation.privateLanePlugins.length) {
    warnings.push({
      code: "private-nogra-plugin-installed",
      severity: publicIsolation.strict ? "error" : "warning",
      blocking: publicIsolation.strict,
      message: publicIsolation.strict
        ? "A private Nogra plugin install is present while strict public-plugin isolation is enabled. Disable the private lane for this workspace before public grading."
        : "A private Nogra plugin install is present. This is valid for local development, but public-grade workspaces should disable private lanes before testing the public plugin.",
      plugins: publicIsolation.privateLanePlugins
    });
  }
  for (const mismatch of versionMismatches) {
    warnings.push({
      code: "marketplace-version-mismatch",
      severity: "warning",
      blocking: false,
      message: `Marketplace ${mismatch.marketplace} expects ${mismatch.expectedVersion}, but the active plugin reports ${mismatch.installedVersion}.`,
      ...mismatch
    });
  }
  return {
    context,
    installedNograPlugins: installed.filter((item) => !item.orphaned).map(({ name, version, marketplace, ref, orphaned, path: itemPath }) => ({
      name,
      version,
      marketplace,
      ref,
      orphaned,
      path: itemPath
    })),
    marketplaces,
    publicIsolation,
    warnings
  };
}

function contractText(relative) {
  return readText(path.join(contractsRoot, relative));
}

function contractJson(relative) {
  return JSON.parse(contractText(relative));
}

function defaultReturnPolicy(config = {}) {
  if (config.returnPolicy && typeof config.returnPolicy === "object") {
    return {
      format: cleanInline(config.returnPolicy.format) || "evidence-first state brief",
      limit: cleanInline(config.returnPolicy.limit) || "no hard word limit; keep the opening summary concise and include all evidence needed to verify the result"
    };
  }
  return {
    format: "evidence-first state brief",
    limit: "no hard word limit; keep the opening summary concise and include all evidence needed to verify the result"
  };
}

// Release default runtime preferences. The verifier defaults to a DIFFERENT
// model than the executor (cross-model verify): an independent model is less
// likely to repeat the executor's blind spots when checking "done". This is a
// preference surfaced in dispatch/receipts, not enforcement -- Claude Code's
// native /model remains the live source of truth for the current chat.
const RELEASE_RUNTIME_FALLBACK = {
  executor: {
    model: "anthropic:sonnet",
    effort: "medium",
    context: "default",
    maxTurns: null
  },
  verifier: {
    model: "opus",
    effort: "medium",
    context: "default",
    maxTurns: null
  }
};

function roleObject(roles, primary, legacy = "") {
  const candidate = roles && typeof roles === "object" && roles[primary] && typeof roles[primary] === "object"
    ? roles[primary]
    : null;
  if (candidate) return candidate;
  if (legacy && roles && typeof roles === "object" && roles[legacy] && typeof roles[legacy] === "object") {
    return roles[legacy];
  }
  return {};
}

function cleanRoleValue(value) {
  const cleaned = cleanInline(value);
  if (!cleaned || cleaned.toLowerCase() === "default") return "";
  return cleaned;
}

function runtimeRole(configured, fallback) {
  const out = {
    model: cleanRoleValue(configured.model) || fallback.model,
    effort: cleanRoleValue(configured.effort) || fallback.effort,
    context: cleanRoleValue(configured.context) || fallback.context,
    maxTurns: configured.maxTurns ?? fallback.maxTurns
  };
  for (const key of Object.keys(configured)) {
    if (!["model", "effort", "context", "maxTurns"].includes(key)) {
      out[key] = configured[key];
    }
  }
  return out;
}

function roleMatches(role, expected) {
  return cleanInline(role.model).toLowerCase() === expected.model &&
    cleanInline(role.effort).toLowerCase() === expected.effort &&
    (!expected.context || cleanInline(role.context).toLowerCase() === expected.context) &&
    (expected.maxTurns === undefined || role.maxTurns === expected.maxTurns);
}

function isStockLegacyBalanced(runtime) {
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const budget = runtime.budget && typeof runtime.budget === "object" ? runtime.budget : {};
  return cleanInline(runtime.profile).toLowerCase() === "balanced" &&
    roleMatches(roleObject(roles, "manager"), { model: "inherit", effort: "auto", context: "session" }) &&
    roleMatches(roleObject(roles, "agent"), { model: "sonnet", effort: "high", context: "default", maxTurns: null }) &&
    roleMatches(roleObject(roles, "verifier"), { model: "sonnet", effort: "medium", context: "default", maxTurns: null }) &&
    (cleanInline(budget.mode).toLowerCase() === "balanced" || !cleanInline(budget.mode));
}

function runtimePolicyState(config = {}) {
  const runtime = config.runtimePolicy && typeof config.runtimePolicy === "object" ? config.runtimePolicy : {};
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const rawProfile = cleanInline(runtime.profile).toLowerCase();
  const customProfile = rawProfile === "custom" ||
    (rawProfile && rawProfile !== "default" && !isStockLegacyBalanced(runtime));
  const profile = customProfile ? "custom" : "default";
  const executorConfigured = roleObject(roles, "executor", "agent");
  const verifierConfigured = roleObject(roles, "verifier");
  return {
    profile,
    rawProfile: rawProfile || "default",
    source: customProfile ? "runtimePolicy.custom" : "release default",
    legacyAgentFallback: !roles.executor && Boolean(roles.agent),
    executor: profile === "custom"
      ? runtimeRole(executorConfigured, RELEASE_RUNTIME_FALLBACK.executor)
      : { ...RELEASE_RUNTIME_FALLBACK.executor },
    verifier: profile === "custom"
      ? runtimeRole(verifierConfigured, RELEASE_RUNTIME_FALLBACK.verifier)
      : { ...RELEASE_RUNTIME_FALLBACK.verifier }
  };
}

function defaultTargetModel(config = {}) {
  const runtime = runtimePolicyState(config);
  if (runtime.profile === "custom" && cleanInline(runtime.executor.model)) {
    return cleanInline(runtime.executor.model);
  }
  return cleanInline(config.defaultTargetModel) || RELEASE_RUNTIME_FALLBACK.executor.model;
}

function roleDisplayName(scopedRole) {
  const role = cleanInline(scopedRole).split(":").pop() || "";
  return role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Role";
}

function statusDisplayName(status) {
  const cleaned = cleanInline(status);
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "";
}

function runtimeDisplayName(runtime) {
  const cleaned = cleanInline(runtime)
    .replace(/^anthropic:/, "")
    .replace(/^claude-/, "")
    .replace(/-/g, " ");
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part, index) => {
      if (/^\d+$/.test(part) && index > 0) return part;
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ")
    .replace(/\b(\d)\s+(\d)\b/g, "$1.$2");
}

function roleRuntimePair(scopedRole, runtime, status = "") {
  const role = cleanInline(scopedRole);
  const resolvedRuntime = cleanInline(runtime);
  const label = [roleDisplayName(role), runtimeDisplayName(resolvedRuntime), statusDisplayName(status)]
    .filter(Boolean)
    .join(" · ");
  return {
    executionRole: role,
    executionRuntime: resolvedRuntime,
    executionLabel: label
  };
}

function scopedNograRole(value, fallback = "executor") {
  const role = cleanInline(value || fallback);
  if (!role) return `nogra:${fallback}`;
  return role.includes(":") ? role : `nogra:${role}`;
}

function runtimeRoleForTarget(runtime, target) {
  const scopedRole = scopedNograRole(target);
  return scopedRole.endsWith(":verifier") ? runtime.verifier : runtime.executor;
}

function workspaceId(config = {}) {
  return cleanInline(config.workspaceId) || "local";
}

function normalizeWorkspaceMode(value = "") {
  const explicit = cleanInline(value).toLowerCase();
  if (!explicit) return "";
  if (explicit === "connected" || /-connected$/u.test(explicit)) return "connected";
  if (["local", "free-local", "free", "legacy-hosted", "hosted", "hosted-public"].includes(explicit)) {
    return "local";
  }
  return "";
}

function detectMode(root) {
  const config = readWorkspaceConfig(root);
  const connection = readJsonIfExists(path.join(nograDir(root), "connection.json"));
  if (connection && cleanInline(connection.status || connection.mode || connection.token)) {
    return {
      mode: "connected",
      label: "Connected",
      source: ".nogra/connection.json",
      config,
      initialized: Boolean(config && !config.__invalid)
    };
  }
  if (!config) {
    return {
      mode: "not-initialized",
      label: "Not initialized",
      source: "missing .nogra/config.json",
      config: null,
      initialized: false
    };
  }
  if (config.__invalid) {
    return {
      mode: "invalid-config",
      label: "Invalid local config",
      source: ".nogra/config.json",
      config,
      initialized: false
    };
  }
  const explicit = cleanInline(config.connectionMode || config.nograMode || config.mode).toLowerCase();
  const normalizedMode = normalizeWorkspaceMode(explicit);
  if (normalizedMode === "connected") {
    return { mode: "connected", label: "Connected", source: ".nogra/config.json connectionMode", config, initialized: true };
  }
  if (normalizedMode === "local") {
    return {
      mode: "local",
      label: "Local",
      source: explicit === "local" ? ".nogra/config.json connectionMode" : ".nogra/config.json connectionMode legacy alias",
      config,
      initialized: true
    };
  }
  return { mode: "local", label: "Local", source: "local config default", config, initialized: true };
}

function registryPayload(root) {
  const plugin = pluginJson();
  const mode = detectMode(root);
  return {
    name: "nogra-local-runtime",
    version: plugin.version,
    status: "v1-local-plugin-runtime",
    hostedMcpUsed: false,
    workspaceMode: mode.mode,
    workspaceModeLabel: mode.label,
    boundary: {
      local: mode.mode === "local" || mode.mode === "not-initialized",
      hostedMcpRequiredForLocal: false,
      hostedMcpRequiredForDefault: false,
      hostedMcpUsed: false,
      connected: mode.mode === "connected"
    },
    tools: [
      "local_status",
      "local_watch",
      "local_init_bundle",
      "local_brief_contract",
      "local_brief_validate",
      "local_brief_save",
      "local_brief_promote",
      "local_dispatch",
      "local_handoff_contract",
      "local_verify_support"
    ],
    resources: [
      "plugin://nogra/contracts/schemas/brief-v1.schema.json",
      "plugin://nogra/contracts/templates/brief-v1.md",
      "plugin://nogra/contracts/init-bundle/manifest.json"
    ]
  };
}

function readOnlyCommand(args, options = {}) {
  try {
    return {
      status: "ok",
      output: execFileSync(args[0], args.slice(1), {
        cwd: options.cwd || process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, ...(options.env || {}) },
        timeout: options.timeoutMs || 1200
      }).trim()
    };
  } catch {
    return { status: "unknown", output: "" };
  }
}

function gitProjection(root) {
  const source = "git --no-optional-locks status --porcelain=v2 --branch";
  const status = readOnlyCommand(["git", "--no-optional-locks", "-C", root, "status", "--porcelain=v2", "--branch"], {
    env: { GIT_OPTIONAL_LOCKS: "0" },
    timeoutMs: 1200
  });
  if (status.status !== "ok") {
    return {
      schema: "nogra.local.git_projection.v1",
      status: "unknown",
      source,
      dirtyCount: null,
      branch: "",
      head: ""
    };
  }
  const lines = status.output.split(/\r?\n/u).filter(Boolean);
  const metadata = Object.fromEntries(lines
    .filter((line) => line.startsWith("# branch."))
    .map((line) => {
      const match = line.match(/^# branch\.([A-Za-z]+)\s+(.+)$/u);
      return match ? [match[1], cleanInline(match[2])] : null;
    })
    .filter(Boolean));
  const dirtyCount = lines.filter((line) => !line.startsWith("#")).length;
  const branch = metadata.upstream ? `${metadata.head || ""}...${metadata.upstream}` : metadata.head || "";
  return {
    schema: "nogra.local.git_projection.v1",
    status: dirtyCount > 0 ? "dirty" : "clean",
    source,
    dirtyCount,
    branch: cleanInline(branch),
    head: cleanInline(metadata.oid).slice(0, 12)
  };
}

function parseTomlVersion(text) {
  return cleanInline((text.match(/^version\s*=\s*"([^"]+)"/mu) || [])[1]);
}

function parsePythonVersion(text) {
  return cleanInline((text.match(/^__version__\s*=\s*"([^"]+)"/mu) || [])[1]);
}

function latestBridgeGate(root) {
  const gateDir = path.join(nograDir(root), "dispatch", "gates");
  const missing = {
    exists: false,
    path: localPath(root, gateDir),
    status: "missing",
    deliveryScope: "unknown",
    requireCoworkSession: "unknown",
    exitStatus: "unknown"
  };
  if (!directoryExists(gateDir)) return missing;
  const reports = fs.readdirSync(gateDir)
    .filter((name) => /^y26-internal-bridge-fresh-gate-.*\.md$/u.test(name))
    .map((name) => path.join(gateDir, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!reports.length) return missing;
  const file = reports[0];
  const text = readText(file);
  const field = (name) => cleanInline((text.match(new RegExp(`^- ${name}:\\s*(.+?)\\s*$`, "mu")) || [])[1]) || "unknown";
  const exitStatus = field("exitStatus");
  const deliveryScope = field("deliveryScope");
  const requireCoworkSession = field("requireCoworkSession");
  return {
    exists: true,
    path: localPath(root, file),
    status: exitStatus === "0" ? "green" : "not-green",
    deliveryScope,
    requireCoworkSession,
    exitStatus,
    mtime: fs.statSync(file).mtime.toISOString()
  };
}

function bridgeProjection(root) {
  const bridgeRoot = path.join(root, "manager", "y26-internal-bridge");
  const gate = latestBridgeGate(root);
  if (!directoryExists(bridgeRoot)) {
    return {
      schema: "nogra.local.bridge_projection.v1",
      status: "unknown",
      source: "manager/y26-internal-bridge",
      name: "",
      version: "unknown",
      latestGate: gate
    };
  }
  const plugin = readJsonIfValid(path.join(bridgeRoot, ".claude-plugin", "plugin.json")) || {};
  const pyprojectVersion = fs.existsSync(path.join(bridgeRoot, "pyproject.toml"))
    ? parseTomlVersion(readText(path.join(bridgeRoot, "pyproject.toml")))
    : "";
  const runtimeVersion = fs.existsSync(path.join(bridgeRoot, "src", "y26_internal_bridge", "__init__.py"))
    ? parsePythonVersion(readText(path.join(bridgeRoot, "src", "y26_internal_bridge", "__init__.py")))
    : "";
  const pluginVersion = cleanInline(plugin.version);
  const versions = [pyprojectVersion, runtimeVersion, pluginVersion].filter(Boolean);
  const version = versions.length && new Set(versions).size === 1 ? versions[0] : "unknown";
  let status = "source-present";
  if (gate.exists && gate.exitStatus !== "0") {
    status = "gate-failed";
  } else if (gate.exists && gate.deliveryScope === "ceo-live-cowork" && gate.requireCoworkSession === "1") {
    status = "live-ready";
  } else if (gate.exists && gate.exitStatus === "0") {
    status = "local-preflight";
  }
  return {
    schema: "nogra.local.bridge_projection.v1",
    status,
    source: "manager/y26-internal-bridge + .nogra/dispatch/gates",
    name: cleanInline(plugin.name) || "y26-internal-bridge",
    version,
    versions: {
      pyproject: pyprojectVersion,
      runtime: runtimeVersion,
      plugin: pluginVersion
    },
    latestGate: gate,
    claimBoundary: status === "local-preflight"
      ? "Local preflight only; not CEO/live Co-work acceptance."
      : ""
  };
}

function workspaceIndexEntries(root) {
  const file = path.join(nograDir(root), "index", "workspaces.jsonl");
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function promotionProjection(root, config = {}, bridge = {}, git = {}) {
  const entries = workspaceIndexEntries(root);
  const devHub = entries.find((entry) => cleanInline(entry.workspaceId) === "y26dev");
  if (!devHub) {
    return {
      schema: "nogra.local.promotion_projection.v1",
      status: "unknown",
      source: ".nogra/index/workspaces.jsonl",
      lane: "unknown",
      blockedBy: []
    };
  }
  const blockedBy = [];
  if (bridge.status !== "live-ready") blockedBy.push("bridge-live-gate");
  if (git.status === "dirty") blockedBy.push("dirty-worktree");
  if (git.status === "unknown") blockedBy.push("git-unknown");
  const rootWorkspace = cleanInline(config.workspaceId);
  return {
    schema: "nogra.local.promotion_projection.v1",
    status: blockedBy.length ? "gate-required" : "ready-for-review",
    source: ".nogra/index/workspaces.jsonl + status projections",
    lane: rootWorkspace === "y26" ? "y26dev-to-y26-public" : "dev-to-public",
    devWorkspaceId: cleanInline(devHub.workspaceId),
    devWorkspacePath: cleanInline(devHub.path, 240),
    blockedBy,
    summary: cleanInline(devHub.lastCheckpointSummary, 240)
  };
}

function statusPayload(root) {
  const plugin = pluginJson();
  const diagnostics = pluginDiagnostics(plugin);
  const mode = detectMode(root);
  const config = mode.config && !mode.config.__invalid ? mode.config : {};
  const runtime = runtimePolicyState(config);
  const routing = config.routingPolicy && typeof config.routingPolicy === "object" ? config.routingPolicy : {};
  const briefs = listBriefs(root, 1);
  const runs = listTransportRuns(root, 1);
  const checkpoint = checkpointFreshness(root, config);
  const index = indexReadiness(root, config);
  const git = gitProjection(root);
  const bridge = bridgeProjection(root);
  const promotion = promotionProjection(root, config, bridge, git);
  return {
    schema: "nogra.local.status.v1",
    generatedAt: now(),
    hostedMcpUsed: false,
    plugin: {
      name: plugin.name,
      version: plugin.version,
      ref: process.env.CLAUDE_PLUGIN_ROOT || pluginRoot,
      install: diagnostics.context,
      diagnostics: {
        installedNograPlugins: diagnostics.installedNograPlugins,
        marketplaces: diagnostics.marketplaces,
        publicIsolation: diagnostics.publicIsolation,
        warnings: diagnostics.warnings
      }
    },
    workspace: {
      root,
      initialized: mode.initialized,
      mode: mode.mode,
      label: mode.label,
      source: mode.source,
      workspaceId: workspaceId(config)
    },
    routingPolicy: {
      configured: Boolean(config.routingPolicy),
      source: config.routingPolicy ? ".nogra/config.json" : "release default",
      model: "pull-first",
      defaultLanguage: cleanInline(routing.defaultLanguage) || "en"
    },
    runtimePolicy: {
      configured: Boolean(config.runtimePolicy),
      profile: runtime.profile,
      rawProfile: runtime.rawProfile,
      source: runtime.source,
      legacyAgentFallback: runtime.legacyAgentFallback
    },
    ledger: {
      watermark: checkpoint.ledgerWatermark,
      checkpointSourceWatermark: checkpoint.checkpointSourceWatermark,
      checkpointStatus: checkpoint.status
    },
    git,
    bridge,
    promotion,
    index,
    continuity: continuityState(root, config),
    recent: {
      briefs,
      transportRuns: runs
    },
    next: mode.initialized ? ["/nogra:brief", "/nogra:status"] : ["/nogra:setup"]
  };
}

function firstFilledLine(file, label) {
  if (!fs.existsSync(file)) return "";
  const line = readText(file)
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(label.toLowerCase()) && entry.replace(label, "").trim());
  return cleanInline(line || "");
}

function indexFileState(root, key, rel) {
  const file = path.join(root, rel);
  return {
    key,
    path: rel,
    exists: fs.existsSync(file)
  };
}

function indexReadiness(root, config = {}) {
  const paths = config.paths && typeof config.paths === "object" ? config.paths : {};
  const files = [
    indexFileState(root, "riskIntake", cleanInline(paths.riskIntake) || ".nogra/index/risk-intake.md"),
    indexFileState(root, "behaviorScore", cleanInline(paths.behaviorScore) || ".nogra/index/behavior-score.md"),
    indexFileState(root, "riskRegistry", cleanInline(paths.riskRegistry) || ".nogra/index/risk-registry.md"),
    indexFileState(root, "decisions", cleanInline(paths.decisions) || ".nogra/state/DECISIONS.md"),
    indexFileState(root, "expansions", cleanInline(paths.expansions) || ".nogra/index/EXPANSIONS.md")
  ];
  const behaviorPath = files.find((file) => file.key === "behaviorScore")?.path || ".nogra/index/behavior-score.md";
  return {
    files,
    ready: files.every((file) => file.exists),
    latestBehaviorScore: firstFilledLine(path.join(root, behaviorPath), "- Score:")
  };
}

function renderTemplate(text, context) {
  let out = text;
  for (const [key, value] of Object.entries(context)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

function manifestItemSupportsMode(item, initMode) {
  if (!Array.isArray(item.modes)) return true;
  return item.modes.includes(initMode);
}

function initFileFromManifestItem(item, context) {
  const source = safeRelativePath(item.source);
  const target = safeRelativePath(item.path);
  const sourceFile = path.join(contractsRoot, source);
  const content = renderTemplate(readText(sourceFile), context);
  return {
    path: target,
    content,
    mimeType: cleanInline(item.mimeType) || "text/plain",
    contentEncoding: "utf-8",
    contentDelivery: "inline-json-string",
    writePolicy: cleanInline(item.writePolicy) || "create_if_missing",
    purpose: cleanInline(item.purpose)
  };
}

function initInstallPlan(files, initMode) {
  return {
    schema: "nogra.init.install_plan.v1",
    mode: "phase-grouped-client-writes",
    initMode,
    source: "plugin-local-contracts",
    defaultExistingFileBehavior: "preserve existing files unless writePolicy permits safe update",
    configMergePolicy: {
      path: ".nogra/config.json",
      mode: "merge_preserve_existing",
      rule: "Preserve user-set values and unknown keys. Existing plugin configs without connectionMode resolve to local by default."
    },
    phases: [
      {
        id: "local-state",
        title: "Local Nogra state",
        fileCount: files.length,
        files: files.map((file) => ({
          path: file.path,
          writePolicy: file.writePolicy,
          purpose: file.purpose
        }))
      }
    ]
  };
}

function initBundlePayload(root, workspaceName = "") {
  const generatedAt = now();
  const cleanName = cleanInline(workspaceName) || path.basename(root) || "local";
  const context = {
    workspaceName: cleanName,
    workspaceId: slugify(cleanName, "local").toLowerCase(),
    releaseVersion: WORKSPACE_CONFIG_RELEASE_VERSION,
    workspacePath: root,
    generatedAt,
    initMode: "plugin",
    connectionMode: "local"
  };
  const manifest = contractJson("init-bundle/manifest.json");
  const files = [];
  for (const item of manifest.files || []) {
    if (!item || typeof item !== "object" || !manifestItemSupportsMode(item, "plugin")) continue;
    files.push(initFileFromManifestItem(item, context));
  }
  return {
    schema: INIT_BUNDLE_SCHEMA,
    status: "ready",
    bundleId: "init-bundle-v1",
    initMode: "plugin",
    connectionMode: "local",
    generatedAt,
    serverMode: "plugin-local",
    hostedMcpUsed: false,
    workspaceId: context.workspaceId,
    workspaceName: cleanName,
    writeMode: "client_writes_or_local_runtime_applies_files",
    installPlan: initInstallPlan(files, "plugin"),
    postInstallMessage: "Nogra is installed in this folder. Brief, dispatch and verification records live in .nogra/. Your workspace also ships with a brain/ deep-work vault — pull-first, never auto-loaded; /nogra:brain-init re-scaffolds it if you ever remove it.",
    migration: {
      schema: "nogra.init.migration_guidance.v1",
      mode: "plugin-local",
      required: false,
      autoMigrateLegacyHosted: true,
      userPrompt: "Existing plugin workspaces without connectionMode resolve to local by default."
    },
    files,
    optionalFeatures: [],
    nextSteps: [
      "Preview files before applying them.",
      "Merge .nogra/config.json preserving existing user values and removing obsolete automatic-offer controls.",
      "Preserve .claude/ files; setup writes only returned Nogra files.",
      "Use /nogra:adapt for existing projects after setup."
    ]
  };
}

function brainInitBundlePayload(root, workspaceName = "") {
  const generatedAt = now();
  const cleanName = cleanInline(workspaceName) || path.basename(root) || "local";
  const context = {
    workspaceName: cleanName,
    generatedAt
  };
  const manifest = contractJson("brain-init/manifest.json");
  const files = [];
  for (const item of manifest.files || []) {
    if (!item || typeof item !== "object") continue;
    files.push(initFileFromManifestItem(item, context));
  }
  const brainExists = fs.existsSync(path.join(root, "brain"));
  return {
    schema: "nogra.brain_init.bundle.v1",
    status: "ready",
    generatedAt,
    root,
    brainExists,
    files,
    postInstallMessage: brainExists
      ? "brain/ already exists. brain-init only fills in files that are missing; nothing is overwritten."
      : "brain/ will be scaffolded empty: raw/, wiki/, index.md and a thin brain/CLAUDE.md. Nothing is auto-loaded.",
    next: ["Review this plan, then rerun with --apply after explicit GO."]
  };
}

function applyBrainInit(root, workspaceName = "") {
  const plan = brainInitBundlePayload(root, workspaceName);
  const results = [];
  const counts = { written: 0, preserved: 0, failed: 0 };
  for (const file of plan.files) {
    try {
      const { target } = resolveWorkspacePath(root, file.path);
      let action = "preserved";
      if (!fs.existsSync(target)) {
        writeTextAtomic(target, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
        action = "written";
      }
      counts[action] = (counts[action] || 0) + 1;
      results.push({ path: file.path, action });
    } catch (error) {
      counts.failed += 1;
      results.push({ path: file.path, action: "failed", error: error.message });
    }
  }
  return {
    schema: "nogra.brain_init.result.v1",
    generatedAt: plan.generatedAt,
    status: counts.failed ? "partial" : "ok",
    root,
    brainExisted: plan.brainExists,
    results,
    counts,
    next: ["brain/ is empty by design. Fill it deliberately; nothing here auto-loads."]
  };
}

const OBSOLETE_ROUTING_POLICY_KEYS = new Set([
  "autoOfferEnabled",
  "sensitivityPercent",
  "sensitivityStepPercent",
  "autoOfferThreshold",
  "strongOfferThreshold",
  "offerOncePerIntent",
  "topicGate",
  "scoring"
]);

const LEGACY_ROUTING_DICTIONARY_KEYS = new Set([
  "createIntent",
  "productSurface",
  "evidenceNeed",
  "completionClaim",
  "qualityCritical",
  "riskyDomain",
  "ambiguity",
  "lowRiskEdit",
  "singleFileLowScope",
  "directOverride",
  "toggleOn",
  "toggleOff"
]);

function isLegacyRoutingDictionary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => LEGACY_ROUTING_DICTIONARY_KEYS.has(key));
}

function stripObsoleteRoutingPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = { ...value };
  for (const key of OBSOLETE_ROUTING_POLICY_KEYS) {
    delete out[key];
  }
  if (isLegacyRoutingDictionary(out.dictionary)) {
    delete out.dictionary;
  }
  return out;
}

function mergeConfig(existing, incoming, options = {}, pathKey = "") {
  const out = Array.isArray(existing) ? [...existing] : { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (!Object.hasOwn(out, key)) {
      out[key] = value;
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeConfig(out[key], value, options, key);
    }
  }
  return pathKey === "routingPolicy" ? stripObsoleteRoutingPolicy(out) : out;
}

function applyInit(root, workspaceName, options = {}) {
  const bundle = initBundlePayload(root, workspaceName);
  const results = [];
  const counts = { written: 0, updated: 0, preserved: 0, failed: 0 };
  for (const file of bundle.files) {
    try {
      const { normalized, target } = resolveWorkspacePath(root, file.path);
      let action = "preserved";
      if (normalized === ".nogra/config.json") {
        if (fs.existsSync(target)) {
          const existing = readJson(target);
          const incoming = JSON.parse(file.content);
          const merged = mergeConfig(existing, incoming, { migrateLocal: options.migrateLocal });
          const next = `${JSON.stringify(merged, null, 2)}\n`;
          if (readText(target) !== next) {
            writeTextAtomic(target, next);
            action = "updated";
          }
        } else {
          writeTextAtomic(target, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
          action = "written";
        }
      } else if (normalized === ".nogra/state/SESSION-CHECKPOINT.md" && fs.existsSync(target)) {
        const current = readText(target);
        const next = ensureCheckpointSourceWatermark(current, currentLedgerWatermark(root));
        if (current !== next) {
          writeTextAtomic(target, next);
          action = "updated";
        }
      } else if (fs.existsSync(target)) {
        if (file.writePolicy === "create_or_update") {
          const next = file.content.endsWith("\n") ? file.content : `${file.content}\n`;
          if (readText(target) !== next) {
            writeTextAtomic(target, next);
            action = "updated";
          }
        }
      } else {
        writeTextAtomic(target, file.content.endsWith("\n") ? file.content : `${file.content}\n`);
        action = "written";
      }
      counts[action] += 1;
      results.push({ path: normalized, action, writePolicy: file.writePolicy });
    } catch (error) {
      counts.failed += 1;
      results.push({ path: file.path, action: "failed", error: error.message });
    }
  }
  return {
    schema: "nogra.local.init_result.v1",
    generatedAt: now(),
    status: counts.failed ? "partial" : "ok",
    hostedMcpUsed: false,
    root,
    counts,
    files: results,
    bundle: {
      version: bundle.version,
      workspaceId: bundle.workspaceId,
      workspaceName: bundle.workspaceName,
      connectionMode: bundle.connectionMode
    }
  };
}

const NOGRA_DOMAIN_DIRS = [
  "state",
  "briefs",
  "runs",
  "evidence",
  "receipts",
  "reports",
  "checkpoints",
  "ledger",
  "index",
  "memory/local",
  "memory/sync",
  "memory/runtime",
  "transport"
];

function workspaceIndexEntry(values) {
  return {
    schema: "nogra.workspace.index.entry.v1",
    workspaceId: values.workspaceId,
    workspaceName: values.workspaceName,
    path: values.workspacePath,
    stateRoot: ".nogra/state",
    memoryIndex: ".nogra/memory/local/MEMORY.md",
    lastSeenAt: values.generatedAt,
    lastCheckpointSummary: values.lastCheckpointSummary || "Nogra project created locally; no project work recorded yet.",
    source: values.source || "nogra-create"
  };
}

function upsertWorkspaceIndex(indexPath, entry) {
  ensureDir(path.dirname(indexPath));
  const lines = fs.existsSync(indexPath)
    ? readText(indexPath).split(/\r?\n/u).filter(Boolean)
    : [];
  const kept = lines.filter((line) => {
    try {
      return JSON.parse(line)?.workspaceId !== entry.workspaceId;
    } catch {
      return true;
    }
  });
  kept.push(JSON.stringify(entry));
  const next = `${kept.join("\n")}\n`;
  const action = fs.existsSync(indexPath) && readText(indexPath) === next ? "preserved" : "updated";
  writeTextAtomic(indexPath, next);
  return action;
}

function ensureNograDomainDirs(root) {
  for (const rel of NOGRA_DOMAIN_DIRS) {
    ensureDir(path.join(nograDir(root), rel));
  }
}

function defaultManagerHubBootPolicy(existing = {}) {
  const workspaceHub =
    existing.workspaceHub && typeof existing.workspaceHub === "object"
      ? { ...existing.workspaceHub }
      : existing.managerHub && typeof existing.managerHub === "object"
        ? { ...existing.managerHub }
        : {};
  if (workspaceHub.includeSelf == null) workspaceHub.includeSelf = false;
  if (!Array.isArray(workspaceHub.excludeWorkspaceIds)) workspaceHub.excludeWorkspaceIds = ["customer-template"];
  if (workspaceHub.maxProjects == null) workspaceHub.maxProjects = 8;
  workspaceHub.enabled = true;

  const next = {
    ...existing,
    schema: existing.schema || "nogra.boot_policy.v1",
    mode: "workspace-hub",
    cwdResolution: existing.cwdResolution || "nearest-nogra-then-workspace-index",
    autoLoad: false,
    writeOnSessionStart: false,
    askOnAmbiguousProject: existing.askOnAmbiguousProject === false ? false : true,
    maxHintBytes: existing.maxHintBytes || 1200,
    maxRecentProjects: existing.maxRecentProjects || 5,
    workspaceHub,
    hintSources: Array.isArray(existing.hintSources)
      ? existing.hintSources
      : [
          ".nogra/index/workspaces.jsonl",
          ".nogra/state/SESSION-CHECKPOINT.md",
          ".nogra/memory/local/MEMORY.md"
        ],
    never: Array.isArray(existing.never)
      ? existing.never
      : [
          "load-full-memory-on-session-start",
          "write-ledger-without-user-intent",
          "dispatch-without-explicit-go",
          "treat-memory-as-project-truth"
        ]
  };
  delete next.managerHub;
  return next;
}

function ensureManagerHubConfig(root) {
  const file = configPath(root);
  const config = readWorkspaceConfig(root);
  if (!config) {
    throw new Error("missing .nogra/config.json; run /nogra:setup before /nogra:create");
  }
  if (config.__invalid) {
    throw new Error(`invalid .nogra/config.json: ${config.error}`);
  }

  const next = mergeConfig(config, {
    releaseVersion: WORKSPACE_CONFIG_RELEASE_VERSION,
    paths: {
      hiddenRoot: ".nogra",
      stateRoot: ".nogra/state",
      currentCheckpoint: ".nogra/state/SESSION-CHECKPOINT.md",
      currentTasks: ".nogra/state/CURRENT-TASKS.md",
      decisions: ".nogra/state/DECISIONS.md",
      projectStructure: ".nogra/state/PROJECT-STRUCTURE.md",
      workspaceIndex: ".nogra/index/workspaces.jsonl",
      memoryIndex: ".nogra/memory/local/MEMORY.md"
    }
  });
  next.bootPolicy = defaultManagerHubBootPolicy(
    next.bootPolicy && typeof next.bootPolicy === "object" ? next.bootPolicy : {}
  );

  const before = JSON.stringify(config, null, 2);
  const after = JSON.stringify(next, null, 2);
  if (before === after) return "preserved";
  writeJsonAtomic(file, next);
  return "updated";
}

function projectCreatePlan(root, options = {}) {
  const workspaceName = cleanInline(options.name);
  if (!workspaceName) {
    throw new Error("project name is required");
  }
  const workspaceId = slugify(options.workspaceId || workspaceName, "project").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,70}[a-z0-9])?$/.test(workspaceId)) {
    throw new Error(`project name produced an invalid workspaceId: ${workspaceId}`);
  }

  const projectRel = options.projectPath
    ? safeProjectRelativePath(options.projectPath)
    : safeProjectRelativePath(`projects/${workspaceId}`);
  const { normalized, target } = resolveWorkspacePath(root, projectRel);
  const generatedAt = options.generatedAt || now();
  const bundle = initBundlePayload(target, workspaceName);
  const projectExists = fs.existsSync(target);
  const projectNonEmpty = projectExists && fs.readdirSync(target).length > 0;
  const hubConfig = readWorkspaceConfig(root);
  const blockers = [];
  if (!hubConfig) blockers.push("missing .nogra/config.json; run /nogra:setup before /nogra:create");
  if (hubConfig?.__invalid) blockers.push(`invalid .nogra/config.json: ${hubConfig.error}`);
  if (projectNonEmpty) blockers.push(`project destination is not empty: ${target}`);

  return {
    schema: "nogra.local.create_project_plan.v1",
    generatedAt,
    status: blockers.length ? "blocked" : "ready",
    hostedMcpUsed: false,
    root,
    project: {
      workspaceName,
      workspaceId,
      relativePath: normalized,
      path: target
    },
    hub: {
      configPath: localPath(root, configPath(root)),
      indexPath: ".nogra/index/workspaces.jsonl",
      willSetWorkspaceHubMode: true
    },
    files: bundle.files.map((file) => ({
      path: path.posix.join(normalized.replaceAll(path.sep, "/"), file.path),
      writePolicy: file.writePolicy,
      purpose: file.purpose
    })),
    blockers,
    next: blockers.length
      ? ["Resolve blockers, then rerun /nogra:create."]
      : ["Review this plan, then rerun with --apply after explicit GO."]
  };
}

function createProject(root, options = {}) {
  const plan = projectCreatePlan(root, options);
  if (!options.apply) return plan;
  if (plan.blockers.length) {
    throw new Error(plan.blockers.join("; "));
  }

  const projectRoot = plan.project.path;
  ensureDir(projectRoot);
  ensureNograDomainDirs(root);

  const initResult = applyInit(projectRoot, plan.project.workspaceName);
  const entry = workspaceIndexEntry({
    workspaceName: plan.project.workspaceName,
    workspaceId: plan.project.workspaceId,
    workspacePath: projectRoot,
    generatedAt: plan.generatedAt,
    lastCheckpointSummary: `${plan.project.workspaceName} was created under ${plan.project.relativePath} with project-local .nogra state.`,
    source: "nogra-create"
  });
  const hubConfigAction = ensureManagerHubConfig(root);
  const hubIndexAction = upsertWorkspaceIndex(path.join(nograDir(root), "index", "workspaces.jsonl"), entry);
  const projectIndexAction = upsertWorkspaceIndex(path.join(nograDir(projectRoot), "index", "workspaces.jsonl"), entry);
  const configContract = workspaceConfigContractCheck(readWorkspaceConfig(root) || {}, readWorkspaceConfig(projectRoot) || {});

  return {
    schema: "nogra.local.create_project_result.v1",
    generatedAt: plan.generatedAt,
    status: "ok",
    hostedMcpUsed: false,
    root,
    project: plan.project,
    actions: {
      projectInit: initResult.counts,
      hubConfig: hubConfigAction,
      hubIndex: hubIndexAction,
      projectIndex: projectIndexAction
    },
    configContract,
    next: [
      `Start Claude in the hub and say ${plan.project.workspaceName} to focus this project.`,
      "Use /nogra:adapt inside the project when there is existing code to map."
    ]
  };
}

function briefContract(root) {
  const config = readWorkspaceConfig(root) || {};
  const returnPolicy = defaultReturnPolicy(config);
  const schema = contractJson("schemas/brief-v1.schema.json");
  return {
    schema: "nogra.brief.contract.v1",
    briefSchema: BRIEF_SCHEMA,
    serverMode: "plugin-local",
    hostedMcpUsed: false,
    workspaceId: workspaceId(config),
    schemaResource: "plugin://nogra/contracts/schemas/brief-v1.schema.json",
    templateResource: "plugin://nogra/contracts/templates/brief-v1.md",
    workspaceIdPolicy: {
      sourceOfTruth: ".nogra/config.json workspaceId after init",
      fallback: "local"
    },
    defaultReturnPolicy: returnPolicy,
    requiredFields: (schema.required || []).map((field) => ({ field, source: "structured payload or generated by local runtime" })),
    markdownSections: [
      { heading: "## Intent", field: "intent", required: true },
      { heading: "## Context Handoff", field: "contextHandoff", required: true },
      { heading: "## Scope", field: "scope", required: true },
      { heading: "## Success Criteria", field: "successCriteria", required: true },
      { heading: "## Stop Criteria", field: "stopCriteria", required: true },
      { heading: "## Max Output", field: "maxOutput", required: true }
    ],
    notes: [
      "Local validation uses bundled plugin contracts.",
      "Validation is a gate, not the way to discover the contract.",
      "Manager judgment remains responsible for evidence vs. brief verification."
    ],
    demoBrief: normalizeBrief(
      {
        title: "Add workspace README",
        intent: "Add a short README to the workspace root so a new visitor can understand the workspace purpose and find the Nogra records.",
        contextHandoff: "The workspace has been initialized with Nogra. Keep the README small and point to the .nogra/ trust-source records plus the /nogra command.",
        scope: {
          in: ["Create README.md at the workspace root."],
          out: ["Do not modify CLAUDE.md or .nogra/*."],
          files: ["README.md"]
        },
        successCriteria: [
          "README.md exists at the workspace root.",
          "README.md mentions .nogra/ records and the /nogra command.",
          "No other files are changed."
        ],
        stopCriteria: [
          "If README.md already exists, stop and ask before overwriting.",
          "If the work requires changes outside README.md, stop and return for approval."
        ]
      },
      config
    )
  };
}

function readInput(options, required = true) {
  let text = "";
  if (options.input) {
    text = readText(path.resolve(String(options.input)));
  } else if (!process.stdin.isTTY) {
    text = fs.readFileSync(0, "utf8");
  }
  if (!text.trim()) {
    if (required) throw new Error("JSON input required via --input or stdin");
    return {};
  }
  return parseInputPayload(text);
}

function parseInputPayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Only structured JSON brief payloads are supported by the local runtime v1");
  }
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

function safeBriefId(value) {
  const briefId = cleanInline(value);
  if (!/^brief-[A-Za-z0-9_.-]+$/.test(briefId)) {
    throw new Error(`invalid brief id: ${briefId || "(empty)"}`);
  }
  return briefId;
}

function newBriefId(title) {
  return `brief-${slugify(title || "untitled", "untitled").toLowerCase()}-${now().slice(0, 10)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
}

function normalizeBrief(input, config = {}, existing = {}) {
  const at = now();
  const inputScope = input.scope && typeof input.scope === "object" ? input.scope : {};
  const existingScope = existing.scope && typeof existing.scope === "object" ? existing.scope : {};
  const inputMax = input.maxOutput && typeof input.maxOutput === "object" ? input.maxOutput : input.returnPolicy && typeof input.returnPolicy === "object" ? input.returnPolicy : {};
  const existingMax = existing.maxOutput && typeof existing.maxOutput === "object" ? existing.maxOutput : {};
  const returnPolicy = defaultReturnPolicy(config);
  const title = cleanInline(input.title || existing.title || "Untitled brief");
  const targetRole = cleanInline(input.targetRole || input.target_role || existing.targetRole || "executor");
  const brief = {
    schema: cleanInline(input.schema || existing.schema || BRIEF_SCHEMA),
    briefId: safeBriefId(input.briefId || input.brief_id || input.id || existing.briefId || newBriefId(title)),
    workspaceId: cleanInline(input.workspaceId || input.workspace_id || existing.workspaceId || workspaceId(config)),
    title,
    createdAt: cleanInline(input.createdAt || existing.createdAt || at),
    updatedAt: cleanInline(input.updatedAt || existing.updatedAt || at),
    status: cleanInline(input.status || existing.status || "draft") || "draft",
    owner: cleanInline(input.owner || existing.owner || "Manager"),
    nextOwner: cleanInline(input.nextOwner || input.next_owner || existing.nextOwner || scopedNograRole(targetRole)),
    targetRole,
    targetModel: cleanInline(input.targetModel || input.target_model || existing.targetModel || defaultTargetModel(config)),
    intent: cleanText(input.intent || existing.intent),
    contextHandoff: cleanText(input.contextHandoff || existing.contextHandoff),
    decisions: asStringArray(input.decisions).length ? asStringArray(input.decisions) : asStringArray(existing.decisions),
    rejected: asStringArray(input.rejected).length ? asStringArray(input.rejected) : asStringArray(existing.rejected),
    knownGaps: asStringArray(input.knownGaps).length ? asStringArray(input.knownGaps) : asStringArray(existing.knownGaps),
    scope: {
      in: asStringArray(inputScope.in).length ? asStringArray(inputScope.in) : asStringArray(existingScope.in),
      out: asStringArray(inputScope.out).length ? asStringArray(inputScope.out) : asStringArray(existingScope.out),
      files: asStringArray(inputScope.files).length ? asStringArray(inputScope.files) : asStringArray(existingScope.files)
    },
    successCriteria: asStringArray(input.successCriteria).length ? asStringArray(input.successCriteria) : asStringArray(existing.successCriteria),
    stopCriteria: asStringArray(input.stopCriteria).length ? asStringArray(input.stopCriteria) : asStringArray(existing.stopCriteria),
    maxOutput: {
      format: cleanInline(inputMax.format || existingMax.format || returnPolicy.format),
      limit: cleanInline(inputMax.limit || existingMax.limit || returnPolicy.limit)
    },
    evidenceRequired: cleanInline(input.evidenceRequired || existing.evidenceRequired || "reported"),
    handoffRefs: asStringArray(input.handoffRefs).length ? asStringArray(input.handoffRefs) : asStringArray(existing.handoffRefs)
  };
  const executionShape = input.executionShape || input.execution_shape || existing.executionShape;
  if (executionShape && typeof executionShape === "object" && Object.keys(executionShape).length) {
    brief.executionShape = executionShape;
  }
  const metadata = { ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}), ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}) };
  if (Object.keys(metadata).length) brief.metadata = metadata;
  return brief;
}

function validateBrief(brief) {
  const errors = [];
  for (const key of ["schema", "briefId", "workspaceId", "title", "createdAt", "owner", "nextOwner", "intent", "contextHandoff", "scope", "successCriteria", "stopCriteria", "maxOutput"]) {
    if (brief[key] == null || brief[key] === "") errors.push(`brief missing ${key}`);
  }
  if (brief.schema !== BRIEF_SCHEMA) errors.push(`brief schema mismatch: ${brief.schema}`);
  try {
    safeBriefId(brief.briefId);
  } catch (error) {
    errors.push(error.message);
  }
  if (brief.status && !BRIEF_STATUSES.has(brief.status)) errors.push(`brief status is not valid: ${brief.status}`);
  if (brief.evidenceRequired && !EVIDENCE_LEVELS.has(brief.evidenceRequired)) errors.push(`brief evidenceRequired is not valid: ${brief.evidenceRequired}`);
  if (!brief.scope || typeof brief.scope !== "object" || !Array.isArray(brief.scope.in) || !Array.isArray(brief.scope.out)) errors.push("brief scope missing in/out arrays");
  if (!Array.isArray(brief.successCriteria) || !brief.successCriteria.some((item) => cleanInline(item))) errors.push("brief missing successCriteria");
  if (!Array.isArray(brief.stopCriteria) || !brief.stopCriteria.some((item) => cleanInline(item))) errors.push("brief missing stopCriteria");
  if (!brief.maxOutput || typeof brief.maxOutput !== "object" || !cleanInline(brief.maxOutput.format) || !cleanInline(brief.maxOutput.limit)) errors.push("brief missing maxOutput format/limit");
  if (brief.executionShape != null && typeof brief.executionShape !== "object") errors.push("brief executionShape must be an object when present");
  return errors;
}

function validateBriefPayload(root, input) {
  const config = readWorkspaceConfig(root) || {};
  let normalized = null;
  try {
    normalized = normalizeBrief(input, config);
    const errors = validateBrief(normalized);
    return { valid: errors.length === 0, errors, normalized, hostedMcpUsed: false, contract: "plugin-bundled brief-v1.schema.json" };
  } catch (error) {
    return { valid: false, errors: [error.message], normalized, hostedMcpUsed: false, contract: "plugin-bundled brief-v1.schema.json" };
  }
}

function draftPath(root, briefId) {
  return path.join(nograDir(root), "briefs", "drafts", `${safeBriefId(briefId)}.json`);
}

function promotedPath(root, briefId) {
  return path.join(nograDir(root), "briefs", `${safeBriefId(briefId)}.md`);
}

function draftOverviewPath(root, briefId) {
  return path.join(nograDir(root), "briefs", "drafts", `${safeBriefId(briefId)}.overview.txt`);
}

function localPath(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function localFileUrl(file) {
  return pathToFileURL(file).href;
}

function markdownFileLink(label, file) {
  return `[${label}](${localFileUrl(file)})`;
}

function saveBrief(root, input, source = "") {
  const config = readWorkspaceConfig(root) || {};
  const candidateId = input.briefId || input.id;
  let existing = {};
  if (candidateId) {
    try {
      existing = readJson(draftPath(root, String(candidateId)));
    } catch {
      existing = {};
    }
  }
  const draft = normalizeBrief(input, config, existing);
  draft.status = "draft";
  draft.updatedAt = now();
  if (source) draft.metadata = { ...(draft.metadata || {}), source };
  const errors = validateBrief(draft);
  if (errors.length) {
    return { status: "invalid", valid: false, errors, normalized: draft, hostedMcpUsed: false };
  }
  const file = draftPath(root, draft.briefId);
  const overviewFile = draftOverviewPath(root, draft.briefId);
  writeJsonAtomic(file, draft);
  writeTextAtomic(overviewFile, renderBriefOverview(draft));
  const ledgerEvent = appendLedgerEvent(root, "brief_saved", {
    briefId: draft.briefId,
    briefStatus: draft.status,
    source: cleanInline(source)
  });
  return {
    ...draft,
    id: draft.briefId,
    path: localPath(root, file),
    absolutePath: file,
    fileUrl: localFileUrl(file),
    openDraftLink: markdownFileLink("Open draft", file),
    overviewPath: localPath(root, overviewFile),
    status: "draft",
    valid: true,
    errors: [],
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    hostedMcpUsed: false
  };
}

function yamlScalar(value) {
  const text = cleanInline(value);
  if (!text) return "\"\"";
  if (/^[A-Za-z0-9_.:/@ -]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function renderList(items, fallback = "None") {
  const values = asStringArray(items);
  return (values.length ? values : [fallback]).map((item) => `- ${item}`).join("\n");
}

function renderExecutionShape(value) {
  if (!value || typeof value !== "object" || !Object.keys(value).length) return "";
  const parts = [];
  if (Array.isArray(value.toolFamilies) && value.toolFamilies.length) parts.push(`Tool families:\n\n${renderList(value.toolFamilies)}`);
  if (Array.isArray(value.toolNeeds) && value.toolNeeds.length) parts.push(`Tool needs:\n\n${renderList(value.toolNeeds)}`);
  if (cleanText(value.notes)) parts.push(`Notes:\n\n${cleanText(value.notes)}`);
  for (const [key, raw] of Object.entries(value)) {
    if (["toolFamilies", "toolNeeds", "notes"].includes(key)) continue;
    if (typeof raw === "string" && cleanText(raw)) parts.push(`${key}: ${cleanText(raw)}`);
    if (Array.isArray(raw) && asStringArray(raw).length) parts.push(`${key}:\n${renderList(raw)}`);
  }
  return parts.length ? `## Execution Shape\n\n${parts.join("\n\n")}\n\n` : "";
}

function renderBriefOverview(brief) {
  const scope = brief.scope || {};
  const max = brief.maxOutput || {};
  const section = (title, value) => {
    const text = cleanText(value);
    return text ? [`${title}:`, `  ${text}`] : [];
  };
  const listSection = (title, items) => {
    const values = asStringArray(items);
    return [`${title}:`, ...(values.length ? values.map((item) => `  - ${item}`) : ["  - None"])];
  };
  return [
    "Nogra brief overview",
    "",
    `Title: ${cleanInline(brief.title)}`,
    `Brief id: ${cleanInline(brief.briefId)}`,
    `Status: ${cleanInline(brief.status)}`,
    `Workspace: ${cleanInline(brief.workspaceId)}`,
    `Target model: ${cleanInline(brief.targetModel) || "default"}`,
    "",
    ...section("Goal", brief.intent),
    "",
    ...listSection("Scope in", scope.in),
    "",
    ...listSection("Scope out", scope.out),
    "",
    ...listSection("Files", scope.files),
    "",
    ...listSection("Stop criteria", brief.stopCriteria),
    "",
    ...listSection("Success criteria", brief.successCriteria),
    "",
    "Return:",
    `  Format: ${cleanInline(max.format)}`,
    `  Limit: ${cleanInline(max.limit)}`
  ].join("\n") + "\n";
}

function renderBriefMarkdown(brief) {
  const errors = validateBrief(brief);
  if (errors.length) throw new Error(errors.join("; "));
  const fields = [
    ["schema", brief.schema],
    ["briefId", brief.briefId],
    ["workspaceId", brief.workspaceId],
    ["title", brief.title],
    ["createdAt", brief.createdAt],
    ["updatedAt", brief.updatedAt],
    ["status", brief.status],
    ["owner", brief.owner || ""],
    ["nextOwner", brief.nextOwner || ""],
    ["targetRole", brief.targetRole || ""],
    ["targetModel", brief.targetModel || ""],
    ["evidenceRequired", brief.evidenceRequired || ""]
  ];
  const frontmatter = fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`).join("\n");
  const scope = brief.scope || {};
  const max = brief.maxOutput || {};
  return [
    `---\n${frontmatter}\n---`,
    `# ${brief.title}`,
    `## Intent\n\n${brief.intent}`,
    `## Context Handoff\n\n${brief.contextHandoff}`,
    `## Decisions\n\n${renderList(brief.decisions)}`,
    `## Rejected\n\n${renderList(brief.rejected)}`,
    `## Known Gaps\n\n${renderList(brief.knownGaps)}`,
    `## Scope\n\nIn:\n\n${renderList(scope.in)}\n\nOut:\n\n${renderList(scope.out)}\n\nFiles:\n\n${renderList(scope.files)}`,
    `## Success Criteria\n\n${renderList(brief.successCriteria)}`,
    `## Stop Criteria\n\n${renderList(brief.stopCriteria)}`,
    renderExecutionShape(brief.executionShape).trim(),
    `## Max Output\n\nFormat: ${max.format || ""}\nLimit: ${max.limit || ""}`
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

function promoteBrief(root, options) {
  const config = readWorkspaceConfig(root) || {};
  let input = options.inputPayload || null;
  if (!input && options.briefId) {
    input = readJson(draftPath(root, options.briefId));
  }
  if (!input) throw new Error("brief-promote requires --brief-id or JSON input");
  if (options.briefId) {
    const requested = safeBriefId(options.briefId);
    const inline = cleanInline(input.briefId || input.id);
    if (inline && safeBriefId(inline) !== requested) throw new Error("brief id does not match inline payload");
    input.briefId = requested;
  }
  const ready = normalizeBrief(input, config, input);
  ready.status = "ready";
  ready.updatedAt = now();
  const errors = validateBrief(ready);
  if (errors.length) return { status: "invalid", valid: false, errors, normalized: ready, hostedMcpUsed: false };
  const metadata = { ...(ready.metadata || {}), promotedAt: now(), promotedPath: `.nogra/briefs/${ready.briefId}.md` };
  const updatedDraft = { ...ready, metadata };
  const draftFile = draftPath(root, ready.briefId);
  const overviewFile = draftOverviewPath(root, ready.briefId);
  const briefFile = promotedPath(root, ready.briefId);
  writeJsonAtomic(draftFile, updatedDraft);
  writeTextAtomic(overviewFile, renderBriefOverview(updatedDraft));
  writeTextAtomic(briefFile, renderBriefMarkdown(updatedDraft));
  const ledgerEvent = appendLedgerEvent(root, "brief_promoted", {
    briefId: ready.briefId,
    briefStatus: ready.status,
    path: `.nogra/briefs/${ready.briefId}.md`
  });
  return {
    status: "ready",
    valid: true,
    errors: [],
    draft: {
      ...updatedDraft,
      id: ready.briefId,
      path: localPath(root, draftFile),
      absolutePath: draftFile,
      fileUrl: localFileUrl(draftFile),
      openDraftLink: markdownFileLink("Open draft", draftFile),
      overviewPath: localPath(root, overviewFile)
    },
    brief: {
      ...updatedDraft,
      id: ready.briefId,
      path: localPath(root, briefFile),
      absolutePath: briefFile,
      fileUrl: localFileUrl(briefFile),
      openBriefLink: markdownFileLink("Open brief", briefFile)
    },
    path: localPath(root, briefFile),
    absolutePath: briefFile,
    fileUrl: localFileUrl(briefFile),
    openBriefLink: markdownFileLink("Open brief", briefFile),
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    hostedMcpUsed: false
  };
}

function listBriefs(root, limit = 10) {
  const dir = path.join(nograDir(root), "briefs");
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    items.push({ path: localPath(root, full), modifiedAt: stat.mtime.toISOString() });
  }
  return items.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt))).slice(0, limit);
}

function listTransportRuns(root, limit = 10) {
  const dir = path.join(nograDir(root), "transport", "runs");
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dir, file);
    try {
      const payload = readJson(full);
      items.push({
        runId: payload.runId || file.replace(/\.json$/, ""),
        status: payload.status || "",
        phase: payload.phase || "",
        target: payload.target || "",
        executionRole: payload.executionRole || payload.metadata?.executionRole || "",
        executionRuntime: payload.executionRuntime || payload.metadata?.executionRuntime || payload.targetModel || "",
        executionEffort: payload.executionEffort || payload.metadata?.executionEffort || "",
        executionRuntimePolicyProfile: payload.executionRuntimePolicyProfile || payload.metadata?.executionRuntimePolicyProfile || "",
        executionLabel: payload.executionLabel || payload.metadata?.executionLabel || "",
        verificationRole: payload.verificationRole || payload.metadata?.verificationRole || "",
        verificationRuntime: payload.verificationRuntime || payload.metadata?.verificationRuntime || "",
        verificationStatus: payload.verificationStatus || payload.metadata?.verificationStatus || "",
        verificationLabel: payload.verificationLabel || payload.metadata?.verificationLabel || "",
        briefId: payload.briefId || "",
        updatedAt: payload.updatedAt || fs.statSync(full).mtime.toISOString(),
        path: localPath(root, full)
      });
    } catch {
      continue;
    }
  }
  return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}

function ledgerEventsPath(root) {
  return path.join(nograDir(root), "ledger", "events.jsonl");
}

function sessionAnchorPath(root) {
  return path.join(nograDir(root), "runtime", "session-anchor.json");
}

function liveHooksJsonlPath(root) {
  return path.join(nograDir(root), "runtime", "live-hooks.jsonl");
}

function liveHooksTextPath(root) {
  return path.join(nograDir(root), "runtime", "live-hooks.log");
}

function liveHooksLatestPath(root) {
  return path.join(nograDir(root), "runtime", "live-hooks.latest.json");
}

function sessionQualityReceiptsPath(root) {
  return path.join(nograDir(root), "runtime", "quality");
}

function currentLedgerWatermark(root) {
  return nonEmptyLineCount(ledgerEventsPath(root));
}

function transcriptIdFromPath(value) {
  const base = path.basename(cleanInline(value));
  return base.replace(/\.jsonl$/u, "");
}

function readSessionAnchor(root) {
  const anchor = readJsonIfValid(sessionAnchorPath(root));
  if (!anchor || typeof anchor !== "object") {
    return { sessionId: "", transcriptId: "" };
  }
  return {
    sessionId: cleanInline(anchor.sessionId),
    transcriptId: cleanInline(anchor.transcriptId) || transcriptIdFromPath(anchor.transcriptPath),
    hookEventName: cleanInline(anchor.hookEventName),
    updatedAt: cleanInline(anchor.updatedAt)
  };
}

function checkpointPath(root, config = {}) {
  const configured = cleanInline(config?.paths?.currentCheckpoint);
  return configured ? path.join(root, configured) : path.join(nograDir(root), "state", "SESSION-CHECKPOINT.md");
}

function checkpointSourceWatermark(root, config = {}) {
  const file = checkpointPath(root, config);
  if (!fs.existsSync(file)) return 0;
  const text = readText(file);
  const match = text.match(/^SourceWatermark:\s*(\d+)\s*$/imu);
  return match ? Number(match[1]) : 0;
}

function checkpointHasSourceWatermark(root, config = {}) {
  const file = checkpointPath(root, config);
  return fs.existsSync(file) && /^SourceWatermark:\s*\d+\s*$/imu.test(readText(file));
}

function ensureCheckpointSourceWatermark(text, watermark = 0) {
  if (/^SourceWatermark:\s*\d+\s*$/imu.test(text)) return text;
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  const line = `SourceWatermark: ${Math.max(0, Number(watermark) || 0)}`;
  if (/^Updated:\s*.+$/imu.test(normalized)) {
    return normalized.replace(/^Updated:\s*.+$/imu, (match) => `${match}\n${line}`);
  }
  if (/^Created:\s*.+$/imu.test(normalized)) {
    return normalized.replace(/^Created:\s*.+$/imu, (match) => `${match}\n${line}`);
  }
  return `${line}\n${normalized}`;
}

function checkpointFreshness(root, config = {}) {
  const ledgerWatermark = currentLedgerWatermark(root);
  const sourceWatermark = checkpointSourceWatermark(root, config);
  return {
    ledgerWatermark,
    checkpointSourceWatermark: sourceWatermark,
    status: ledgerWatermark > sourceWatermark ? "stale" : "fresh"
  };
}

function continuityState(root, config = {}) {
  const ledgerDir = path.join(nograDir(root), "ledger");
  const ledgerFile = ledgerEventsPath(root);
  const checkpointFile = checkpointPath(root, config);
  const anchorFile = sessionAnchorPath(root);
  const liveHooksFile = liveHooksJsonlPath(root);
  const liveHooksLog = liveHooksTextPath(root);
  const liveHooksLatest = liveHooksLatestPath(root);
  const qualityLatest = sessionQualityLatestPath(root);
  const qualityReceipts = sessionQualityReceiptsPath(root);
  const checkpointHasWatermark = checkpointHasSourceWatermark(root, config);
  const ledgerDirExists = directoryExists(ledgerDir);
  const session = readSessionAnchor(root);
  const latestHook = readJsonIfValid(liveHooksLatest);
  const latestQuality = readJsonIfValid(qualityLatest);
  const activeIntent = activeIntentState(root);
  return {
    schema: "nogra.local.continuity_status.v1",
    status: ledgerDirExists && checkpointHasWatermark ? "ready" : "migration-needed",
    ledgerDir: {
      path: localPath(root, ledgerDir),
      exists: ledgerDirExists
    },
    ledgerEvents: {
      path: localPath(root, ledgerFile),
      exists: fs.existsSync(ledgerFile),
      watermark: currentLedgerWatermark(root)
    },
    checkpoint: {
      path: localPath(root, checkpointFile),
      exists: fs.existsSync(checkpointFile),
      hasSourceWatermark: checkpointHasWatermark,
      sourceWatermark: checkpointSourceWatermark(root, config)
    },
    sessionAnchor: {
      path: localPath(root, anchorFile),
      exists: fs.existsSync(anchorFile),
      sessionId: session.sessionId,
      transcriptId: session.transcriptId,
      updatedAt: session.updatedAt
    },
    liveHooks: {
      path: localPath(root, liveHooksFile),
      logPath: localPath(root, liveHooksLog),
      exists: fs.existsSync(liveHooksFile),
      events: nonEmptyLineCount(liveHooksFile),
      latestEvent: cleanInline(latestHook?.eventName),
      latestSummary: cleanInline(latestHook?.summary),
      latestAt: cleanInline(latestHook?.timestamp)
    },
    activeIntent,
    sessionQuality: {
      latestPath: localPath(root, qualityLatest),
      receiptsPath: localPath(root, qualityReceipts),
      exists: fs.existsSync(qualityLatest),
      latestStatus: cleanInline(latestQuality?.status),
      score: Number.isFinite(Number(latestQuality?.score)) ? Number(latestQuality.score) : null,
      maxSeverity: cleanInline(latestQuality?.maxSeverity),
      patternCount: Number.isFinite(Number(latestQuality?.patternCount)) ? Number(latestQuality.patternCount) : 0,
      latestAt: cleanInline(latestQuality?.generatedAt),
      nextGuard: cleanInline(latestQuality?.nextGuard, 160)
    },
    migrationHint: ledgerDirExists && checkpointHasWatermark
      ? ""
      : "Run /nogra:setup or local init --apply in this workspace to merge the 0.5.8 continuity layout without touching app files."
  };
}

function activeIntentState(root) {
  const file = activeIntentPath(root);
  const state = readActiveIntent(root);
  const intent = state.intent && typeof state.intent === "object" ? state.intent : {};
  return {
    path: localPath(root, file),
    exists: fs.existsSync(file),
    status: cleanInline(state.status || "missing", 80),
    active: Boolean(state.active),
    project: cleanInline(intent.project || intent.workspaceName || intent.workspaceId, 160),
    objective: cleanInline(intent.objective, 240),
    currentBlock: cleanInline(intent.currentBlock || intent.block || intent.focus, 240),
    doneWhen: cleanInline(intent.doneWhen || intent.doneCriteria || intent.acceptance, 240),
    updatedAt: cleanInline(intent.updatedAt || intent.generatedAt || intent.startedAt, 80)
  };
}

function boundedLineLimit(value) {
  const number = positiveIntegerOrNull(value) || 25;
  return Math.max(1, Math.min(number, 200));
}

function recentTextLines(file, limit) {
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-limit);
}

function watchPayload(root, options = {}) {
  const lineLimit = boundedLineLimit(options.lines);
  const liveHooksFile = liveHooksJsonlPath(root);
  const liveHooksLog = liveHooksTextPath(root);
  const liveHooksLatest = liveHooksLatestPath(root);
  const latestHook = readJsonIfValid(liveHooksLatest);
  const lines = recentTextLines(liveHooksLog, lineLimit);
  return {
    schema: "nogra.local.watch.v1",
    status: fs.existsSync(liveHooksLog) ? "ok" : "missing",
    mode: "snapshot",
    hostedMcpUsed: false,
    path: localPath(root, liveHooksLog),
    jsonlPath: localPath(root, liveHooksFile),
    latestPath: localPath(root, liveHooksLatest),
    events: nonEmptyLineCount(liveHooksFile),
    latestEvent: cleanInline(latestHook?.eventName),
    latestSummary: cleanInline(latestHook?.summary),
    latestAt: cleanInline(latestHook?.timestamp),
    maxLines: lineLimit,
    lineCount: lines.length,
    lines,
    liveFollow: {
      monitorTarget: localPath(root, liveHooksLog),
      tailCommand: `tail -F ${liveHooksLog}`
    },
    privacy: "Live hook logs are compact event metadata only; they must not store prompt bodies, tool output, file contents or full shell commands."
  };
}

function appendLedgerEvent(root, type, extra = {}) {
  const { releaseVersion: _ignoredReleaseVersion, ...safeExtra } = extra;
  const config = readWorkspaceConfig(root) || {};
  const session = readSessionAnchor(root);
  const ledgerWatermark = currentLedgerWatermark(root) + 1;
  const at = now();
  const event = {
    schema: "nogra.ledger.event.v1",
    eventId: `ledger-event-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    ledgerWatermark,
    generatedAt: at,
    createdAt: at,
    workspaceId: workspaceId(config),
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    type,
    ...safeExtra
  };
  appendJsonlIfMissing(ledgerEventsPath(root), event);
  return event;
}

function diagnosticLedgerSmoke(root, options = {}) {
  const before = checkpointFreshness(root, readWorkspaceConfig(root) || {});
  const event = appendLedgerEvent(root, "diagnostic_ledger_smoke", {
    label: cleanInline(options.label) || "Nogra local ledger smoke",
    summary: "Diagnostic local ledger smoke event. No app files changed.",
    diagnostic: true,
    nextOwner: "Manager"
  });
  const after = checkpointFreshness(root, readWorkspaceConfig(root) || {});
  return {
    schema: "nogra.local.ledger_smoke.v1",
    status: "ok",
    hostedMcpUsed: false,
    event,
    ledgerWatermark: event.ledgerWatermark,
    sessionId: event.sessionId,
    transcriptId: event.transcriptId,
    before,
    after,
    note: "Diagnostic event only; it does not create a brief, dispatch, verification or app-code change."
  };
}

function safeTransportRunId(value) {
  const runId = cleanInline(value);
  if (!/^transport-[A-Za-z0-9_.-]+$/.test(runId)) throw new Error(`invalid transport run id: ${runId || "(empty)"}`);
  return runId;
}

function newTransportRunId() {
  return `transport-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function transportRunPath(root, runId) {
  return path.join(nograDir(root), "transport", "runs", `${safeTransportRunId(runId)}.json`);
}

function transportEventsPath(root) {
  return path.join(nograDir(root), "transport", "events.jsonl");
}

function transportArtifactPath(root, runId, name) {
  return path.join(nograDir(root), "transport", "artifacts", safeTransportRunId(runId), name);
}

// Deterministic scratchRoots declaration for the dispatch receipt (additive
// field). Always includes the run's own artifacts dir (the one scratch
// location the control plane can always name deterministically at dispatch
// time). An optional, repeatable --scratch-root flag lets the caller add
// further roots it CAN name deterministically (e.g. the session's own
// scratchpad path, when the control plane knows it at dispatch time) -- if a
// root cannot be named deterministically, it is simply omitted here rather
// than approximated. Each declared root is symlink-normalized (realpath) when
// it already exists on disk, so downstream containment checks compare
// against the same canonical path a symlink-escape attempt would resolve to.
function resolveDispatchScratchRoots(root, artifactsDirRelative, extraRoots = []) {
  const declared = [];
  const seen = new Set();
  const addRoot = (candidate) => {
    const cleaned = cleanInline(candidate);
    if (!cleaned) return;
    const absolute = path.isAbsolute(cleaned) ? cleaned : path.resolve(root, cleaned);
    let normalized = absolute;
    try {
      normalized = fs.realpathSync(absolute);
    } catch {
      normalized = absolute;
    }
    if (seen.has(normalized)) return;
    seen.add(normalized);
    declared.push(normalized);
  };
  addRoot(path.join(root, artifactsDirRelative));
  for (const extra of extraRoots) {
    addRoot(extra);
  }
  return declared;
}

function transportEvent(runId, type, extra = {}) {
  const { releaseVersion: _ignoredReleaseVersion, ...safeExtra } = extra;
  const at = now();
  return {
    schema: "nogra.transport.event.v1",
    eventId: `transport-event-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    generatedAt: at,
    createdAt: at,
    runId,
    type,
    ...safeExtra
  };
}

function readDraftBrief(root, briefId) {
  return readJson(draftPath(root, briefId));
}

function positiveIntegerOrNull(value) {
  if (value == null || cleanInline(value) === "") return null;
  const number = Number(cleanInline(value));
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseDispatchMaxTurns(value) {
  if (value == null || cleanInline(value) === "") return null;
  const number = positiveIntegerOrNull(value);
  if (!number) {
    throw new Error(`invalid max turns: ${cleanInline(value)}`);
  }
  if (number > ABSOLUTE_EXECUTOR_TURN_CEILING) {
    throw new Error(`max turns exceeds safety ceiling: ${number} > ${ABSOLUTE_EXECUTOR_TURN_CEILING}`);
  }
  return number;
}

function countBriefItems(value) {
  return Array.isArray(value) ? value.filter((item) => cleanInline(item)).length : 0;
}

function firstPathSegment(file) {
  return cleanInline(file).replace(/^\.?\//, "").split("/").filter(Boolean)[0] || "";
}

function executionShapeListCount(shape, keys) {
  if (!shape || typeof shape !== "object") return 0;
  for (const key of keys) {
    const value = shape[key];
    if (Array.isArray(value)) return countBriefItems(value);
    if (value && typeof value === "object") return Object.keys(value).filter(Boolean).length;
  }
  return 0;
}

function couplingSignalsForBrief(brief) {
  const scope = brief.scope && typeof brief.scope === "object" ? brief.scope : {};
  const files = Array.isArray(scope.files) ? scope.files.map(cleanInline).filter(Boolean) : [];
  const roots = new Set(files.map(firstPathSegment).filter(Boolean));
  const text = [
    brief.intent,
    brief.contextHandoff,
    ...(Array.isArray(scope.in) ? scope.in : []),
    ...(Array.isArray(scope.out) ? scope.out : []),
    ...(Array.isArray(brief.successCriteria) ? brief.successCriteria : []),
    ...(Array.isArray(brief.stopCriteria) ? brief.stopCriteria : []),
    ...files
  ].map(cleanInline).join(" ").toLowerCase();
  const signals = [];
  if (files.length >= 4) signals.push("multi-file");
  if (roots.size >= 3) signals.push("cross-area");
  if (/\b(migration|database|schema|prisma|sql|auth|payment|deploy|workflow|hook)\b/.test(text)) {
    signals.push("stateful-or-runtime-risk");
  }
  return signals;
}

function summarizeExecutionSizing({ maxTurns, rawTurns, fileCount, evidenceRequired, couplingSignals, clamped }) {
  if (clamped) {
    return `maxTurns ${maxTurns}: clamped from ${rawTurns}; split into phases, raise the ceiling or use an explicit bounded override.`;
  }
  const factors = [`${fileCount} file${fileCount === 1 ? "" : "s"}`, evidenceRequired];
  if (couplingSignals.length) factors.push(couplingSignals.join("+"));
  return `maxTurns ${maxTurns}: ${factors.join(", ")}.`;
}

function agenticLoopContract(maxTurns) {
  return {
    continueOnStopReason: "tool_use",
    terminalStopReason: "end_turn",
    maxTurns,
    maxTurnsStopReason: "maxTurns_exhausted",
    operatorFacingStatus: "partial",
    operatorFacingReason: "Work stopped before completion while tool work was still pending.",
    rule: "Continue the agentic loop on stop_reason=tool_use. Treat stop_reason=end_turn with the role report as the normal terminal return.",
    ifMaxTurnsHit: "Record internal stopReason=maxTurns_exhausted for ledger continuity, but face the operator with partial/blocked plus a plain returnReason. Include runId, summary, pending tool/request state when available, and a safe continuation. Do not mark the run ok just because the wrapper returned."
  };
}

function commaList(value) {
  return cleanInline(value).split(",").map((item) => cleanInline(item)).filter(Boolean);
}

function hasClaudeTool(tools, name) {
  return tools.some((tool) => tool === name || tool.startsWith(`${name}(`));
}

function publicAgentProfile(wanted, frontmatter) {
  const tools = commaList(frontmatter.tools);
  const disallowedTools = commaList(frontmatter.disallowedTools);
  const hasAllowlist = tools.length > 0;
  const nestedSpawnAllowed = hasAllowlist
    ? hasClaudeTool(tools, "Agent")
    : !hasClaudeTool(disallowedTools, "Agent");
  return {
    tier: "public",
    profile: "scoped-worker-no-nested-spawn",
    role: wanted,
    spawnPrimitive: "Agent",
    roleToolField: hasAllowlist ? "tools" : disallowedTools.length ? "disallowedTools" : "inherited",
    tools,
    disallowedTools,
    nestedSpawnAllowed,
    wall: "Public executor/verifier role frontmatter must explicitly constrain tools and must not include Agent.",
    ifNestedSpawnNeeded: "Route to internal or enterprise orchestration. Do not widen the public role in place."
  };
}

function contextBundleContract(wanted) {
  const include = wanted === "verifier"
    ? ["approvedBrief", "runId", "briefId", "executorReport", "claimedFilesChanged", "successCriteria", "stopCriteria", "evidenceRequirement", "verificationQuestion"]
    : ["approvedBrief", "runId", "briefId", "scopeFiles", "stopCriteria", "successCriteria", "requiredEvidenceLevel"];
  return {
    required: true,
    inheritedContextPolicy: "Spawned agents start with isolated context. Do not rely on parent conversation, shared memory or files already read elsewhere.",
    include,
    priorFindings: {
      requiredWhenAvailable: true,
      rule: "Pass complete prior findings directly in the Agent prompt or context bundle; never pass only a pointer to earlier chat.",
      fields: ["claim", "evidence", "sourceUrl", "documentName", "page", "file", "line", "verificationStatus", "confidence", "agentId"]
    }
  };
}

function findingContract() {
  return {
    structure: "structured-findings-with-attribution",
    fields: ["claim", "evidence", "sourceUrl", "documentName", "page", "file", "line", "verificationStatus", "confidence", "agentId"],
    verificationStatuses: ["verified", "unverified", "claimed"],
    synthesisRule: "Do not upgrade evidence level during synthesis. Claimed or unverified findings stay non-verified until independently checked."
  };
}

function deriveExecutionSizing(brief, runtimeRole, options = {}) {
  const explicitMaxTurns = parseDispatchMaxTurns(options.maxTurns);
  const explicitReason = cleanInline(options.maxTurnsReason);
  if (explicitMaxTurns) {
    return {
      maxTurns: explicitMaxTurns,
      source: "manager dispatch override",
      summary: `maxTurns ${explicitMaxTurns}: explicit Manager override.`,
      reason: explicitReason || "Manager supplied maxTurns after reading the approved brief.",
      requiresManagerDecision: false,
      managerAction: "spawn_executor",
      factors: {
        override: true,
        absoluteCeiling: ABSOLUTE_EXECUTOR_TURN_CEILING
      }
    };
  }

  const scope = brief.scope && typeof brief.scope === "object" ? brief.scope : {};
  const files = Array.isArray(scope.files) ? scope.files.map(cleanInline).filter(Boolean) : [];
  const fileCount = files.length;
  const scopeInCount = countBriefItems(scope.in);
  const successCriteriaCount = countBriefItems(brief.successCriteria);
  const stopCriteriaCount = countBriefItems(brief.stopCriteria);
  const evidenceRequired = cleanInline(brief.evidenceRequired || "reported").toLowerCase();
  const evidenceBumps = {
    reported: 0,
    edited: 4,
    tested: 8,
    verified: 12
  };
  const executionShape = brief.executionShape && typeof brief.executionShape === "object" ? brief.executionShape : {};
  const phaseCount = executionShapeListCount(executionShape, ["phases", "runs", "steps"]);
  const toolNeedCount = executionShapeListCount(executionShape, ["toolNeeds", "tool_needs", "toolFamilies", "tool_families"]);
  const couplingSignals = couplingSignalsForBrief(brief);
  const baseTurns = 24;
  const rawTurns =
    baseTurns +
    Math.min(fileCount, 12) * 4 +
    Math.min(scopeInCount, 6) * 2 +
    Math.min(successCriteriaCount + stopCriteriaCount, 10) +
    (evidenceBumps[evidenceRequired] ?? 0) +
    Math.min(Math.max(phaseCount - 1, 0), 4) * 6 +
    Math.min(toolNeedCount, 4) * 2 +
    (couplingSignals.length ? 8 + Math.max(couplingSignals.length - 1, 0) * 4 : 0);
  const configuredCeiling = positiveIntegerOrNull(runtimeRole?.maxTurns);
  const defaultCeiling = DEFAULT_EXECUTOR_TURN_CEILING;
  const absoluteCeiling = ABSOLUTE_EXECUTOR_TURN_CEILING;
  const cap = Math.min(Math.max(defaultCeiling, configuredCeiling || 0), absoluteCeiling);
  const minTurns = Math.min(20, cap);
  const maxTurns = Math.min(Math.max(rawTurns, minTurns), cap);
  const clamped = rawTurns > cap;
  const summary = summarizeExecutionSizing({ maxTurns, rawTurns, fileCount, evidenceRequired, couplingSignals, clamped });
  return {
    maxTurns,
    source: "approved brief dispatch sizing",
    summary,
    reason: clamped
      ? "Derived after brief approval, then clamped to the executor turn ceiling. Split the work into phases or raise the configured ceiling when the approved scope requires more."
      : "Derived after brief approval from scope files, evidence requirement, execution shape and coupling signals.",
    requiresManagerDecision: clamped,
    managerAction: clamped ? "split_or_confirm_single_run" : "spawn_executor",
    factors: {
      baseTurns,
      fileCount,
      scopeInCount,
      successCriteriaCount,
      stopCriteriaCount,
      evidenceRequired,
      evidenceBump: evidenceBumps[evidenceRequired] ?? 0,
      phaseCount,
      toolNeedCount,
      couplingSignals,
      rawTurns,
      cap,
      defaultCeiling,
      configuredCeiling,
      absoluteCeiling,
      configuredCeilingClampedToAbsolute: Boolean(configuredCeiling && configuredCeiling > absoluteCeiling),
      clamped,
      clampReason: clamped ? "executor turn ceiling" : ""
    }
  };
}

function briefSizingPreview(root, input) {
  const config = readWorkspaceConfig(root) || {};
  const runtime = runtimePolicyState(config);
  const validation = validateBriefPayload(root, input);
  if (!validation.valid) {
    return {
      status: "invalid",
      valid: false,
      preview: true,
      phase: "brief_draft",
      errors: validation.errors,
      normalized: validation.normalized,
      hostedMcpUsed: false
    };
  }

  const normalized = validation.normalized;
  const dispatchSizing = deriveExecutionSizing(normalized, runtime.executor, {});
  const factors = dispatchSizing.factors || {};
  const defaultCeiling = positiveIntegerOrNull(factors.defaultCeiling) || DEFAULT_EXECUTOR_TURN_CEILING;
  const rawTurns = positiveIntegerOrNull(factors.rawTurns) || dispatchSizing.maxTurns;
  const nearDefaultCeiling = rawTurns >= Math.ceil(defaultCeiling * 0.85);
  const coupledScopeRisk = rawTurns >= Math.ceil(defaultCeiling * 0.65) && Array.isArray(factors.couplingSignals) && factors.couplingSignals.length >= 2;
  const operatorDecomposed = Boolean(input && input.operatorDecomposed);
  const risk = dispatchSizing.requiresManagerDecision
    ? "ceiling_clamped"
    : nearDefaultCeiling
      ? "near_default_ceiling"
      : coupledScopeRisk
        ? "coupled_scope"
        : "low";
  const userSurface = risk === "ceiling_clamped"
    ? "ask"
    : operatorDecomposed
      ? "silent"
    : risk === "coupled_scope"
      ? "inform"
      : "silent";
  const requiresPreApprovalDecision = userSurface === "ask";
  const managerAction = userSurface === "ask"
    ? "decide_split_then_confirm_with_user_before_approval"
    : userSurface === "inform"
      ? "decide_split_record_and_inform_one_line"
      : "decide_and_continue_silently";
  const splitShapeHint = "If you split: choose linked sequential phases when a later phase depends on earlier output or touches the same files; choose parallel only when the parts are independent with no shared state or files.";
  const escalateToUserIf = [
    "the split changes the approved deliverable shape, such as one deliverable becoming multiple separately shipped parts the user receives differently",
    "even after splitting, a single bounded run would exceed the absolute ceiling or imply new cost, time or scope beyond the approved brief and GO",
    "the right phase boundary is genuinely ambiguous and a wrong cut would waste a run",
    "the split touches authority or risk the original GO did not cover"
  ];
  const guidance = "Sizing is a Manager decision, not a user decision. Consider splitting this work into multiple runs, linked or parallel, whichever fits the job, or confirm one bounded run. " +
    `${splitShapeHint} Decide it, record the choice in the receipt, and keep the Manager surface clean. Do not present this to the user unless one or more of escalateToUserIf holds; if you do split and the deliverable lands in parts, inform the user in one line rather than asking.`;
  const summary = dispatchSizing.requiresManagerDecision
    ? `estimated maxTurns ${dispatchSizing.maxTurns}: draft estimates ${rawTurns} turns before the ceiling; Manager decides split/reduce and confirms with user before approval.`
    : userSurface === "ask"
      ? `estimated maxTurns ${dispatchSizing.maxTurns}: ${risk.replaceAll("_", " ")}; Manager decides split/single-run, confirm with user before approval.`
      : userSurface === "inform"
        ? `estimated maxTurns ${dispatchSizing.maxTurns}: ${risk.replaceAll("_", " ")}; Manager decides execution shape and informs user in one line if splitting.`
      : dispatchSizing.summary.replace(/^maxTurns /, "estimated maxTurns ");

  return {
    generatedAt: now(),
    status: "ready",
    valid: true,
    preview: true,
    phase: "brief_draft",
    hostedMcpUsed: false,
    briefId: normalized.briefId,
    runtimePolicyProfile: runtime.profile,
    targetModel: cleanInline(runtime.executor.model) || normalized.targetModel || defaultTargetModel(config),
    sizingPreview: {
      estimatedMaxTurns: dispatchSizing.maxTurns,
      source: "draft brief sizing preview",
      summary,
      reason: "Advisory preview from the complete draft brief. It exists to shape or split the brief before approval; dispatch remains the authority for executionMaxTurns.",
      risk,
      requiresPreApprovalDecision,
      userSurface,
      managerAction,
      splitShapeHint,
      escalateToUserIf,
      guidance,
      mustNotWriteMaxTurnsToBrief: true,
      dispatchStillAuthoritative: true,
      factors
    },
    normalized
  };
}

function dispatch(root, options) {
  const config = readWorkspaceConfig(root) || {};
  const runtime = runtimePolicyState(config);
  const brief = options.inputPayload || readDraftBrief(root, options.briefId);
  const validation = validateBriefPayload(root, brief);
  if (!validation.valid) {
    return { status: "invalid", errors: validation.errors, hostedMcpUsed: false };
  }
  const normalized = validation.normalized;
  const runId = newTransportRunId();
  const artifactsDirRelative = `.nogra/transport/artifacts/${runId}`;
  const scratchRoots = resolveDispatchScratchRoots(root, artifactsDirRelative, options.scratchRoots || []);
  const target = cleanInline(options.target) || "executor";
  const targetRuntimeRole = runtimeRoleForTarget(runtime, target);
  const targetRuntimeRoleName = scopedNograRole(target).split(":").pop() || "executor";
  const explicitTargetModel = cleanInline(options.targetModel);
  const targetModel = explicitTargetModel || cleanInline(targetRuntimeRole.model) || normalized.targetModel || defaultTargetModel(config);
  const runtimeSource = explicitTargetModel
    ? "dispatch targetModel override"
    : runtime.profile === "custom"
      ? `runtimePolicy.roles.${targetRuntimeRoleName}`
      : "release default";
  const executionSizing = deriveExecutionSizing(normalized, targetRuntimeRole, {
    maxTurns: options.maxTurns,
    maxTurnsReason: options.maxTurnsReason
  });
  const executionPair = roleRuntimePair(scopedNograRole(target), targetModel, "queued");
  const nextOwner = executionSizing.requiresManagerDecision ? "Manager" : executionPair.executionRole;
  const executionNextStep = executionSizing.requiresManagerDecision
    ? "Review dispatch sizing before spawning: split into phases when the approved brief/GO covers it, rerun with an explicit bounded override if the operator wants one larger run, or ask for a decision."
    : `Spawn a subagent in the plugin-provided ${executionPair.executionRole} role with this run id and the full approved brief.`;
  const at = now();
  const ledgerEvent = appendLedgerEvent(root, "dispatch_created", {
    runId,
    briefId: normalized.briefId,
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: targetRuntimeRole.effort,
    executionContext: targetRuntimeRole.context,
    nextOwner
  });
  const run = {
    schema: "nogra.transport.run.v1",
    runId,
    createdAt: at,
    updatedAt: at,
    status: "queued",
    phase: "queued",
    owner: "Manager",
    nextOwner,
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: targetRuntimeRole.effort,
    executionContext: targetRuntimeRole.context,
    executionMaxTurns: executionSizing.maxTurns,
    executionSizing,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    briefId: normalized.briefId,
    scratchRoots,
    metadata: {
      mode: "local",
      receiptType: "localDispatchReceipt",
      targetRole: target,
      targetModel,
      scratchRoots,
      scopeFiles: normalized.scope?.files || [],
      successCriteria: normalized.successCriteria || [],
      stopCriteria: normalized.stopCriteria || [],
      executionRole: executionPair.executionRole,
      executionRuntime: executionPair.executionRuntime,
      executionEffort: targetRuntimeRole.effort,
      executionContext: targetRuntimeRole.context,
      executionMaxTurns: executionSizing.maxTurns,
      executionSizing,
      executionRuntimePolicyProfile: runtime.profile,
      executionRuntimeSource: runtimeSource,
      executionLabel: executionPair.executionLabel,
      ledgerWatermark: ledgerEvent.ledgerWatermark,
      sessionId: ledgerEvent.sessionId,
      transcriptId: ledgerEvent.transcriptId,
      nextOwner
    },
    paths: {
      artifactsDir: artifactsDirRelative,
      report: `${artifactsDirRelative}/report.md`,
      output: `${artifactsDirRelative}/output.md`,
      validation: `${artifactsDirRelative}/validation.json`
    },
    artifacts: {
      reportExists: false,
      outputExists: false,
      validationExists: false
    },
    summary: "",
    error: "",
    redactions: []
  };
  writeJsonAtomic(transportRunPath(root, runId), run);
  const event = transportEvent(runId, "local_dispatch_receipt_created", {
    workspaceId: workspaceId(config),
    owner: "Manager",
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: targetRuntimeRole.effort,
    executionContext: targetRuntimeRole.context,
    executionMaxTurns: executionSizing.maxTurns,
    executionSizing,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    briefId: normalized.briefId,
    nextOwner
  });
  appendJsonlIfMissing(transportEventsPath(root), event);
  return {
    generatedAt: at,
    status: "ready",
    mode: "local",
    receiptType: "localDispatchReceipt",
    runId,
    briefId: normalized.briefId,
    owner: "Manager",
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: targetRuntimeRole.effort,
    executionContext: targetRuntimeRole.context,
    executionMaxTurns: executionSizing.maxTurns,
    executionSizing,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    scratchRoots,
    hostedMcpUsed: false,
    transport: {
      armed: true,
      ledger: "local .nogra/",
      runtime: `customer-side subagent in ${targetRuntimeRoleName} role`,
      localArtifacts: run.paths
    },
    executionCrossing: {
      required: true,
      managerMayImplement: false,
      owner: "Manager",
      nextOwner,
      role: executionPair.executionRole,
      spawnPrimitive: "Agent",
      profile: "public-scoped-worker",
      nestedSpawnAllowed: false,
      contextBundleRequired: true,
      priorFindingsRequiredWhenAvailable: true,
      runtime: executionPair.executionRuntime,
      effort: targetRuntimeRole.effort,
      context: targetRuntimeRole.context,
      maxTurns: executionSizing.maxTurns,
      maxTurnsSource: executionSizing.source,
      maxTurnsSummary: executionSizing.summary,
      maxTurnsReason: executionSizing.reason,
      sizingDecisionRequired: executionSizing.requiresManagerDecision,
      sizingManagerAction: executionSizing.managerAction,
      agenticLoop: agenticLoopContract(executionSizing.maxTurns),
      runtimePolicyProfile: runtime.profile,
      runtimeSource: `${runtimeSource}; Claude Code may resolve this to a concrete model id at spawn time`,
      label: executionPair.executionLabel,
      nextStep: executionNextStep,
      ifUnavailable: "Stop and surface the missing primitive. Do not execute inline unless the user explicitly leaves Nogra."
    },
    brief: normalized,
    run,
    nextOwner
  };
}

function handoffContract(root, kind, options = {}) {
  const wanted = cleanInline(kind || "executor").toLowerCase();
  const file = wanted === "verifier" ? "verifier.md" : wanted === "executor" ? "executor.md" : "";
  if (!file) {
    return {
      schema: "nogra.handoff.contract.v1",
      status: "invalid",
      kind: wanted,
      availableKinds: ["executor", "verifier"],
      error: "unknown handoff kind",
      hostedMcpUsed: false
    };
  }
  const config = readWorkspaceConfig(root) || {};
  const runtime = runtimePolicyState(config);
  const configuredRole = wanted === "verifier" ? runtime.verifier : runtime.executor;
  const prompt = readText(path.join(pluginRoot, "agents", file));
  const frontmatter = parseFrontmatter(prompt);
  const scopedRole = `nogra:${wanted}`;
  const modelHint = runtime.profile === "custom" ? configuredRole.model : RELEASE_RUNTIME_FALLBACK[wanted].model;
  const effortHint = runtime.profile === "custom" ? configuredRole.effort : RELEASE_RUNTIME_FALLBACK[wanted].effort;
  const runtimeSource = runtime.profile === "custom" ? `runtimePolicy.roles.${wanted}` : "release default";
  const pair = roleRuntimePair(scopedRole, modelHint);
  const runId = cleanInline(options.runId || "");
  const run = runId ? readJson(transportRunPath(root, runId)) : null;
  const runMaxTurns = wanted === "executor"
    ? positiveIntegerOrNull(run?.executionMaxTurns ?? run?.metadata?.executionMaxTurns)
    : null;
  const configuredMaxTurns = positiveIntegerOrNull(configuredRole.maxTurns);
  const frontmatterMaxTurns = positiveIntegerOrNull(frontmatter.maxTurns);
  const maxTurnsHint = runMaxTurns || configuredMaxTurns || frontmatterMaxTurns || undefined;
  const maxTurnsHintSource = runMaxTurns
    ? "dispatch receipt"
    : configuredMaxTurns
      ? runtimeSource
      : frontmatterMaxTurns
        ? "role frontmatter fallback"
        : "none";
  const agentProfile = publicAgentProfile(wanted, frontmatter);
  return {
    schema: "nogra.handoff.contract.v1",
    status: "ready",
    kind: wanted,
    title: wanted === "executor" ? "Executor role contract" : "Verifier role contract",
    purpose: wanted === "executor" ? "Implement one approved Nogra run inside the brief scope and return evidence." : "Independently verify one executor-role report against the approved brief.",
    executionModel: "plugin-registered-agent",
    hostedMcpUsed: false,
    targetSubagent: {
      type: wanted,
      scopedRole,
      spawnPrimitive: "Agent",
      background: true,
      modelHint,
      effortHint,
      contextHint: configuredRole.context,
      maxTurnsHint,
      maxTurnsHintSource
    },
    publicProfile: agentProfile,
    contextBundle: contextBundleContract(wanted),
    findingContract: findingContract(),
    agenticLoop: agenticLoopContract(maxTurnsHint || null),
    dispatchContext: run ? {
      runId: run.runId || runId,
      briefId: run.briefId || "",
      maxTurns: runMaxTurns,
      maxTurnsSource: run.executionSizing?.source || run.metadata?.executionSizing?.source || "",
      maxTurnsSummary: run.executionSizing?.summary || run.metadata?.executionSizing?.summary || "",
      requiresManagerDecision: Boolean(run.executionSizing?.requiresManagerDecision || run.metadata?.executionSizing?.requiresManagerDecision),
      managerAction: run.executionSizing?.managerAction || run.metadata?.executionSizing?.managerAction || ""
    } : null,
    roleRuntime: {
      ...pair,
      executionEffort: effortHint,
      executionContext: configuredRole.context,
      executionRuntimePolicyProfile: runtime.profile,
      executionRuntimeSource: runtimeSource
    },
    prompt,
    managerInstructions: [
      "Use this contract at dispatch or verification boundaries only.",
      `Spawn with the Claude Code Agent primitive into the plugin-provided ${scopedRole} role.`,
      "Include the complete context bundle in the Agent prompt; spawned agents do not inherit parent conversation, shared memory or files read by Manager.",
      "Pass complete prior findings with attribution when they matter. Use structured fields such as claim, evidence, source URL/document/page or file/line, verificationStatus, confidence and agent id.",
      "Public executor/verifier roles intentionally omit Agent from their frontmatter tools. They must not spawn nested subagents; route fan-out to internal or enterprise orchestration instead.",
      "Manager is not the role-runtime. If the role primitive is unavailable, stop and surface the missing primitive.",
      "Keep Nogra bookkeeping in Manager. The spawned role-runtime receives the brief, scope and evidence contract and returns a report.",
      "If runtimePolicy is custom and the client supports per-invocation model/effort overrides, request the configured model and effort; otherwise rely on the release default resolved by the local runtime and report the limitation plainly.",
      "If targetSubagent.maxTurnsHint is present and the client supports per-invocation turn limits, pass that value to the spawn primitive. Prefer dispatch receipt sizing when a run id is available; role frontmatter is only a generic fallback.",
      "For agentic loop control, continue when stop_reason=tool_use and terminate only when stop_reason=end_turn returns the role report.",
      "If maxTurns or the client turn limit stops the role before a normal report, record internal stopReason=maxTurns_exhausted, but face the operator with partial/blocked plus a plain reason such as work stopped before completion with pending tool work. Carry the run id, pending tool/request state and safe continuation back to Manager. Do not treat that wrapper return as completion.",
      "If dispatchContext.requiresManagerDecision is true, do not spawn blindly. Manager must split the work, use an explicit bounded override with operator approval, or ask for a decision first.",
      "Surface role and runtime honestly: user-facing labels should be role plus runtime, such as Executor · Sonnet.",
      "Tier labels appear only when the approved role graph explicitly supplies them; executor is not Tier 1."
    ]
  };
}

function normalizeVerificationStatus(value) {
  const cleaned = cleanInline(value).toLowerCase();
  if (!cleaned) return "";
  if (["ship", "shipped", "pass", "passed", "ok"].includes(cleaned)) return "ok";
  if (["deviation", "partial"].includes(cleaned)) return "partial";
  if (["blocked", "unverified", "decision_required"].includes(cleaned)) return "blocked";
  if (["failed", "fail"].includes(cleaned)) return "failed";
  return TRANSPORT_STATUSES.has(cleaned) ? cleaned : "";
}

function acceptanceStatus(value) {
  return cleanInline(value).toLowerCase().replaceAll(" ", "_");
}

function inferVerificationStatus(evidence) {
  const explicit = normalizeVerificationStatus(evidence.status || evidence.verification || evidence.verdict);
  if (explicit) return explicit;
  const acceptance = Array.isArray(evidence.acceptance) ? evidence.acceptance : [];
  const deviations = Array.isArray(evidence.briefDeviations) ? evidence.briefDeviations : [];
  if (evidence.decisionRequired) return "blocked";
  if (deviations.length) return "partial";
  if (!acceptance.length) return "blocked";
  const failed = new Set(["failed", "fail", "missing", "not_met", "unmet", "blocked"]);
  const met = new Set(["met", "pass", "passed", "ok", "yes", "verified"]);
  if (acceptance.some((item) => failed.has(acceptanceStatus(item?.status)))) return "blocked";
  if (acceptance.every((item) => met.has(acceptanceStatus(item?.status)))) return "ok";
  return "blocked";
}

function normalizeVerificationVerdict(value) {
  const cleaned = cleanInline(value).toLowerCase();
  if (!cleaned) return "";
  if (["ship", "shipped", "pass", "passed", "ok"].includes(cleaned)) return "ship";
  if (["deviation", "partial"].includes(cleaned)) return "deviation";
  if (["blocked", "failed", "fail"].includes(cleaned)) return "blocked";
  if (cleaned === "decision_required") return "decision_required";
  if (cleaned === "unverified") return "unverified";
  return "";
}

function inferVerificationVerdict(evidence) {
  const explicit = normalizeVerificationVerdict(evidence.verdict || evidence.status || evidence.verification);
  if (explicit) return explicit;
  const acceptance = Array.isArray(evidence.acceptance) ? evidence.acceptance : [];
  const deviations = Array.isArray(evidence.briefDeviations) ? evidence.briefDeviations : [];
  if (evidence.decisionRequired) return "decision_required";
  if (deviations.length) return "deviation";
  if (!acceptance.length) return "unverified";
  const failed = new Set(["failed", "fail", "missing", "not_met", "unmet", "blocked"]);
  const met = new Set(["met", "pass", "passed", "ok", "yes", "verified"]);
  if (acceptance.some((item) => failed.has(acceptanceStatus(item?.status)))) return "blocked";
  if (acceptance.every((item) => met.has(acceptanceStatus(item?.status)))) return "ship";
  return "unverified";
}

function verifySupport(root, options) {
  const runId = safeTransportRunId(options.runId);
  const runFile = transportRunPath(root, runId);
  const run = readJson(runFile);
  const evidence = options.inputPayload || {};
  const status = inferVerificationStatus(evidence);
  const verdict = inferVerificationVerdict(evidence);
  const reason = cleanText(evidence.reason || "");
  if (verdict !== "ship" && !reason) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict,
      reason,
      error: "Verification reason is required before returning a non-ship verdict to Manager.",
      nextOwner: "Manager"
    };
  }
  const at = now();
  const ledgerEvent = appendLedgerEvent(root, "verification_recorded", {
    runId,
    briefId: run.briefId || "",
    status,
    verdict,
    reason
  });
  const verificationState = {
    verificationRole: run.verificationRole || run.metadata?.verificationRole || "",
    verificationRuntime: run.verificationRuntime || run.metadata?.verificationRuntime || "",
    verificationStatus: run.verificationStatus || run.metadata?.verificationStatus || "",
    verificationLabel: run.verificationLabel || run.metadata?.verificationLabel || ""
  };
  const validation = {
    schema: "nogra.local.validation.v1",
    generatedAt: at,
    runId,
    briefId: run.briefId || "",
    status,
    verdict,
    hostedMcpUsed: false,
    summary: cleanText(evidence.summary || "Local verification support recorded. Manager remains final verification authority."),
    reason,
    executionRole: run.executionRole || run.metadata?.executionRole || "",
    executionRuntime: run.executionRuntime || run.metadata?.executionRuntime || run.targetModel || "",
    executionEffort: run.executionEffort || run.metadata?.executionEffort || "",
    executionContext: run.executionContext || run.metadata?.executionContext || "",
    executionRuntimePolicyProfile: run.executionRuntimePolicyProfile || run.metadata?.executionRuntimePolicyProfile || "",
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    executionLabel: roleRuntimePair(
      run.executionRole || run.metadata?.executionRole || "nogra:executor",
      run.executionRuntime || run.metadata?.executionRuntime || run.targetModel || "",
      status
    ).executionLabel,
    ...verificationState,
    acceptance: Array.isArray(evidence.acceptance) ? evidence.acceptance : [],
    briefDeviations: Array.isArray(evidence.briefDeviations) ? evidence.briefDeviations : [],
    decisionRequired: Boolean(evidence.decisionRequired),
    nextOwner: "Manager"
  };
  writeJsonAtomic(transportArtifactPath(root, runId, "validation.json"), validation);
  const updatedRun = {
    ...run,
    updatedAt: at,
    status,
    phase: "returned",
    executionLabel: roleRuntimePair(
      run.executionRole || run.metadata?.executionRole || "nogra:executor",
      run.executionRuntime || run.metadata?.executionRuntime || run.targetModel || "",
      status
    ).executionLabel,
    artifacts: {
      ...(run.artifacts || {}),
      validationExists: true
    },
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId || run.sessionId || run.metadata?.sessionId || "",
    transcriptId: ledgerEvent.transcriptId || run.transcriptId || run.metadata?.transcriptId || "",
    summary: validation.summary
  };
  writeJsonAtomic(runFile, updatedRun);
  const event = transportEvent(runId, "local_verification_recorded", {
    workspaceId: updatedRun.workspaceId || workspaceId(readWorkspaceConfig(root) || {}),
    status,
    phase: "returned",
    target: updatedRun.target || "",
    targetRole: updatedRun.targetRole || "",
    targetModel: updatedRun.targetModel || "",
    executionRole: updatedRun.executionRole || updatedRun.metadata?.executionRole || "",
    executionRuntime: updatedRun.executionRuntime || updatedRun.metadata?.executionRuntime || updatedRun.targetModel || "",
    executionEffort: updatedRun.executionEffort || updatedRun.metadata?.executionEffort || "",
    executionRuntimePolicyProfile: updatedRun.executionRuntimePolicyProfile || updatedRun.metadata?.executionRuntimePolicyProfile || "",
    executionLabel: updatedRun.executionLabel || "",
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    ...verificationState,
    briefId: updatedRun.briefId || "",
    summary: validation.summary,
    verdict,
    reason,
    nextOwner: "Manager"
  });
  appendJsonlIfMissing(transportEventsPath(root), event);
  return {
    status,
    mode: "local",
    hostedMcpUsed: false,
    run: updatedRun,
    validation,
    verdict,
    reason,
    nextOwner: "Manager"
  };
}

function printText(payload) {
  if (payload.schema === "nogra.local.status.v1") {
    console.log("Nogra local status");
    console.log(`- Plugin: ${payload.plugin.name} ${payload.plugin.version}`);
    console.log(`- Workspace: ${payload.workspace.initialized ? payload.workspace.workspaceId || "local" : "not initialized"}`);
    console.log(`- Control plane: ${payload.hostedMcpUsed ? "connected" : "local"}`);
    console.log(`- Bridge: ${payload.bridge?.status || "unknown"}${payload.bridge?.version ? ` ${payload.bridge.version}` : ""}`);
    console.log(`- Git: ${payload.git?.status || "unknown"}${Number.isFinite(Number(payload.git?.dirtyCount)) ? ` (${payload.git.dirtyCount})` : ""}`);
    console.log(`- Promotion: ${payload.promotion?.status || "unknown"}`);
    if (payload.continuity?.activeIntent?.exists) {
      const intent = payload.continuity.activeIntent;
      console.log(`- Active intent: ${intent.active ? "active" : intent.status || "inactive"}${intent.objective ? ` - ${intent.objective}` : ""}`);
    }
    if (payload.continuity?.sessionQuality?.exists) {
      console.log(`- Session quality: ${payload.continuity.sessionQuality.latestStatus || "unknown"} (${payload.continuity.sessionQuality.patternCount || 0})`);
    }
    for (const warning of payload.plugin.diagnostics?.warnings || []) {
      console.log(`- Warning: ${warning.message}`);
    }
    console.log(`- Recent briefs: ${payload.recent.briefs.length}`);
    console.log(`- Recent transport runs: ${payload.recent.transportRuns.length}`);
    return;
  }
  if (payload.schema === "nogra.local.watch.v1") {
    console.log("Nogra live hooks");
    console.log(`- Status: ${payload.status}`);
    console.log(`- Log: ${payload.path}`);
    console.log(`- Events: ${payload.events}`);
    if (payload.latestEvent) {
      console.log(`- Latest: ${payload.latestEvent}${payload.latestSummary ? ` - ${payload.latestSummary}` : ""}`);
    }
    if (!payload.lines.length) {
      console.log("- Recent: none");
      return;
    }
    console.log(`- Recent (${payload.lineCount}/${payload.maxLines}):`);
    for (const line of payload.lines) console.log(`  ${line}`);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function printPayload(payload, options) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printText(payload);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const command = options._[0] || "help";
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }
  const targetsRequestedRoot = new Set(["init", "init-bundle"]);
  const root = workspaceRoot(options, { nearestNogra: !targetsRequestedRoot.has(command) });
  let payload;
  if (command === "status") {
    payload = statusPayload(root);
  } else if (command === "watch") {
    payload = watchPayload(root, options);
  } else if (command === "registry") {
    payload = registryPayload(root);
  } else if (command === "init-bundle") {
    payload = initBundlePayload(root, options["workspace-name"] || "");
  } else if (command === "init") {
    if (!options.apply) {
      payload = initBundlePayload(root, options["workspace-name"] || "");
    } else {
      payload = applyInit(root, options["workspace-name"] || "", { migrateLocal: Boolean(options["migrate-local"]) });
    }
  } else if (command === "create-project" || command === "create") {
    payload = createProject(root, {
      name: options._[1] || options.name || "",
      workspaceId: options["workspace-id"] || options.workspaceId || "",
      projectPath: options["project-path"] || options.projectPath || "",
      apply: Boolean(options.apply)
    });
  } else if (command === "brain-init") {
    payload = options.apply
      ? applyBrainInit(root, options["workspace-name"] || "")
      : brainInitBundlePayload(root, options["workspace-name"] || "");
  } else if (command === "brief-contract") {
    payload = briefContract(root);
  } else if (command === "brief-validate") {
    payload = validateBriefPayload(root, readInput(options));
  } else if (command === "brief-sizing-preview" || command === "brief-size-preview") {
    payload = briefSizingPreview(root, readInput(options));
  } else if (command === "brief-save") {
    payload = saveBrief(root, readInput(options), options.source || "");
  } else if (command === "brief-promote") {
    payload = promoteBrief(root, {
      briefId: options["brief-id"] || "",
      inputPayload: options.input ? readInput(options) : null
    });
  } else if (command === "ledger-smoke") {
    payload = diagnosticLedgerSmoke(root, {
      label: options.label || ""
    });
  } else if (command === "quality" || command === "session-quality") {
    const receipt = analyzeSessionQuality(root, {
      transcriptPath: options.transcript || options["transcript-path"] || "",
      sessionId: options["session-id"] || options.sessionId || ""
    });
    payload = options.write ? writeSessionQualityReceipt(root, receipt) : receipt;
  } else if (command === "handoff-contract") {
    payload = handoffContract(root, options.kind || "executor", {
      runId: options["run-id"] || options.runId || ""
    });
  } else if (command === "dispatch") {
    payload = dispatch(root, {
      briefId: options["brief-id"] || "",
      inputPayload: options.input ? readInput(options) : null,
      target: options.target || "executor",
      targetModel: options["target-model"] || options.targetModel || "",
      maxTurns: options["max-turns"] || options.maxTurns || "",
      maxTurnsReason: options["max-turns-reason"] || options.maxTurnsReason || "",
      scratchRoots: collectRepeatableFlag(process.argv.slice(2), "scratch-root")
    });
  } else if (command === "verify") {
    payload = verifySupport(root, {
      runId: options["run-id"] || "",
      inputPayload: readInput(options, false)
    });
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }
  printPayload(payload, options);
  return 0;
}

export {
  statusPayload,
  workspaceRoot
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`nogra-local: ${error.message}`);
    process.exitCode = 1;
  }
}
