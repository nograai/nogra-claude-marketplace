#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RELEASE_VERSION = "v1.0.0";
const INIT_BUNDLE_VERSION = "v1.0.0";
const BRIEF_SCHEMA = "nogra.brief.v1";
const INIT_BUNDLE_SCHEMA = "nogra.init.bundle.v1";
const TRANSPORT_STATUSES = new Set(["queued", "running", "returning", "returned", "ok", "partial", "blocked", "failed", "cancelled", "acknowledged"]);
const BRIEF_STATUSES = new Set(["draft", "ready", "approved", "in_progress", "returned", "accepted", "archived"]);
const EVIDENCE_LEVELS = new Set(["reported", "edited", "tested", "verified"]);

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const contractsRoot = path.join(pluginRoot, "contracts");

function usage() {
  return [
    "Usage:",
    "  node scripts/nogra-local.mjs status [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs registry [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs init-bundle [--root <dir>] [--workspace-name <name>] [--json]",
    "  node scripts/nogra-local.mjs init --apply [--root <dir>] [--workspace-name <name>] [--json]",
    "  node scripts/nogra-local.mjs brief-contract [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs brief-validate [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs brief-save [--root <dir>] [--input <file>] [--source <label>] [--json]",
    "  node scripts/nogra-local.mjs brief-promote [--root <dir>] [--brief-id <id>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs handoff-contract [--root <dir>] --kind executor|verifier [--json]",
    "  node scripts/nogra-local.mjs dispatch [--root <dir>] --brief-id <id> [--target executor] [--target-model <model>] [--json]",
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
    if (["json", "apply", "dry-run", "migrate-local"].includes(name)) {
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

function workspaceRoot(options) {
  return path.resolve(String(options.root || process.env.CLAUDE_PROJECT_DIR || process.cwd()));
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

function pluginDiagnostics(plugin) {
  const context = pluginInstallContext();
  const installed = listInstalledNograPlugins();
  const activeCoreInstalls = installed.filter((item) => item.name === "nogra" && !item.orphaned);
  const marketplaces = marketplaceCandidates(context, plugin.name);
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

const RELEASE_RUNTIME_FALLBACK = {
  executor: {
    model: "anthropic:sonnet",
    effort: "medium",
    context: "default",
    maxTurns: null
  },
  verifier: {
    model: "sonnet",
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
    releaseVersion: RELEASE_VERSION,
    initBundleVersion: INIT_BUNDLE_VERSION,
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

function statusPayload(root) {
  const plugin = pluginJson();
  const diagnostics = pluginDiagnostics(plugin);
  const mode = detectMode(root);
  const config = mode.config && !mode.config.__invalid ? mode.config : {};
  const runtime = runtimePolicyState(config);
  const briefs = listBriefs(root, 1);
  const runs = listTransportRuns(root, 1);
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
        warnings: diagnostics.warnings
      }
    },
    workspace: {
      root,
      initialized: mode.initialized,
      mode: mode.mode,
      label: mode.label,
      source: mode.source,
      workspaceId: workspaceId(config),
      releaseVersion: cleanInline(config.releaseVersion) || ""
    },
    routingPolicy: config.routingPolicy
      ? {
          autoOfferEnabled: config.routingPolicy.autoOfferEnabled !== false && config.routingPolicy.enabled !== false,
          sensitivityPercent: config.routingPolicy.sensitivityPercent ?? 50,
          defaultLanguage: cleanInline(config.routingPolicy.defaultLanguage) || "en"
        }
      : null,
    runtimePolicy: config.runtimePolicy
      ? {
          profile: runtime.profile,
          rawProfile: runtime.rawProfile,
          source: runtime.source,
          legacyAgentFallback: runtime.legacyAgentFallback
        }
      : null,
    recent: {
      briefs,
      transportRuns: runs
    },
    next: mode.initialized ? ["/nogra:brief", "/nogra:status"] : ["/nogra:setup"]
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
    generatedAt,
    version: INIT_BUNDLE_VERSION,
    releaseVersion: RELEASE_VERSION,
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
    releaseVersion: RELEASE_VERSION,
    status: "ready",
    bundleId: "init-bundle-v1",
    version: INIT_BUNDLE_VERSION,
    initMode: "plugin",
    connectionMode: "local",
    generatedAt,
    serverMode: "plugin-local",
    hostedMcpUsed: false,
    workspaceId: context.workspaceId,
    workspaceName: cleanName,
    writeMode: "client_writes_or_local_runtime_applies_files",
    installPlan: initInstallPlan(files, "plugin"),
    postInstallMessage: "Nogra is installed in this folder. Brief, dispatch and verification records live in .nogra/.",
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
      "Merge .nogra/config.json preserving existing values.",
      "Preserve .claude/ files; setup writes only returned Nogra files.",
      "Use /nogra:adapt for existing projects after setup."
    ]
  };
}

function mergeConfig(existing, incoming, options = {}) {
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
      out[key] = mergeConfig(out[key], value, options);
    }
  }
  return out;
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

function briefContract(root) {
  const config = readWorkspaceConfig(root) || {};
  const returnPolicy = defaultReturnPolicy(config);
  const schema = contractJson("schemas/brief-v1.schema.json");
  return {
    schema: "nogra.brief.contract.v1",
    releaseVersion: RELEASE_VERSION,
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
  const brief = {
    schema: cleanInline(input.schema || existing.schema || BRIEF_SCHEMA),
    releaseVersion: cleanInline(input.releaseVersion || existing.releaseVersion || RELEASE_VERSION),
    briefId: safeBriefId(input.briefId || input.brief_id || input.id || existing.briefId || newBriefId(title)),
    workspaceId: cleanInline(input.workspaceId || input.workspace_id || existing.workspaceId || workspaceId(config)),
    title,
    createdAt: cleanInline(input.createdAt || existing.createdAt || at),
    updatedAt: cleanInline(input.updatedAt || existing.updatedAt || at),
    status: cleanInline(input.status || existing.status || "draft") || "draft",
    owner: cleanInline(input.owner || existing.owner || ""),
    targetRole: cleanInline(input.targetRole || input.target_role || existing.targetRole || ""),
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
  for (const key of ["schema", "releaseVersion", "briefId", "workspaceId", "title", "createdAt", "intent", "contextHandoff", "scope", "successCriteria", "stopCriteria", "maxOutput"]) {
    if (brief[key] == null || brief[key] === "") errors.push(`brief missing ${key}`);
  }
  if (brief.schema !== BRIEF_SCHEMA) errors.push(`brief schema mismatch: ${brief.schema}`);
  if (!/^v[1-9][0-9]*\.[0-9]+\.[0-9]+$/.test(cleanInline(brief.releaseVersion))) errors.push("brief releaseVersion is invalid");
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
  return {
    ...draft,
    id: draft.briefId,
    path: localPath(root, file),
    overviewPath: localPath(root, overviewFile),
    status: "draft",
    valid: true,
    errors: [],
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
    ["releaseVersion", brief.releaseVersion],
    ["briefId", brief.briefId],
    ["workspaceId", brief.workspaceId],
    ["title", brief.title],
    ["createdAt", brief.createdAt],
    ["updatedAt", brief.updatedAt],
    ["status", brief.status],
    ["owner", brief.owner || ""],
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
  return {
    status: "ready",
    valid: true,
    errors: [],
    draft: { ...updatedDraft, id: ready.briefId, path: localPath(root, draftFile), overviewPath: localPath(root, overviewFile) },
    brief: { ...updatedDraft, id: ready.briefId, path: localPath(root, briefFile) },
    path: localPath(root, briefFile),
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

function transportEvent(runId, type, extra = {}) {
  const at = now();
  return {
    schema: "nogra.transport.event.v1",
    releaseVersion: RELEASE_VERSION,
    eventId: `transport-event-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    generatedAt: at,
    createdAt: at,
    runId,
    type,
    ...extra
  };
}

function readDraftBrief(root, briefId) {
  return readJson(draftPath(root, briefId));
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
  const target = cleanInline(options.target) || "executor";
  const explicitTargetModel = cleanInline(options.targetModel);
  const targetModel = explicitTargetModel || cleanInline(runtime.executor.model) || normalized.targetModel || defaultTargetModel(config);
  const runtimeSource = explicitTargetModel
    ? "dispatch targetModel override"
    : runtime.profile === "custom"
      ? "runtimePolicy.roles.executor"
      : "release default";
  const executionPair = roleRuntimePair("nogra:executor", targetModel, "queued");
  const at = now();
  const run = {
    schema: "nogra.transport.run.v1",
    releaseVersion: RELEASE_VERSION,
    runId,
    createdAt: at,
    updatedAt: at,
    status: "queued",
    phase: "queued",
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: runtime.executor.effort,
    executionContext: runtime.executor.context,
    executionMaxTurns: runtime.executor.maxTurns,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    briefId: normalized.briefId,
    metadata: {
      mode: "local",
      receiptType: "localDispatchReceipt",
      targetRole: target,
      targetModel,
      scopeFiles: normalized.scope?.files || [],
      successCriteria: normalized.successCriteria || [],
      stopCriteria: normalized.stopCriteria || [],
      executionRole: executionPair.executionRole,
      executionRuntime: executionPair.executionRuntime,
      executionEffort: runtime.executor.effort,
      executionContext: runtime.executor.context,
      executionMaxTurns: runtime.executor.maxTurns,
      executionRuntimePolicyProfile: runtime.profile,
      executionRuntimeSource: runtimeSource,
      executionLabel: executionPair.executionLabel,
      nextOwner: "ManagerSpawnsPluginExecutor"
    },
    paths: {
      artifactsDir: `.nogra/transport/artifacts/${runId}`,
      report: `.nogra/transport/artifacts/${runId}/report.md`,
      output: `.nogra/transport/artifacts/${runId}/output.md`,
      validation: `.nogra/transport/artifacts/${runId}/validation.json`
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
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: runtime.executor.effort,
    executionContext: runtime.executor.context,
    executionMaxTurns: runtime.executor.maxTurns,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    briefId: normalized.briefId,
    nextOwner: "ManagerClaude"
  });
  appendJsonlIfMissing(transportEventsPath(root), event);
  return {
    generatedAt: at,
    status: "ready",
    mode: "local",
    receiptType: "localDispatchReceipt",
    runId,
    briefId: normalized.briefId,
    target,
    targetRole: target,
    targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: runtime.executor.effort,
    executionContext: runtime.executor.context,
    executionMaxTurns: runtime.executor.maxTurns,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: executionPair.executionLabel,
    hostedMcpUsed: false,
    transport: {
      armed: true,
      ledger: "local .nogra/",
      runtime: "customer-side subagent in executor role",
      localArtifacts: run.paths
    },
    executionCrossing: {
      required: true,
      managerMayImplement: false,
      role: executionPair.executionRole,
      runtime: executionPair.executionRuntime,
      effort: runtime.executor.effort,
      context: runtime.executor.context,
      maxTurns: runtime.executor.maxTurns,
      runtimePolicyProfile: runtime.profile,
      runtimeSource: `${runtimeSource}; Claude Code may resolve this to a concrete model id at spawn time`,
      label: executionPair.executionLabel,
      nextStep: "Spawn a subagent in the plugin-provided nogra:executor role with this run id and the full approved brief.",
      ifUnavailable: "Stop and surface the missing primitive. Do not execute inline unless the user explicitly leaves Nogra."
    },
    brief: normalized,
    run,
    nextOwner: "ManagerSpawnsPluginExecutor"
  };
}

function handoffContract(root, kind) {
  const wanted = cleanInline(kind || "executor").toLowerCase();
  const file = wanted === "verifier" ? "verifier.md" : wanted === "executor" ? "executor.md" : "";
  if (!file) {
    return {
      schema: "nogra.handoff.contract.v1",
      releaseVersion: RELEASE_VERSION,
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
  return {
    schema: "nogra.handoff.contract.v1",
    releaseVersion: RELEASE_VERSION,
    status: "ready",
    kind: wanted,
    title: wanted === "executor" ? "Executor role contract" : "Verifier role contract",
    purpose: wanted === "executor" ? "Implement one approved Nogra run inside the brief scope and return evidence." : "Independently verify one executor-role report against the approved brief.",
    executionModel: "plugin-registered-agent",
    hostedMcpUsed: false,
    targetSubagent: {
      type: wanted,
      scopedRole,
      background: true,
      modelHint,
      effortHint,
      contextHint: configuredRole.context,
      maxTurnsHint: Number(frontmatter.maxTurns || 0) || undefined
    },
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
      `Spawn a subagent in the plugin-provided ${scopedRole} role with the full brief, run id, scope, stop criteria and evidence contract.`,
      "Manager is not the role-runtime. If the role primitive is unavailable, stop and surface the missing primitive.",
      "Keep Nogra bookkeeping in Manager. The spawned role-runtime receives the brief, scope and evidence contract and returns a report.",
      "If runtimePolicy is custom and the client supports per-invocation model/effort overrides, request the configured model and effort; otherwise rely on the release default resolved by the local runtime and report the limitation plainly.",
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
    console.log(`- Control plane: ${payload.hostedMcpUsed ? "connected" : "local"}`);
    for (const warning of payload.plugin.diagnostics?.warnings || []) {
      console.log(`- Warning: ${warning.message}`);
    }
    console.log(`- Recent briefs: ${payload.recent.briefs.length}`);
    console.log(`- Recent transport runs: ${payload.recent.transportRuns.length}`);
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
  const root = workspaceRoot(options);
  let payload;
  if (command === "status") {
    payload = statusPayload(root);
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
  } else if (command === "brief-contract") {
    payload = briefContract(root);
  } else if (command === "brief-validate") {
    payload = validateBriefPayload(root, readInput(options));
  } else if (command === "brief-save") {
    payload = saveBrief(root, readInput(options), options.source || "");
  } else if (command === "brief-promote") {
    payload = promoteBrief(root, {
      briefId: options["brief-id"] || "",
      inputPayload: options.input ? readInput(options) : null
    });
  } else if (command === "handoff-contract") {
    payload = handoffContract(root, options.kind || "executor");
  } else if (command === "dispatch") {
    payload = dispatch(root, {
      briefId: options["brief-id"] || "",
      inputPayload: options.input ? readInput(options) : null,
      target: options.target || "executor",
      targetModel: options["target-model"] || options.targetModel || ""
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

try {
  process.exitCode = main();
} catch (error) {
  console.error(`nogra-local: ${error.message}`);
  process.exitCode = 1;
}
