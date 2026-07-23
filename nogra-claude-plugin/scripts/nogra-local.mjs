#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { activeIntentPath, readActiveIntent } from "../runtime/local/active-intent.mjs";
import {
  ANCHOR_SCHEMA_V1,
  APPROVAL_SCHEMA_V1,
  BRIEF_SCHEMA_V1,
  DISPATCH_RECEIPT_SCHEMA_V2,
  EVIDENCE_SCHEMA_V1,
  FACT_SCHEMA_V1,
  ROLE_LEASE_SCHEMA_V1,
  ROLE_REPORT_SCHEMA_V1,
  RUN_EVENT_SCHEMA_V2,
  RUN_SCHEMA_V2,
  VERDICT_SCHEMA_V1,
  approvalPath,
  approvalActionHash,
  anchorContentHash,
  assertAnchorSemantics,
  assertApprovalSemantics,
  assertContract,
  assertRunEventSemantics,
  assertRunSemantics,
  assertRunTransition,
  assertRoleLeaseSemantics,
  assertRoleReportSemantics,
  assertVerdictSemantics,
  briefAuthorityHash,
  canonicalJson,
  canonicalRunPath,
  compatibilityRunStatus,
  listRunRecords,
  readJsonIfValid as readContractJsonIfValid,
  readRunRecord,
  roleReportContentHash,
  safeAnchorId,
  runIdForApproval,
  safeApprovalId,
  safeRunId as safeCanonicalRunId,
  validateContract
} from "../runtime/local/contract-spine.mjs";
import {
  ROLE_TOOL_POLICY,
  activeRoleLeasePath,
  matchesRoleScope,
  normalizeRole,
  normalizeScopePatterns,
  readActiveRoleLease,
  roleLeaseReceiptPath,
  roleLeaseStatus,
  roleReportReceiptPath,
  writeRoleLease
} from "../runtime/local/role-isolation.mjs";
import {
  factStatus,
  readEvidenceRecord,
  readFactRecords,
  recordFact,
  saveEvidenceRecord
} from "../runtime/local/fact-store.mjs";
import { analyzeTranscriptDiagnostic, writeTranscriptDiagnosticReceipt } from "../runtime/local/transcript-diagnostic.mjs";

const NODE_MAJOR = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isFinite(NODE_MAJOR) || NODE_MAJOR < 18) {
  console.error(`nogra-local: Node.js 18+ is required (found ${process.versions.node}). Upgrade Node and re-run; no files were written.`);
  process.exit(1);
}

const BRIEF_SCHEMA = BRIEF_SCHEMA_V1;
const INIT_BUNDLE_SCHEMA = "nogra.init.bundle.v1";
const WORKSPACE_CONFIG_RELEASE_VERSION = "v1.0.0";
const TRANSPORT_STATUSES = new Set(["queued", "running", "returning", "returned", "ok", "partial", "blocked", "failed", "cancelled", "acknowledged"]);
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
    "  node scripts/nogra-local.mjs approval-create [--root <dir>] --brief-id <id> [--approved-by <label>] [--expires-at <date-time>] [--json]",
    "  node scripts/nogra-local.mjs anchor-contract [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs anchor-validate [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs anchor-save [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs evidence-contract [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs evidence-save [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs fact-contract [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs fact-record [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs fact-status [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs ledger-smoke [--root <dir>] [--label <text>] [--json]",
    "  node scripts/nogra-local.mjs transcript-diagnostic [--root <dir>] [--transcript <file>] [--write] [--json]",
    "  node scripts/nogra-local.mjs handoff-contract [--root <dir>] --kind executor|verifier [--run-id <id>] [--json]",
    "  node scripts/nogra-local.mjs role-enter [--root <dir>] --run-id <id> --role executor|verifier [--expires-in-minutes <n>] [--json]",
    "  node scripts/nogra-local.mjs role-status [--root <dir>] [--json]",
    "  node scripts/nogra-local.mjs role-exit [--root <dir>] --lease-id <id> [--reason <text>] [--json]",
    "  node scripts/nogra-local.mjs role-report-contract [--root <dir>] --kind executor|verifier [--run-id <id>] [--lease-id <id>] [--json]",
    "  node scripts/nogra-local.mjs role-report-save [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-local.mjs dispatch [--root <dir>] --brief-id <id> --approval-id <id> [--target executor] [--target-model <model>] [--max-turns <n>] [--scratch-root <dir>]... [--json]",
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
      "local_anchor_contract",
      "local_anchor_validate",
      "local_anchor_save",
      "local_transcript_diagnostic",
      "local_dispatch",
      "local_handoff_contract",
      "local_role_enter",
      "local_role_status",
      "local_role_exit",
      "local_role_report_contract",
      "local_role_report_save",
      "local_verify_support"
    ],
    resources: [
      "plugin://nogra/contracts/schemas/brief-v1.schema.json",
      "plugin://nogra/contracts/schemas/anchor-v1.schema.json",
      "plugin://nogra/contracts/schemas/role-lease-v1.schema.json",
      "plugin://nogra/contracts/schemas/role-report-v1.schema.json",
      "plugin://nogra/contracts/schemas/boot-context-v2.schema.json",
      "plugin://nogra/contracts/schemas/memory-resolution-v1.schema.json",
      "plugin://nogra/contracts/schemas/transcript-diagnostic-v1.schema.json",
      "plugin://nogra/contracts/templates/brief-v1.md",
      "plugin://nogra/contracts/templates/anchor-v1.json",
      "plugin://nogra/contracts/templates/boot-context-v2.json",
      "plugin://nogra/contracts/templates/memory-resolution-v1.json",
      "plugin://nogra/contracts/templates/transcript-diagnostic-v1.json",
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
        timeout: options.timeoutMs || 1200,
        maxBuffer: options.maxBuffer || 16 * 1024 * 1024
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

const ANCHOR_GIT_PATHSPECS = [
  ".",
  ":(exclude).nogra/checkpoints/anchor-*.json",
  ":(exclude).nogra/ledger/events.jsonl",
  ":(exclude).nogra/state/CURRENT-ANCHOR.json",
  ":(exclude).nogra/state/SESSION-CHECKPOINT.md",
  ":(exclude).nogra/runtime/anchor-save.lock"
];

function untrackedAnchorDigests(root) {
  const listing = readOnlyCommand(
    ["git", "--no-optional-locks", "-C", root, "ls-files", "--others", "--exclude-standard", "-z", "--", ...ANCHOR_GIT_PATHSPECS],
    { env: { GIT_OPTIONAL_LOCKS: "0" }, timeoutMs: 5000, maxBuffer: 64 * 1024 * 1024 }
  );
  if (listing.status !== "ok") return { status: "unknown", value: "" };
  const rootReal = fs.realpathSync(root);
  const records = [];
  for (const relative of listing.output.split("\0").filter(Boolean).sort()) {
    const file = path.resolve(rootReal, relative);
    if (file !== rootReal && !file.startsWith(`${rootReal}${path.sep}`)) {
      records.push(`${relative}\0outside-root`);
      continue;
    }
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        records.push(`${relative}\0symlink\0${fs.readlinkSync(file)}`);
      } else if (stat.isFile()) {
        const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        records.push(`${relative}\0file\0${stat.size}\0${digest}`);
      } else {
        records.push(`${relative}\0${stat.isDirectory() ? "directory" : "other"}`);
      }
    } catch {
      records.push(`${relative}\0unreadable`);
    }
  }
  return { status: "ok", value: records.join("\n") };
}

function gitAnchorSnapshot(root) {
  const source = "git read-only anchor snapshot (porcelain v2 + tracked diffs + untracked content digests; Nogra anchor records/projections and ledger events excluded)";
  const gitEnv = { GIT_OPTIONAL_LOCKS: "0" };
  const status = readOnlyCommand(
    ["git", "--no-optional-locks", "-C", root, "status", "--porcelain=v2", "--branch", "--", ...ANCHOR_GIT_PATHSPECS],
    { env: gitEnv, timeoutMs: 5000, maxBuffer: 64 * 1024 * 1024 }
  );
  if (status.status !== "ok") {
    return {
      status: "unknown",
      commit: null,
      branch: "",
      dirtyCount: null,
      dirtyFingerprint: null,
      fingerprintBasis: "",
      source
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
  const commit = /^[a-f0-9]{7,64}$/u.test(metadata.oid || "") ? metadata.oid : null;
  const branch = metadata.upstream ? `${metadata.head || ""}...${metadata.upstream}` : metadata.head || "";
  if (dirtyCount === 0) {
    return {
      status: "clean",
      commit,
      branch: cleanInline(branch),
      dirtyCount: 0,
      dirtyFingerprint: null,
      fingerprintBasis: "",
      source
    };
  }

  const workingDiff = readOnlyCommand(
    ["git", "--no-optional-locks", "-C", root, "diff", "--no-ext-diff", "--binary", "--", ...ANCHOR_GIT_PATHSPECS],
    { env: gitEnv, timeoutMs: 10000, maxBuffer: 64 * 1024 * 1024 }
  );
  const stagedDiff = readOnlyCommand(
    ["git", "--no-optional-locks", "-C", root, "diff", "--cached", "--no-ext-diff", "--binary", "--", ...ANCHOR_GIT_PATHSPECS],
    { env: gitEnv, timeoutMs: 10000, maxBuffer: 64 * 1024 * 1024 }
  );
  const untracked = untrackedAnchorDigests(root);
  const components = [
    ["status", status.output],
    ...(workingDiff.status === "ok" ? [["working-diff", workingDiff.output]] : []),
    ...(stagedDiff.status === "ok" ? [["staged-diff", stagedDiff.output]] : []),
    ...(untracked.status === "ok" ? [["untracked-content", untracked.value]] : [])
  ];
  const fingerprintMaterial = components.map(([name, value]) => `${name}\0${value}`).join("\0");
  return {
    status: "dirty",
    commit,
    branch: cleanInline(branch),
    dirtyCount,
    dirtyFingerprint: `sha256:${crypto.createHash("sha256").update(fingerprintMaterial).digest("hex")}`,
    fingerprintBasis: components.map(([name]) => name).join("+"),
    source
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
  const anchor = anchorFreshness(root, config);
  let facts = { freshness: "missing", projection: { sourceWatermark: 0, counts: { active: 0, superseded: 0, total: 0 } } };
  if (mode.initialized) {
    try {
      facts = factStatus(root);
    } catch (error) {
      facts = { freshness: "invalid", error: error.message, projection: { sourceWatermark: 0, counts: { active: 0, superseded: 0, total: 0 } } };
    }
  }
  const index = indexReadiness(root, config);
  const git = gitProjection(root);
  const bridge = bridgeProjection(root);
  const promotion = promotionProjection(root, config, bridge, git);
  let roleIsolation = {
    schema: ROLE_LEASE_SCHEMA_V1,
    status: "none",
    owner: "Manager",
    nextOwner: "Manager"
  };
  if (mode.initialized) {
    try {
      roleIsolation = roleLeaseStatus(root);
    } catch (error) {
      roleIsolation = {
        schema: ROLE_LEASE_SCHEMA_V1,
        status: "invalid",
        effectiveStatus: "invalid",
        error: error.message,
        owner: "Manager",
        nextOwner: "Manager"
      };
    }
  }
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
      checkpointStatus: checkpoint.status,
      anchorSourceWatermark: anchor.sourceWatermark,
      anchorStatus: anchor.status,
      currentAnchorId: anchor.anchorId,
      currentAnchorHash: anchor.contentHash,
      factProjectionStatus: facts.freshness,
      factSourceWatermark: facts.projection.sourceWatermark,
      activeFacts: facts.projection.counts.active,
      supersededFacts: facts.projection.counts.superseded,
      factError: facts.error || ""
    },
    git,
    bridge,
    promotion,
    roleIsolation,
    index,
    continuity: continuityState(root, config, anchor),
    recent: {
      briefs,
      runs,
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
    schema: "nogra.boot_policy.v2",
    mode: "workspace-hub",
    stateMachine: ["fresh", "detected", "focused", "resumed", "recovering"],
    checkpointSemantics: "detection-only",
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
          ".nogra/state/SESSION-CHECKPOINT.md"
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
      currentAnchor: ".nogra/state/CURRENT-ANCHOR.json",
      currentCheckpoint: ".nogra/state/SESSION-CHECKPOINT.md",
      currentTasks: ".nogra/state/CURRENT-TASKS.md",
      decisions: ".nogra/state/DECISIONS.md",
      projectStructure: ".nogra/state/PROJECT-STRUCTURE.md",
      workspaceIndex: ".nogra/index/workspaces.jsonl"
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
  const targetRuntime = runtimeRoleForTarget(runtimePolicyState(config), targetRole);
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
    targetModel: cleanInline(input.targetModel || input.target_model || existing.targetModel || targetRuntime.model || defaultTargetModel(config)),
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
  const validation = validateContract(BRIEF_SCHEMA, brief);
  return validation.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
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

function readBriefDraft(root, briefId) {
  const file = draftPath(root, briefId);
  if (!fs.existsSync(file)) {
    throw new Error(`no brief with id ${safeBriefId(briefId)} under .nogra/briefs/drafts/ — save or promote one first (/nogra:brief)`);
  }
  return readJson(file);
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
    input = readBriefDraft(root, options.briefId);
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
  return listRunRecords(root)
    .map((payload) => ({
      runId: payload.runId || "",
      schema: payload.schema || "",
      lifecycle: payload.lifecycle || "",
      outcome: payload.outcome ?? null,
      verdict: payload.verdict ?? null,
      status: compatibilityRunStatus(payload),
      phase: payload.legacy ? payload.phase || payload.lifecycle || "" : payload.lifecycle || "",
      legacy: Boolean(payload.legacy),
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
      updatedAt: payload.updatedAt || "",
      path: payload.sourcePath ? localPath(root, payload.sourcePath) : ""
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit);
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

function currentLedgerWatermark(root) {
  return nonEmptyLineCount(ledgerEventsPath(root));
}

function readLedgerEvents(root) {
  const file = ledgerEventsPath(root);
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

function findRunEvent(root, runId, eventType) {
  return readLedgerEvents(root).find((event) =>
    event.schema === RUN_EVENT_SCHEMA_V2 &&
    event.runId === runId &&
    event.eventType === eventType
  ) || null;
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
  return resolveWorkspacePath(root, configured || ".nogra/state/SESSION-CHECKPOINT.md").target;
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

function currentAnchorPath(root, config = {}) {
  const configured = cleanInline(config?.paths?.currentAnchor);
  return resolveWorkspacePath(root, configured || ".nogra/state/CURRENT-ANCHOR.json").target;
}

function anchorsDir(root, config = {}) {
  const configured = cleanInline(config?.paths?.checkpoints);
  return resolveWorkspacePath(root, configured || ".nogra/checkpoints").target;
}

function anchorRecordPath(root, anchorId, config = {}) {
  return path.join(anchorsDir(root, config), `${safeAnchorId(anchorId)}.json`);
}

function readAnchorFile(file) {
  if (!fs.existsSync(file)) return null;
  const anchor = readJson(file);
  assertAnchorSemantics(anchor);
  return anchor;
}

function readCurrentAnchor(root, config = {}) {
  return readAnchorFile(currentAnchorPath(root, config));
}

function anchorSourceWatermark(root, config = {}) {
  try {
    const anchor = readCurrentAnchor(root, config);
    if (anchor) return anchor.sourceWatermark;
  } catch {
    return 0;
  }
  return checkpointSourceWatermark(root, config);
}

function semanticRecordId(prefix, value) {
  const digest = crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
  return `${prefix}-${digest}`;
}

function uniqueCleanStrings(value) {
  return [...new Set(asStringArray(value))];
}

function anchorClaim(value, bucket) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${bucket} entries must be structured objects`);
  }
  const claim = cleanText(value.claim);
  if (!claim) throw new Error(`${bucket} claim is required`);
  const factId = cleanInline(value.factId);
  if (!/^fact-[a-f0-9]{20}$/u.test(factId)) {
    throw new Error(`${bucket} claim requires a canonical factId`);
  }
  const evidenceRefs = uniqueCleanStrings(value.evidenceRefs);
  const provenance = value.provenance && typeof value.provenance === "object" && !Array.isArray(value.provenance)
    ? value.provenance
    : {};
  const sourceType = cleanInline(provenance.sourceType);
  const sourceRef = cleanInline(provenance.sourceRef);
  if (!sourceType || !sourceRef) {
    throw new Error(`${bucket} claim requires provenance.sourceType and provenance.sourceRef`);
  }
  if (bucket === "verifiedDone") {
    const observedAt = cleanInline(value.observedAt);
    if (!observedAt) throw new Error("verifiedDone claim requires observedAt");
    if (!evidenceRefs.length) throw new Error("verifiedDone claim requires at least one evidenceRef");
    return {
      claimId: cleanInline(value.claimId) || semanticRecordId("claim", { bucket, claim, sourceType, sourceRef }),
      factId,
      claim,
      observedAt,
      evidenceRefs,
      provenance: {
        evidenceLevel: cleanInline(provenance.evidenceLevel),
        sourceType,
        sourceRef
      }
    };
  }
  const claimedAt = cleanInline(value.claimedAt);
  const claimedBy = cleanInline(value.claimedBy);
  if (!claimedAt || !claimedBy) throw new Error("claimedDone claim requires claimedAt and claimedBy");
  return {
    claimId: cleanInline(value.claimId) || semanticRecordId("claim", { bucket, claim, sourceType, sourceRef, claimedBy }),
    factId,
    claim,
    claimedAt,
    claimedBy,
    evidenceRefs,
    provenance: {
      evidenceLevel: cleanInline(provenance.evidenceLevel),
      sourceType,
      sourceRef
    }
  };
}

function anchorUnknown(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("unknown entries must be structured objects");
  }
  const subject = cleanText(value.subject);
  const reason = cleanText(value.reason);
  const sourceRef = cleanInline(value.sourceRef);
  if (!subject || !reason || !sourceRef) {
    throw new Error("unknown entry requires subject, reason and sourceRef");
  }
  return {
    itemId: cleanInline(value.itemId) || semanticRecordId("unknown", { subject, reason, sourceRef }),
    subject,
    reason,
    nextCheck: cleanText(value.nextCheck),
    sourceRef
  };
}

function anchorDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("decision entries must be structured objects");
  }
  const decision = cleanText(value.decision);
  const owner = cleanInline(value.owner);
  const sourceRef = cleanInline(value.sourceRef);
  if (!decision || !owner || !sourceRef) {
    throw new Error("decision entry requires decision, owner and sourceRef");
  }
  return {
    decisionId: cleanInline(value.decisionId) || semanticRecordId("decision", { decision, owner, sourceRef }),
    decision,
    owner,
    sourceRef
  };
}

function anchorBlocker(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("blocker entries must be structured objects");
  }
  const blocker = cleanText(value.blocker);
  const owner = cleanInline(value.owner);
  const sourceRef = cleanInline(value.sourceRef);
  if (!blocker || !owner || !sourceRef) {
    throw new Error("blocker entry requires blocker, owner and sourceRef");
  }
  return {
    blockerId: cleanInline(value.blockerId) || semanticRecordId("blocker", { blocker, owner, sourceRef }),
    blocker,
    owner,
    sourceRef
  };
}

function anchorAuthority(root, input, config) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const mode = cleanInline(raw.mode);
  if (!["approved", "direct", "observation"].includes(mode)) {
    throw new Error("anchor authority.mode must be approved, direct or observation");
  }
  if (mode === "approved") {
    const briefId = safeBriefId(raw.briefId);
    const approvalId = safeApprovalId(raw.approvalId);
    const brief = readBriefDraft(root, briefId);
    assertContract(BRIEF_SCHEMA_V1, brief);
    if (brief.status !== "ready") {
      throw new Error(`approved anchor authority requires a ready brief (found ${brief.status || "unknown"})`);
    }
    const approval = readJson(approvalPath(root, approvalId));
    assertApprovalSemantics(approval);
    if (!["available", "consumed"].includes(approval.status)) {
      throw new Error(`approved anchor authority cannot use approval status ${approval.status}`);
    }
    const briefHash = briefAuthorityHash(brief);
    const actionHash = approvalActionHash(brief);
    if (
      approval.workspaceId !== workspaceId(config) ||
      approval.briefId !== briefId ||
      approval.briefHash !== briefHash ||
      approval.actionHash !== actionHash
    ) {
      throw new Error("approved anchor authority does not match the current brief/approval contract");
    }
    if (cleanText(raw.objective) && cleanText(raw.objective) !== cleanText(brief.intent)) {
      throw new Error("approved anchor objective must come from the bound brief");
    }
    return {
      mode,
      objective: cleanText(brief.intent),
      scope: {
        in: uniqueCleanStrings(brief.scope?.in),
        out: uniqueCleanStrings(brief.scope?.out)
      },
      briefId,
      briefHash,
      approvalId,
      approvalActionHash: actionHash
    };
  }
  if (raw.briefId || raw.briefHash || raw.approvalId || raw.approvalActionHash) {
    throw new Error(`${mode} anchor authority cannot carry brief or approval bindings`);
  }
  const objective = cleanText(raw.objective);
  if (!objective) throw new Error(`${mode} anchor authority requires an objective`);
  const scope = raw.scope && typeof raw.scope === "object" && !Array.isArray(raw.scope) ? raw.scope : {};
  return {
    mode,
    objective,
    scope: {
      in: uniqueCleanStrings(scope.in),
      out: uniqueCleanStrings(scope.out)
    },
    briefId: null,
    briefHash: null,
    approvalId: null,
    approvalActionHash: null
  };
}

function anchorReferences(input, authority, completion) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const claimEvidence = [
    ...completion.verifiedDone.flatMap((item) => item.evidenceRefs),
    ...completion.claimedDone.flatMap((item) => item.evidenceRefs)
  ];
  const claimFacts = [
    ...completion.verifiedDone.map((item) => item.factId),
    ...completion.claimedDone.map((item) => item.factId)
  ];
  return {
    briefIds: uniqueCleanStrings([...asStringArray(raw.briefIds), ...(authority.briefId ? [authority.briefId] : [])]),
    approvalIds: uniqueCleanStrings([...asStringArray(raw.approvalIds), ...(authority.approvalId ? [authority.approvalId] : [])]),
    runIds: uniqueCleanStrings(raw.runIds),
    factIds: uniqueCleanStrings([...asStringArray(raw.factIds), ...claimFacts]),
    evidenceRefs: uniqueCleanStrings([...asStringArray(raw.evidenceRefs), ...claimEvidence]),
    verdictIds: uniqueCleanStrings(raw.verdictIds)
  };
}

function anchorEvidenceFile(root, value) {
  const normalized = safeRelativePath(value);
  if (!normalized.startsWith(".nogra/")) {
    throw new Error(`anchor evidenceRef must be a workspace-local .nogra/ path: ${normalized}`);
  }
  const { target } = resolveWorkspacePath(root, normalized);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`anchor evidenceRef does not resolve to a local file: ${normalized}`);
  }
  const nograReal = fs.realpathSync(nograDir(root));
  const targetReal = fs.realpathSync(target);
  if (targetReal !== nograReal && !targetReal.startsWith(`${nograReal}${path.sep}`)) {
    throw new Error(`anchor evidenceRef resolves outside the workspace-local .nogra/ trust domain: ${normalized}`);
  }
  return normalized;
}

function assertAnchorReferenceIntegrity(root, anchor) {
  const expectedWorkspace = anchor.workspaceId;
  for (const briefId of anchor.references.briefIds) {
    const brief = readBriefDraft(root, safeBriefId(briefId));
    assertContract(BRIEF_SCHEMA_V1, brief);
    if (brief.workspaceId !== expectedWorkspace) {
      throw new Error(`anchor brief reference belongs to another workspace: ${briefId}`);
    }
  }
  for (const approvalId of anchor.references.approvalIds) {
    const approval = readJson(approvalPath(root, safeApprovalId(approvalId)));
    assertApprovalSemantics(approval);
    if (approval.workspaceId !== expectedWorkspace) {
      throw new Error(`anchor approval reference belongs to another workspace: ${approvalId}`);
    }
  }
  for (const runId of anchor.references.runIds) {
    const run = readRunRecord(root, runId);
    if (!run) throw new Error(`anchor run reference does not exist: ${runId}`);
    if (run.workspaceId && run.workspaceId !== expectedWorkspace) {
      throw new Error(`anchor run reference belongs to another workspace: ${runId}`);
    }
    if (!run.legacy) assertRunSemantics(readJson(run.sourcePath));
  }
  for (const evidenceRef of anchor.references.evidenceRefs) {
    anchorEvidenceFile(root, evidenceRef);
  }
  const facts = readFactRecords(root);
  const supersededFactIds = new Set(facts.map((fact) => fact.supersedes).filter(Boolean));
  const factsById = new Map(facts.map((fact) => [fact.factId, fact]));
  for (const factId of anchor.references.factIds) {
    const fact = factsById.get(factId);
    if (!fact) throw new Error(`anchor fact reference does not exist: ${factId}`);
    if (fact.workspaceId !== expectedWorkspace) throw new Error(`anchor fact reference belongs to another workspace: ${factId}`);
    if (supersededFactIds.has(factId)) throw new Error(`anchor fact reference is superseded: ${factId}`);
  }
  for (const claim of anchor.completion.verifiedDone) {
    const fact = factsById.get(claim.factId);
    if (!fact || fact.evidenceLevel !== "verified") {
      throw new Error(`anchor verifiedDone requires an active verified fact: ${claim.factId}`);
    }
    if (cleanText(fact.claim) !== cleanText(claim.claim)) {
      throw new Error(`anchor verifiedDone claim differs from canonical fact ${claim.factId}`);
    }
  }
  for (const claim of anchor.completion.claimedDone) {
    const fact = factsById.get(claim.factId);
    if (!fact || fact.evidenceLevel === "verified") {
      throw new Error(`anchor claimedDone requires an active non-verified fact: ${claim.factId}`);
    }
    if (cleanText(fact.claim) !== cleanText(claim.claim)) {
      throw new Error(`anchor claimedDone claim differs from canonical fact ${claim.factId}`);
    }
  }
  for (const verdictId of anchor.references.verdictIds) {
    const safeVerdictId = cleanInline(verdictId);
    if (!/^verdict-[A-Za-z0-9_.-]+$/u.test(safeVerdictId)) {
      throw new Error(`invalid verdict id: ${safeVerdictId || "(empty)"}`);
    }
    const file = path.join(nograDir(root), "receipts", "verdicts", `${safeVerdictId}.json`);
    const verdict = readJson(file);
    assertVerdictSemantics(verdict);
    if (verdict.workspaceId !== expectedWorkspace) {
      throw new Error(`anchor verdict reference belongs to another workspace: ${safeVerdictId}`);
    }
  }
  return anchor;
}

function buildAnchorCandidate(root, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("anchor input must be a structured JSON object");
  }
  const config = readWorkspaceConfig(root);
  if (!config || config.__invalid) {
    throw new Error(config?.error ? `invalid .nogra/config.json: ${config.error}` : "anchor requires an initialized Nogra workspace");
  }
  const authority = anchorAuthority(root, input.authority, config);
  const completionInput = input.completion && typeof input.completion === "object" && !Array.isArray(input.completion)
    ? input.completion
    : {};
  const completion = {
    verifiedDone: (Array.isArray(completionInput.verifiedDone) ? completionInput.verifiedDone : []).map((item) => anchorClaim(item, "verifiedDone")),
    claimedDone: (Array.isArray(completionInput.claimedDone) ? completionInput.claimedDone : []).map((item) => anchorClaim(item, "claimedDone")),
    unknown: (Array.isArray(completionInput.unknown) ? completionInput.unknown : []).map(anchorUnknown)
  };
  const references = anchorReferences(input.references, authority, completion);
  const session = readSessionAnchor(root);
  const nativeInput = input.native && typeof input.native === "object" && !Array.isArray(input.native) ? input.native : {};
  if (cleanInline(nativeInput.checkpointRef)) {
    throw new Error("Claude Code hooks do not expose a native rewind checkpoint id; native.checkpointRef must remain null");
  }
  const metadataInput = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {};
  const candidate = {
    schema: ANCHOR_SCHEMA_V1,
    workspaceId: workspaceId(config),
    authority,
    completion,
    decisions: (Array.isArray(input.decisions) ? input.decisions : []).map(anchorDecision),
    blockers: (Array.isArray(input.blockers) ? input.blockers : []).map(anchorBlocker),
    nextOwner: cleanInline(input.nextOwner) || "Manager",
    git: gitAnchorSnapshot(root),
    references,
    native: {
      platform: "claude_code",
      sessionId: session.sessionId,
      transcriptId: session.transcriptId,
      checkpointRef: null
    },
    redactions: uniqueCleanStrings(input.redactions),
    metadata: {
      ...metadataInput,
      projection: ".nogra/state/SESSION-CHECKPOINT.md",
      currentRecord: ".nogra/state/CURRENT-ANCHOR.json",
      immutableLane: ".nogra/checkpoints",
      nativeCheckpointRefSource: "not_exposed_by_claude_hooks"
    }
  };
  candidate.contentHash = anchorContentHash(candidate);
  return { config, candidate };
}

function materializeAnchor(candidate, values) {
  const anchor = {
    schema: ANCHOR_SCHEMA_V1,
    anchorId: values.anchorId,
    workspaceId: candidate.workspaceId,
    createdAt: values.createdAt,
    updatedAt: values.createdAt,
    sourceWatermark: values.sourceWatermark,
    contentHash: candidate.contentHash,
    supersedes: values.supersedes,
    authority: candidate.authority,
    completion: candidate.completion,
    decisions: candidate.decisions,
    blockers: candidate.blockers,
    nextOwner: candidate.nextOwner,
    git: candidate.git,
    references: candidate.references,
    native: candidate.native,
    redactions: candidate.redactions,
    metadata: candidate.metadata
  };
  assertAnchorSemantics(anchor);
  return anchor;
}

function anchorMarkdownLine(value) {
  return cleanText(value).replace(/\s+/gu, " ").trim();
}

function anchorMarkdownList(items, render, empty = "None recorded.") {
  return items.length ? items.map((item) => `- ${render(item)}`).join("\n") : `- ${empty}`;
}

function renderAnchorMarkdown(anchor) {
  assertAnchorSemantics(anchor);
  const completion = anchor.completion;
  const refs = anchor.references;
  return [
    "# Nogra Anchor",
    "",
    `Workspace: ${anchor.workspaceId}`,
    `AnchorId: ${anchor.anchorId}`,
    `Created: ${anchor.createdAt}`,
    `Updated: ${anchor.updatedAt}`,
    `SourceWatermark: ${anchor.sourceWatermark}`,
    `ContentHash: ${anchor.contentHash}`,
    `Supersedes: ${anchor.supersedes || "none"}`,
    "",
    "## Current State",
    "",
    `This anchor records ${completion.verifiedDone.length} verified, ${completion.claimedDone.length} claimed, and ${completion.unknown.length} unknown completion statements with ${anchor.blockers.length} blockers.`,
    "",
    "## Objective",
    "",
    anchorMarkdownLine(anchor.authority.objective),
    "",
    `Authority: ${anchor.authority.mode}`,
    "",
    "## Scope In",
    "",
    anchorMarkdownList(anchor.authority.scope.in, anchorMarkdownLine),
    "",
    "## Scope Out",
    "",
    anchorMarkdownList(anchor.authority.scope.out, anchorMarkdownLine),
    "",
    "## Verified Done",
    "",
    anchorMarkdownList(
      completion.verifiedDone,
      (item) => `${anchorMarkdownLine(item.claim)} — evidence: ${item.evidenceRefs.map(anchorMarkdownLine).join(", ")}`
    ),
    "",
    "## Claimed Done",
    "",
    anchorMarkdownList(
      completion.claimedDone,
      (item) => `${anchorMarkdownLine(item.claim)} — claimed by ${anchorMarkdownLine(item.claimedBy)}; level: ${item.provenance.evidenceLevel}`
    ),
    "",
    "## Unknown",
    "",
    anchorMarkdownList(
      completion.unknown,
      (item) => `${anchorMarkdownLine(item.subject)} — ${anchorMarkdownLine(item.reason)}${item.nextCheck ? ` Next check: ${anchorMarkdownLine(item.nextCheck)}` : ""}`
    ),
    "",
    "## Decisions",
    "",
    anchorMarkdownList(anchor.decisions, (item) => `${anchorMarkdownLine(item.decision)} — owner: ${anchorMarkdownLine(item.owner)}; source: ${anchorMarkdownLine(item.sourceRef)}`),
    "",
    "## Blockers",
    "",
    anchorMarkdownList(anchor.blockers, (item) => `${anchorMarkdownLine(item.blocker)} — owner: ${anchorMarkdownLine(item.owner)}; source: ${anchorMarkdownLine(item.sourceRef)}`),
    "",
    "## Git",
    "",
    `- Status: ${anchor.git.status}`,
    `- Commit: ${anchor.git.commit || "unknown"}`,
    `- Branch: ${anchor.git.branch || "unknown"}`,
    `- Dirty count: ${anchor.git.dirtyCount == null ? "unknown" : anchor.git.dirtyCount}`,
    `- Dirty fingerprint: ${anchor.git.dirtyFingerprint || "none"}`,
    `- Fingerprint basis: ${anchor.git.fingerprintBasis || "none"}`,
    "",
    "## References",
    "",
    `- Briefs: ${refs.briefIds.join(", ") || "none"}`,
    `- Approvals: ${refs.approvalIds.join(", ") || "none"}`,
    `- Runs: ${refs.runIds.join(", ") || "none"}`,
    `- Facts: ${refs.factIds.join(", ") || "none"}`,
    `- Evidence: ${refs.evidenceRefs.join(", ") || "none"}`,
    `- Verdicts: ${refs.verdictIds.join(", ") || "none"}`,
    "",
    "## Native Continuity",
    "",
    `- Platform: ${anchor.native.platform}`,
    `- Session: ${anchor.native.sessionId || "not recorded"}`,
    `- Transcript: ${anchor.native.transcriptId || "not recorded"}`,
    `- Native checkpoint: ${anchor.native.checkpointRef || "not exposed"}`,
    "",
    "## Next",
    "",
    `Next owner: ${anchorMarkdownLine(anchor.nextOwner)}`,
    "",
    "This Markdown file is a human-readable projection. The schema-valid immutable JSON anchor and append-only ledger remain the factual continuity records.",
    ""
  ].join("\n");
}

function anchorEventFor(root, anchor) {
  return readLedgerEvents(root).find((event) =>
    event.type === "anchor_saved" &&
    event.anchorId === anchor.anchorId &&
    event.contentHash === anchor.contentHash &&
    event.ledgerWatermark === anchor.sourceWatermark
  ) || null;
}

function listImmutableAnchors(root, config = {}) {
  const dir = anchorsDir(root, config);
  if (!directoryExists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^anchor-[A-Za-z0-9_.-]+\.json$/u.test(name))
    .map((name) => {
      try {
        return readAnchorFile(path.join(dir, name));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.sourceWatermark - a.sourceWatermark || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function committedAnchorForCandidate(root, config, candidate, ledgerWatermark) {
  return listImmutableAnchors(root, config).find((anchor) =>
    anchor.contentHash === candidate.contentHash &&
    anchor.sourceWatermark === ledgerWatermark &&
    Boolean(anchorEventFor(root, anchor))
  ) || null;
}

function writeAnchorProjections(root, config, anchor) {
  writeJsonAtomic(currentAnchorPath(root, config), anchor);
  writeTextAtomic(checkpointPath(root, config), renderAnchorMarkdown(anchor));
}

function anchorSaveLockPath(root) {
  return path.join(nograDir(root), "runtime", "anchor-save.lock");
}

function withAnchorSaveLock(root, callback) {
  const file = anchorSaveLockPath(root);
  ensureDir(path.dirname(file));
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const acquire = () => {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, `${JSON.stringify({ token, pid: process.pid, createdAt: now() })}\n`, "utf8");
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const ageMs = Date.now() - fs.statSync(file).mtimeMs;
      if (ageMs <= 5 * 60 * 1000) {
        throw new Error("another anchor-save operation is active; retry after it finishes");
      }
      fs.unlinkSync(file);
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, `${JSON.stringify({ token, pid: process.pid, createdAt: now(), recoveredStaleLock: true })}\n`, "utf8");
      fs.closeSync(fd);
    }
  };
  acquire();
  try {
    return callback();
  } finally {
    try {
      const lock = readJson(file);
      if (lock.token === token) fs.unlinkSync(file);
    } catch {
      // A missing or foreign lock is never removed.
    }
  }
}

function anchorContract() {
  return {
    schema: "nogra.local.anchor_contract.v1",
    canonicalSchema: ANCHOR_SCHEMA_V1,
    schemaPath: "contracts/schemas/anchor-v1.schema.json",
    templatePath: "contracts/templates/anchor-v1.json",
    immutableRecords: ".nogra/checkpoints/anchor-<watermark>-<content-hash>.json",
    currentRecord: ".nogra/state/CURRENT-ANCHOR.json",
    projection: ".nogra/state/SESSION-CHECKPOINT.md",
    semantics: [
      "Anchor records continuity; it never grants GO or marks work ready.",
      "verifiedDone requires verified provenance and at least one existing workspace-local evidence file.",
      "claimedDone and unknown remain separate and cannot be upgraded by rendering or memory.",
      "Approved authority is derived from the bound brief and approval records.",
      "Fresh identical state is deduplicated; stale ledger or Git state creates a superseding anchor.",
      "Legacy Markdown checkpoints are preserved as projections and are never auto-upgraded into verified Anchor claims.",
      "Claude-native checkpoint references remain optional because documented hooks do not expose one."
    ],
    hostedMcpUsed: false
  };
}

function evidenceContract() {
  return {
    schema: "nogra.local.evidence_contract.v1",
    canonicalSchema: EVIDENCE_SCHEMA_V1,
    schemaPath: "contracts/schemas/evidence-v1.schema.json",
    templatePath: "contracts/templates/evidence-v1.json",
    immutableRecords: ".nogra/evidence/evidence-<content-hash>.json",
    semantics: [
      "Evidence is an immutable content-addressed observation receipt, not a completion verdict.",
      "Artifact digests are computed from existing workspace-local files; caller-supplied digests are not trusted.",
      "Tested evidence requires a command/test method and a content-addressed artifact.",
      "Verified evidence requires either an operator record or a canonical verdict-backed verification.",
      "Evidence save appends an idempotent evidence_recorded ledger event."
    ],
    hostedMcpUsed: false
  };
}

function factContract() {
  return {
    schema: "nogra.local.fact_contract.v1",
    canonicalSchema: FACT_SCHEMA_V1,
    schemaPath: "contracts/schemas/fact-v1.schema.json",
    templatePath: "contracts/templates/fact-v1.json",
    authority: ".nogra/ledger/events.jsonl",
    projection: ".nogra/state/CURRENT-FACTS.json",
    semantics: [
      "A stable subject has at most one active fact.",
      "Changing a subject requires explicit supersedes; wording is never fuzzy-matched.",
      "Evidence level cannot regress across a supersession chain.",
      "Verified facts require verified operator evidence or a canonical ship verdict.",
      "Memory and sync projections can create reported facts only and never upgrade truth.",
      "MEMORY.md, USER.md and CURRENT-FACTS.json are projections; the append-only ledger owns fact identity."
    ],
    hostedMcpUsed: false
  };
}

function validateAnchorPayload(root, input) {
  let normalized = null;
  try {
    const { candidate } = buildAnchorCandidate(root, input);
    const sourceWatermark = currentLedgerWatermark(root) + 1;
    const anchorId = `anchor-${String(sourceWatermark).padStart(6, "0")}-${candidate.contentHash.slice(7, 19)}`;
    normalized = materializeAnchor(candidate, {
      anchorId,
      createdAt: now(),
      sourceWatermark,
      supersedes: readCurrentAnchor(root, readWorkspaceConfig(root) || {})?.anchorId || null
    });
    assertAnchorReferenceIntegrity(root, normalized);
    return {
      schema: "nogra.local.anchor_validation.v1",
      status: "valid",
      valid: true,
      errors: [],
      normalized,
      contract: "plugin-bundled anchor-v1.schema.json",
      hostedMcpUsed: false
    };
  } catch (error) {
    return {
      schema: "nogra.local.anchor_validation.v1",
      status: "invalid",
      valid: false,
      errors: [error.message],
      normalized,
      contract: "plugin-bundled anchor-v1.schema.json",
      hostedMcpUsed: false
    };
  }
}

function saveAnchor(root, input) {
  return withAnchorSaveLock(root, () => {
    const { config, candidate } = buildAnchorCandidate(root, input);
    const currentWatermark = currentLedgerWatermark(root);
    let current = null;
    try {
      current = readCurrentAnchor(root, config);
    } catch (error) {
      throw new Error(`current anchor is invalid and will not be overwritten: ${error.message}`);
    }

    if (current && current.contentHash === candidate.contentHash && current.sourceWatermark === currentWatermark) {
      assertAnchorReferenceIntegrity(root, current);
      writeAnchorProjections(root, config, current);
      return {
        schema: "nogra.local.anchor_save.v1",
        status: "ok",
        idempotent: true,
        recovered: false,
        anchor: current,
        path: localPath(root, anchorRecordPath(root, current.anchorId, config)),
        currentPath: localPath(root, currentAnchorPath(root, config)),
        projectionPath: localPath(root, checkpointPath(root, config)),
        hostedMcpUsed: false
      };
    }

    const committed = committedAnchorForCandidate(root, config, candidate, currentWatermark);
    if (committed) {
      assertAnchorReferenceIntegrity(root, committed);
      writeAnchorProjections(root, config, committed);
      return {
        schema: "nogra.local.anchor_save.v1",
        status: "ok",
        idempotent: true,
        recovered: true,
        anchor: committed,
        path: localPath(root, anchorRecordPath(root, committed.anchorId, config)),
        currentPath: localPath(root, currentAnchorPath(root, config)),
        projectionPath: localPath(root, checkpointPath(root, config)),
        hostedMcpUsed: false
      };
    }

    const sourceWatermark = currentWatermark + 1;
    const anchorId = `anchor-${String(sourceWatermark).padStart(6, "0")}-${candidate.contentHash.slice(7, 19)}`;
    const createdAt = now();
    const anchor = materializeAnchor(candidate, {
      anchorId,
      createdAt,
      sourceWatermark,
      supersedes: current?.anchorId || null
    });
    assertAnchorReferenceIntegrity(root, anchor);
    const immutablePath = anchorRecordPath(root, anchorId, config);
    if (fs.existsSync(immutablePath)) {
      const existing = readAnchorFile(immutablePath);
      if (canonicalJson(existing) !== canonicalJson(anchor)) {
        throw new Error(`immutable anchor id collision: ${anchorId}`);
      }
    } else {
      writeJsonAtomic(immutablePath, anchor);
    }
    const event = appendLedgerEvent(root, "anchor_saved", {
      eventId: `ledger-${anchorId}`,
      anchorId,
      contentHash: anchor.contentHash,
      supersedes: anchor.supersedes,
      sourceWatermark,
      summary: `Anchor ${anchorId} saved with ${anchor.completion.verifiedDone.length} verified, ${anchor.completion.claimedDone.length} claimed and ${anchor.completion.unknown.length} unknown completion statements.`,
      nextOwner: anchor.nextOwner
    });
    if (event.ledgerWatermark !== sourceWatermark) {
      throw new Error(`anchor ledger watermark changed during save: expected ${sourceWatermark}, received ${event.ledgerWatermark}`);
    }
    writeAnchorProjections(root, config, anchor);
    return {
      schema: "nogra.local.anchor_save.v1",
      status: "ok",
      idempotent: false,
      recovered: false,
      anchor,
      ledgerEvent: event,
      path: localPath(root, immutablePath),
      currentPath: localPath(root, currentAnchorPath(root, config)),
      projectionPath: localPath(root, checkpointPath(root, config)),
      hostedMcpUsed: false
    };
  });
}

function checkpointFreshness(root, config = {}) {
  const ledgerWatermark = currentLedgerWatermark(root);
  const sourceWatermark = anchorSourceWatermark(root, config);
  return {
    ledgerWatermark,
    checkpointSourceWatermark: sourceWatermark,
    status: ledgerWatermark > sourceWatermark ? "stale" : "fresh"
  };
}

function anchorFreshness(root, config = {}) {
  const ledgerWatermark = currentLedgerWatermark(root);
  let anchor;
  try {
    anchor = readCurrentAnchor(root, config);
  } catch (error) {
    return {
      status: "invalid",
      reason: error.message,
      anchorId: "",
      contentHash: "",
      sourceWatermark: 0,
      ledgerWatermark
    };
  }
  if (!anchor) {
    return {
      status: "missing",
      reason: "No schema-valid current anchor exists.",
      anchorId: "",
      contentHash: "",
      sourceWatermark: checkpointSourceWatermark(root, config),
      ledgerWatermark
    };
  }
  if (ledgerWatermark > anchor.sourceWatermark) {
    return {
      status: "stale_ledger",
      reason: "The append-only ledger is ahead of the current anchor.",
      anchorId: anchor.anchorId,
      contentHash: anchor.contentHash,
      sourceWatermark: anchor.sourceWatermark,
      ledgerWatermark,
      supersedes: anchor.supersedes
    };
  }
  const git = gitAnchorSnapshot(root);
  const gitMatches =
    git.status === anchor.git.status &&
    git.commit === anchor.git.commit &&
    git.branch === anchor.git.branch &&
    git.dirtyCount === anchor.git.dirtyCount &&
    git.dirtyFingerprint === anchor.git.dirtyFingerprint;
  return {
    status: gitMatches ? "fresh" : "stale_git",
    reason: gitMatches ? "" : "Repository state no longer matches the current anchor fingerprint.",
    anchorId: anchor.anchorId,
    contentHash: anchor.contentHash,
    sourceWatermark: anchor.sourceWatermark,
    ledgerWatermark,
    supersedes: anchor.supersedes,
    gitMatches
  };
}

function continuityState(root, config = {}, anchorStatus = null) {
  const ledgerDir = path.join(nograDir(root), "ledger");
  const ledgerFile = ledgerEventsPath(root);
  const checkpointFile = checkpointPath(root, config);
  const anchorFile = sessionAnchorPath(root);
  const liveHooksFile = liveHooksJsonlPath(root);
  const liveHooksLog = liveHooksTextPath(root);
  const liveHooksLatest = liveHooksLatestPath(root);
  const checkpointHasWatermark = checkpointHasSourceWatermark(root, config);
  const ledgerDirExists = directoryExists(ledgerDir);
  const session = readSessionAnchor(root);
  const latestHook = readJsonIfValid(liveHooksLatest);
  const activeIntent = activeIntentState(root);
  const anchor = anchorStatus || anchorFreshness(root, config);
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
    anchor: {
      path: localPath(root, currentAnchorPath(root, config)),
      exists: fs.existsSync(currentAnchorPath(root, config)),
      status: anchor.status,
      reason: anchor.reason,
      anchorId: anchor.anchorId,
      contentHash: anchor.contentHash,
      sourceWatermark: anchor.sourceWatermark,
      ledgerWatermark: anchor.ledgerWatermark,
      supersedes: anchor.supersedes || null,
      gitMatches: anchor.gitMatches ?? null
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
  const {
    releaseVersion: _ignoredReleaseVersion,
    eventId: requestedEventId,
    ledgerWatermark: _ignoredLedgerWatermark,
    generatedAt: _ignoredGeneratedAt,
    createdAt: _ignoredCreatedAt,
    workspaceId: _ignoredWorkspaceId,
    sessionId: _ignoredSessionId,
    transcriptId: _ignoredTranscriptId,
    type: _ignoredType,
    ...safeExtra
  } = extra;
  const stableEventId = cleanInline(requestedEventId);
  if (stableEventId) {
    const existing = readLedgerEvents(root).find((event) => event.eventId === stableEventId);
    if (existing) return existing;
  }
  const config = readWorkspaceConfig(root) || {};
  const session = readSessionAnchor(root);
  const ledgerWatermark = currentLedgerWatermark(root) + 1;
  const at = now();
  const event = {
    schema: "nogra.ledger.event.v1",
    eventId: stableEventId || `ledger-event-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
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
  return safeCanonicalRunId(value);
}

function newApprovalId() {
  return `approval-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
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

function verdictPath(root, runId) {
  return path.join(nograDir(root), "receipts", "verdicts", `verdict-${safeTransportRunId(runId)}.json`);
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

function appendRunEvent(root, eventType, run, extra = {}) {
  const session = readSessionAnchor(root);
  const at = cleanInline(extra.createdAt || extra.generatedAt) || now();
  const ledgerWatermark = currentLedgerWatermark(root) + 1;
  const event = {
    schema: RUN_EVENT_SCHEMA_V2,
    eventId: cleanInline(extra.eventId) || `run-event-${safeTransportRunId(run.runId)}-${eventType}-${ledgerWatermark}`,
    eventType,
    type: eventType,
    workspaceId: run.workspaceId,
    runId: run.runId,
    briefId: run.briefId,
    approvalId: run.approvalId,
    approvalActionHash: run.approvalActionHash,
    lifecycle: run.lifecycle,
    outcome: run.outcome ?? null,
    verdict: run.verdict ?? null,
    ledgerWatermark,
    createdAt: at,
    generatedAt: at,
    sessionId: cleanInline(extra.sessionId || session.sessionId),
    transcriptId: cleanInline(extra.transcriptId || session.transcriptId),
    summary: cleanText(extra.summary || run.summary || ""),
    ...(cleanInline(extra.stopReason || run.stopReason) ? { stopReason: cleanInline(extra.stopReason || run.stopReason) } : {}),
    ...(cleanInline(extra.returnReason || run.returnReason) ? { returnReason: cleanInline(extra.returnReason || run.returnReason) } : {}),
    ...(extra.pendingState && typeof extra.pendingState === "object" ? { pendingState: extra.pendingState } : {}),
    executionRole: cleanInline(run.executionRole),
    executionRuntime: cleanInline(run.executionRuntime),
    executionRuntimeSource: cleanInline(run.executionRuntimeSource),
    executionLabel: cleanInline(run.executionLabel),
    ...(cleanInline(run.verificationRole) ? { verificationRole: cleanInline(run.verificationRole) } : {}),
    ...(cleanInline(run.verificationRuntime) ? { verificationRuntime: cleanInline(run.verificationRuntime) } : {}),
    ...(cleanInline(run.verificationRuntimeSource) ? { verificationRuntimeSource: cleanInline(run.verificationRuntimeSource) } : {}),
    ...(cleanInline(run.verificationStatus) ? { verificationStatus: cleanInline(run.verificationStatus) } : {}),
    ...(cleanInline(run.verificationLabel) ? { verificationLabel: cleanInline(run.verificationLabel) } : {}),
    nextOwner: cleanInline(extra.nextOwner || run.nextOwner)
  };
  assertRunEventSemantics(event);
  appendJsonlIfMissing(ledgerEventsPath(root), event);
  return event;
}

function createApproval(root, options = {}) {
  const brief = readBriefDraft(root, options.briefId);
  const validation = validateBriefPayload(root, brief);
  if (!validation.valid) {
    return { status: "invalid", errors: validation.errors, hostedMcpUsed: false };
  }
  const normalized = validation.normalized;
  if (normalized.status !== "ready") {
    return {
      status: "blocked",
      error: `brief must be ready before GO can be recorded (found ${normalized.status || "unknown"})`,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const at = now();
  const session = readSessionAnchor(root);
  const approvalId = newApprovalId();
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const expiresAt = cleanInline(options.expiresAt) || null;
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(at))) {
    return {
      status: "blocked",
      error: "approval expiry must be a future RFC 3339 date-time",
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const approval = {
    schema: APPROVAL_SCHEMA_V1,
    approvalId,
    workspaceId: normalized.workspaceId,
    briefId: normalized.briefId,
    briefHash: briefAuthorityHash(normalized),
    actionHash: approvalActionHash(normalized),
    status: "available",
    approvedAt: at,
    approvedBy: cleanInline(options.approvedBy) || "operator",
    source: "manager_observed_explicit_go",
    singleUse: true,
    createdAt: at,
    updatedAt: at,
    expiresAt,
    consumedAt: null,
    consumedByRunId: null,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    ledgerWatermark: predictedWatermark,
    redactions: [],
    metadata: {
      authority: "dispatch-only",
      nativePermissionsRemainAuthoritative: true
    }
  };
  assertApprovalSemantics(approval);
  writeJsonAtomic(approvalPath(root, approvalId), approval);
  const ledgerEvent = appendLedgerEvent(root, "approval_recorded", {
    approvalId,
    briefId: approval.briefId,
    briefHash: approval.briefHash,
    actionHash: approval.actionHash,
    approvalStatus: approval.status,
    approvedBy: approval.approvedBy,
    source: approval.source,
    singleUse: true,
    nextOwner: "Manager"
  });
  if (ledgerEvent.ledgerWatermark !== predictedWatermark) {
    throw new Error("approval ledger watermark changed during atomic approval write");
  }
  return {
    status: "available",
    approval,
    approvalId,
    briefId: approval.briefId,
    briefHash: approval.briefHash,
    actionHash: approval.actionHash,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    hostedMcpUsed: false,
    nextOwner: "Manager"
  };
}

function readDraftBrief(root, briefId) {
  return readBriefDraft(root, briefId);
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
    profile: "strict-role-lease-v1",
    role: wanted,
    spawnPrimitive: "Agent",
    roleToolField: hasAllowlist ? "tools" : disallowedTools.length ? "disallowedTools" : "inherited",
    tools,
    disallowedTools,
    nestedSpawnAllowed,
    arbitraryShellAllowed: hasClaudeTool(tools, "Bash"),
    writeTools: tools.filter((tool) => ["Edit", "MultiEdit", "Write"].includes(tool)),
    readOnly: !tools.some((tool) => ["Bash", "Edit", "MultiEdit", "Write"].includes(tool)),
    wall: "Public executor/verifier role frontmatter must explicitly constrain tools, must not include Agent or arbitrary shell, and action tools remain subject to a Manager-issued run lease.",
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

function renderDispatchReceipt({
  at,
  normalized,
  approval,
  run,
  targetRuntimeRole,
  targetRuntimeRoleName,
  runtime,
  runtimeSource,
  executionPair,
  executionSizing,
  executionNextStep,
  scratchRoots,
  idempotent = false
}) {
  const receipt = {
    generatedAt: at,
    status: "ready",
    mode: "local",
    receiptType: "canonicalDispatchReceipt",
    idempotent,
    schema: DISPATCH_RECEIPT_SCHEMA_V2,
    runId: run.runId,
    briefId: normalized.briefId,
    briefHash: run.briefHash,
    approvalId: approval.approvalId,
    actionHash: approval.actionHash,
    approvalStatus: approval.status,
    owner: "Manager",
    target: run.target,
    targetRole: run.targetRole,
    targetModel: run.targetModel,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionEffort: targetRuntimeRole.effort,
    executionContext: targetRuntimeRole.context,
    executionMaxTurns: executionSizing.maxTurns,
    executionSizing,
    executionRuntimePolicyProfile: runtime.profile,
    executionRuntimeSource: runtimeSource,
    executionLabel: run.executionLabel,
    lifecycle: run.lifecycle,
    outcome: run.outcome,
    verdict: run.verdict,
    ledgerWatermark: run.ledgerWatermark,
    sessionId: run.sessionId,
    transcriptId: run.transcriptId,
    scratchRoots,
    hostedMcpUsed: false,
    transport: {
      armed: approval.status === "consumed",
      ledger: "canonical .nogra/runs plus append-only .nogra/ledger",
      runtime: `customer-side subagent in ${targetRuntimeRoleName} role`,
      localArtifacts: run.paths,
      legacyTransportRunWritten: false
    },
    executionCrossing: {
      required: true,
      managerMayImplement: false,
      owner: "Manager",
      nextOwner: run.nextOwner,
      role: executionPair.executionRole,
      spawnPrimitive: "Agent",
      profile: "public-scoped-worker",
      isolationProfile: "strict-role-lease-v1",
      roleLeaseRequired: true,
      arbitraryShellAllowed: false,
      scopePatterns: run.scopePatterns || normalized.scope?.files || [],
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
    approval,
    run,
    nextOwner: run.nextOwner
  };
  return assertContract(DISPATCH_RECEIPT_SCHEMA_V2, receipt);
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
  if (normalized.status !== "ready") {
    return {
      status: "blocked",
      error: `dispatch requires a ready brief (found ${normalized.status || "unknown"})`,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  let approvalId;
  try {
    approvalId = safeApprovalId(options.approvalId);
  } catch {
    return {
      status: "blocked",
      error: "dispatch requires a valid --approval-id recorded from explicit GO; a ready brief is not GO",
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const approvalFile = approvalPath(root, approvalId);
  const approval = readContractJsonIfValid(approvalFile);
  if (!approval) {
    return {
      status: "blocked",
      error: "approval record is missing or invalid JSON",
      approvalId,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  try {
    assertApprovalSemantics(approval);
  } catch (error) {
    return {
      status: "blocked",
      error: error.message,
      approvalId,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const currentBriefHash = briefAuthorityHash(normalized);
  const currentActionHash = approvalActionHash(normalized);
  if (
    approval.briefId !== normalized.briefId ||
    approval.workspaceId !== normalized.workspaceId ||
    approval.briefHash !== currentBriefHash ||
    approval.actionHash !== currentActionHash
  ) {
    return {
      status: "blocked",
      error: "approval does not match the current ready brief revision",
      approvalId,
      briefId: normalized.briefId,
      expectedBriefHash: approval.briefHash,
      actualBriefHash: currentBriefHash,
      expectedActionHash: approval.actionHash,
      actualActionHash: currentActionHash,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  if (approval.status === "available" && approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) {
    const expiredAt = now();
    const predictedWatermark = currentLedgerWatermark(root) + 1;
    const expiredApproval = {
      ...approval,
      status: "expired",
      updatedAt: expiredAt,
      ledgerWatermark: predictedWatermark
    };
    assertApprovalSemantics(expiredApproval);
    writeJsonAtomic(approvalFile, expiredApproval);
    const expiredEvent = appendLedgerEvent(root, "approval_expired", {
      approvalId,
      briefId: approval.briefId,
      briefHash: approval.briefHash,
      actionHash: approval.actionHash,
      approvalStatus: "expired",
      nextOwner: "Manager"
    });
    if (expiredEvent.ledgerWatermark !== predictedWatermark) {
      throw new Error("approval ledger watermark changed during expiry write");
    }
    return {
      status: "blocked",
      error: "approval has expired",
      approvalId,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const requestedTarget = cleanInline(options.target) || normalized.targetRole || "executor";
  const target = cleanInline(normalized.targetRole) || "executor";
  if (requestedTarget !== target) {
    return {
      status: "blocked",
      error: `dispatch target ${requestedTarget} is outside the approved brief target ${target}`,
      approvalId,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const requestedModel = cleanInline(options.targetModel);
  if (requestedModel && requestedModel !== cleanInline(normalized.targetModel)) {
    return {
      status: "blocked",
      error: "target model override changes the approved brief revision; update the brief and obtain a new GO",
      approvalId,
      briefId: normalized.briefId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const runId = runIdForApproval(approvalId);
  const artifactsDirRelative = `.nogra/transport/artifacts/${runId}`;
  const scratchRoots = resolveDispatchScratchRoots(root, artifactsDirRelative, options.scratchRoots || []);
  const targetRuntimeRole = runtimeRoleForTarget(runtime, target);
  const targetRuntimeRoleName = scopedNograRole(target).split(":").pop() || "executor";
  const targetModel = normalized.targetModel || cleanInline(targetRuntimeRole.model) || defaultTargetModel(config);
  const runtimeSource = runtime.profile === "custom"
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
  const existingRun = readContractJsonIfValid(canonicalRunPath(root, runId));
  if (existingRun) {
    try {
      assertRunSemantics(existingRun);
    } catch (error) {
      return {
        status: "blocked",
        error: `existing canonical run is invalid: ${error.message}`,
        runId,
        approvalId,
        nextOwner: "Manager",
        hostedMcpUsed: false
      };
    }
    if (
      existingRun.approvalId !== approvalId ||
      existingRun.briefHash !== approval.briefHash ||
      existingRun.approvalActionHash !== approval.actionHash
    ) {
      return {
        status: "blocked",
        error: "deterministic run id is already bound to another approval or brief revision",
        runId,
        approvalId,
        nextOwner: "Manager",
        hostedMcpUsed: false
      };
    }
    let resolvedRun = existingRun;
    if (approval.status === "available") {
      const reconciled = {
        ...approval,
        status: "consumed",
        consumedAt: existingRun.createdAt,
        consumedByRunId: existingRun.runId,
        updatedAt: now(),
        ledgerWatermark: existingRun.ledgerWatermark
      };
      assertApprovalSemantics(reconciled);
      writeJsonAtomic(approvalFile, reconciled);
      Object.assign(approval, reconciled);
    }
    const queuedEvent = findRunEvent(root, runId, "run_queued");
    if (!queuedEvent) {
      if (existingRun.lifecycle !== "queued") {
        return {
          status: "blocked",
          error: "canonical run exists without its run_queued event and has already progressed; Manager reconciliation is required",
          runId,
          approvalId,
          nextOwner: "Manager",
          hostedMcpUsed: false
        };
      }
      const recoveredWatermark = currentLedgerWatermark(root) + 1;
      resolvedRun = {
        ...existingRun,
        ledgerWatermark: recoveredWatermark
      };
      const recoveredApproval = {
        ...approval,
        ledgerWatermark: recoveredWatermark,
        updatedAt: approval.updatedAt || now()
      };
      assertRunSemantics(resolvedRun);
      assertApprovalSemantics(recoveredApproval);
      writeJsonAtomic(canonicalRunPath(root, runId), resolvedRun);
      writeJsonAtomic(approvalFile, recoveredApproval);
      Object.assign(approval, recoveredApproval);
      const recoveredEvent = appendRunEvent(root, "run_queued", resolvedRun, { nextOwner: resolvedRun.nextOwner });
      if (recoveredEvent.ledgerWatermark !== recoveredWatermark) {
        throw new Error("run ledger watermark changed during dispatch recovery");
      }
    }
    return renderDispatchReceipt({
      at: resolvedRun.createdAt,
      normalized,
      approval,
      run: resolvedRun,
      targetRuntimeRole,
      targetRuntimeRoleName,
      runtime,
      runtimeSource,
      executionPair,
      executionSizing,
      executionNextStep,
      scratchRoots: resolvedRun.scratchRoots || scratchRoots,
      idempotent: true
    });
  }
  if (approval.status !== "available") {
    return {
      status: "blocked",
      error: `approval is ${approval.status} and cannot authorize another run`,
      approvalId,
      consumedByRunId: approval.consumedByRunId,
      nextOwner: "Manager",
      hostedMcpUsed: false
    };
  }
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const run = {
    schema: RUN_SCHEMA_V2,
    runId,
    workspaceId: normalized.workspaceId,
    briefId: normalized.briefId,
    briefHash: currentBriefHash,
    approvalId,
    approvalActionHash: approval.actionHash,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    returnedAt: null,
    verifiedAt: null,
    acceptedAt: null,
    endedAt: null,
    lifecycle: "queued",
    outcome: null,
    verdict: null,
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
    evidenceLevel: normalized.evidenceRequired || "reported",
    ledgerWatermark: predictedWatermark,
    sessionId: readSessionAnchor(root).sessionId,
    transcriptId: readSessionAnchor(root).transcriptId,
    scratchRoots,
    authorizedBoundaries: ["workspace-write"],
    scopePatterns: normalized.scope?.files || [],
    metadata: {
      mode: "local",
      receiptType: "canonicalDispatchReceipt",
      targetRole: target,
      targetModel,
      scratchRoots,
      scopeFiles: normalized.scope?.files || [],
      authorizedBoundaries: ["workspace-write"],
      scopePatterns: normalized.scope?.files || [],
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
      ledgerWatermark: predictedWatermark,
      sessionId: readSessionAnchor(root).sessionId,
      transcriptId: readSessionAnchor(root).transcriptId,
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
  assertRunSemantics(run);
  writeJsonAtomic(canonicalRunPath(root, runId), run);
  const consumedApproval = {
    ...approval,
    status: "consumed",
    consumedAt: at,
    consumedByRunId: runId,
    updatedAt: at,
    ledgerWatermark: predictedWatermark
  };
  assertApprovalSemantics(consumedApproval);
  writeJsonAtomic(approvalFile, consumedApproval);
  const event = appendRunEvent(root, "run_queued", run, { nextOwner });
  if (event.ledgerWatermark !== predictedWatermark) {
    throw new Error("run ledger watermark changed during canonical dispatch write");
  }
  return renderDispatchReceipt({
    at,
    normalized,
    approval: consumedApproval,
    run,
    targetRuntimeRole,
    targetRuntimeRoleName,
    runtime,
    runtimeSource,
    executionPair,
    executionSizing,
    executionNextStep,
    scratchRoots
  });
}

function newRoleLeaseId(runId, role) {
  return `role-lease-${safeTransportRunId(runId)}-${normalizeRole(role)}-${timestamp()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
}

function roleReportId(runId, role, leaseId) {
  const leaseSuffix = cleanInline(leaseId).split("-").slice(-2).join("-");
  return `role-report-${safeTransportRunId(runId)}-${normalizeRole(role)}-${leaseSuffix || "unbound"}`;
}

function roleLeaseEventId(leaseId, event) {
  return `ledger-event-${leaseId}-${event}`;
}

function roleReportEventId(reportId) {
  return `ledger-event-${reportId}-recorded`;
}

function roleLeaseExpiry(minutes) {
  const requested = positiveIntegerOrNull(minutes) || 120;
  if (requested > 480) {
    throw new Error("role lease cannot exceed 480 minutes");
  }
  return new Date(Date.now() + requested * 60 * 1000).toISOString();
}

function closeExpiredRoleLease(root, lease) {
  if (!lease || lease.status !== "active" || Date.parse(lease.expiresAt) > Date.now()) return lease;
  const at = now();
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const expired = {
    ...lease,
    status: "expired",
    updatedAt: at,
    closedAt: at,
    closeReason: "expired",
    ledgerWatermark: predictedWatermark
  };
  writeRoleLease(root, expired);
  const event = appendLedgerEvent(root, "role_lease_expired", {
    eventId: roleLeaseEventId(lease.leaseId, "expired"),
    leaseId: lease.leaseId,
    runId: lease.runId,
    briefId: lease.briefId,
    role: lease.role,
    nextOwner: "Manager"
  });
  if (event.ledgerWatermark !== predictedWatermark) {
    throw new Error("role lease expiry watermark changed during canonical write");
  }
  return expired;
}

function enterRole(root, options = {}) {
  const role = normalizeRole(options.role);
  if (!role) {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      error: "role-enter requires --role executor or verifier",
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  const runId = safeTransportRunId(options.runId);
  const located = readRunRecord(root, runId);
  if (!located || located.legacy) {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      runId,
      role,
      error: located ? "role isolation requires a canonical run" : "run not found",
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  const run = readContractJsonIfValid(located.sourcePath);
  assertRunSemantics(run);

  let active = readActiveRoleLease(root);
  active = closeExpiredRoleLease(root, active);
  if (active?.status === "active") {
    if (active.runId === runId && active.role === role) {
      const eventId = roleLeaseEventId(active.leaseId, "entered");
      let recovered = false;
      if (!readLedgerEvents(root).some((event) => event.eventId === eventId)) {
        const event = appendLedgerEvent(root, "role_lease_entered", {
          eventId,
          leaseId: active.leaseId,
          runId,
          briefId: run.briefId,
          role,
          scopePatterns: active.scopePatterns,
          allowedTools: active.allowedTools,
          nextOwner: `nogra:${role}`
        });
        if (event.ledgerWatermark !== active.ledgerWatermark) {
          throw new Error("role lease recovery watermark changed");
        }
        recovered = true;
      }
      return {
        ...active,
        idempotent: true,
        recovered,
        nextOwner: `nogra:${role}`
      };
    }
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      runId,
      role,
      activeLeaseId: active.leaseId,
      error: `another role lease is active for ${active.runId}/${active.role}`,
      owner: "Manager",
      nextOwner: "Manager"
    };
  }

  if (role === "executor" && !["queued", "running"].includes(run.lifecycle)) {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      runId,
      role,
      error: `executor role requires queued or recoverable running lifecycle (found ${run.lifecycle})`,
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  if (role === "verifier" && run.lifecycle !== "returned") {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      runId,
      role,
      error: `verifier role requires returned lifecycle (found ${run.lifecycle})`,
      owner: "Manager",
      nextOwner: "Manager"
    };
  }

  let scopePatterns = [];
  if (role === "executor") {
    try {
      scopePatterns = normalizeScopePatterns(
        root,
        run.scopePatterns || run.metadata?.scopeFiles || []
      );
    } catch (error) {
      return {
        schema: ROLE_LEASE_SCHEMA_V1,
        status: "blocked",
        runId,
        role,
        error: error.message,
        owner: "Manager",
        nextOwner: "Manager"
      };
    }
  }

  const at = now();
  const session = readSessionAnchor(root);
  const leaseId = newRoleLeaseId(runId, role);
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const lease = {
    schema: ROLE_LEASE_SCHEMA_V1,
    leaseId,
    workspaceId: run.workspaceId,
    runId,
    briefId: run.briefId,
    briefHash: run.briefHash,
    role,
    owner: "Manager",
    status: "active",
    agentId: null,
    scopePatterns,
    allowedTools: [...ROLE_TOOL_POLICY[role]],
    createdAt: at,
    updatedAt: at,
    expiresAt: roleLeaseExpiry(options.expiresInMinutes),
    closedAt: null,
    closeReason: "",
    ledgerWatermark: predictedWatermark,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    metadata: {
      source: "manager_role_enter",
      runLifecycleAtEntry: run.lifecycle,
      strictPublicProfile: true,
      arbitraryShellAllowed: false,
      controlPlaneWritesAllowed: false,
      readOnly: role === "verifier",
      recoveredRunningRun: role === "executor" && run.lifecycle === "running"
    }
  };
  assertRoleLeaseSemantics(lease);
  writeRoleLease(root, lease);

  const nextRun = {
    ...run,
    updatedAt: at,
    startedAt: role === "executor" ? (run.startedAt || at) : run.startedAt,
    lifecycle: role === "executor" ? "running" : run.lifecycle,
    owner: "Manager",
    nextOwner: `nogra:${role}`,
    ledgerWatermark: predictedWatermark,
    metadata: {
      ...(run.metadata || {}),
      activeRoleLeaseId: lease.leaseId,
      activeRole: role,
      ledgerWatermark: predictedWatermark,
      nextOwner: `nogra:${role}`
    }
  };
  assertRunTransition(run.lifecycle, nextRun.lifecycle);
  assertRunSemantics(nextRun);
  writeJsonAtomic(canonicalRunPath(root, runId), nextRun);
  const event = appendLedgerEvent(root, "role_lease_entered", {
    eventId: roleLeaseEventId(leaseId, "entered"),
    leaseId,
    runId,
    briefId: run.briefId,
    role,
    scopePatterns,
    allowedTools: ROLE_TOOL_POLICY[role],
    nextOwner: `nogra:${role}`
  });
  if (event.ledgerWatermark !== predictedWatermark) {
    throw new Error("role lease entry watermark changed during canonical write");
  }
  return {
    ...lease,
    runLifecycle: nextRun.lifecycle,
    idempotent: false,
    nextOwner: `nogra:${role}`
  };
}

function exitRole(root, options = {}) {
  const leaseId = cleanInline(options.leaseId);
  const active = readActiveRoleLease(root);
  if (!active) {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      leaseId,
      error: "no role lease exists",
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  if (active.leaseId !== leaseId) {
    const prior = readContractJsonIfValid(roleLeaseReceiptPath(root, leaseId));
    if (prior?.status === "closed" || prior?.status === "expired") {
      assertRoleLeaseSemantics(prior);
      return { ...prior, idempotent: true, nextOwner: "Manager" };
    }
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "blocked",
      leaseId,
      activeLeaseId: active.leaseId,
      error: "lease id does not match the current role lease",
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  if (active.status !== "active") {
    const eventName = active.status === "expired" ? "expired" : "closed";
    const eventType = active.status === "expired" ? "role_lease_expired" : "role_lease_closed";
    const eventId = roleLeaseEventId(active.leaseId, eventName);
    let recovered = false;
    if (!readLedgerEvents(root).some((event) => event.eventId === eventId)) {
      const event = appendLedgerEvent(root, eventType, {
        eventId,
        leaseId: active.leaseId,
        runId: active.runId,
        briefId: active.briefId,
        role: active.role,
        reason: active.closeReason,
        nextOwner: "Manager"
      });
      if (event.ledgerWatermark !== active.ledgerWatermark) {
        throw new Error("role lease closure recovery watermark changed");
      }
      recovered = true;
    }
    return { ...active, idempotent: true, recovered, nextOwner: "Manager" };
  }

  const reason = cleanInline(options.reason) || "role returned control to Manager";
  const at = now();
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const closed = {
    ...active,
    status: "closed",
    updatedAt: at,
    closedAt: at,
    closeReason: reason,
    ledgerWatermark: predictedWatermark
  };
  assertRoleLeaseSemantics(closed);
  writeRoleLease(root, closed);

  const run = readContractJsonIfValid(canonicalRunPath(root, active.runId));
  if (run) {
    assertRunSemantics(run);
    const updatedRun = {
      ...run,
      updatedAt: at,
      owner: "Manager",
      nextOwner: "Manager",
      ledgerWatermark: predictedWatermark,
      metadata: {
        ...(run.metadata || {}),
        activeRoleLeaseId: "",
        activeRole: "",
        lastRoleLeaseId: leaseId,
        ledgerWatermark: predictedWatermark,
        nextOwner: "Manager"
      }
    };
    assertRunSemantics(updatedRun);
    writeJsonAtomic(canonicalRunPath(root, active.runId), updatedRun);
  }
  const event = appendLedgerEvent(root, "role_lease_closed", {
    eventId: roleLeaseEventId(leaseId, "closed"),
    leaseId,
    runId: active.runId,
    briefId: active.briefId,
    role: active.role,
    reason,
    nextOwner: "Manager"
  });
  if (event.ledgerWatermark !== predictedWatermark) {
    throw new Error("role lease closure watermark changed during canonical write");
  }
  return { ...closed, idempotent: false, nextOwner: "Manager" };
}

function roleReportContract(root, kind, options = {}) {
  const role = normalizeRole(kind);
  if (!role) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "invalid",
      error: "unknown role report kind",
      availableKinds: ["executor", "verifier"],
      nextOwner: "Manager"
    };
  }
  const runId = cleanInline(options.runId);
  const run = runId ? readRunRecord(root, runId) : null;
  const currentLease = runId ? readActiveRoleLease(root) : null;
  const leaseId = cleanInline(options.leaseId) || (
    currentLease?.runId === runId && currentLease?.role === role
      ? currentLease.leaseId
      : ""
  );
  return {
    schema: ROLE_REPORT_SCHEMA_V1,
    status: "ready",
    role,
    contract: contractJson("schemas/role-report-v1.schema.json"),
    template: {
      schema: ROLE_REPORT_SCHEMA_V1,
      reportId: runId && leaseId ? roleReportId(runId, role, leaseId) : "role-report-<runId>-<role>-<lease>",
      workspaceId: run?.workspaceId || workspaceId(readWorkspaceConfig(root) || {}),
      runId: run?.runId || runId || "run-<id>",
      briefId: run?.briefId || "brief-<id>",
      leaseId: leaseId || "role-lease-<runId>-<role>",
      role,
      status: "blocked",
      summary: "",
      claims: [],
      evidenceIds: [],
      filesChanged: [],
      requestedProbes: [],
      scopeCheck: {
        status: "blocked",
        checkedPatterns: run?.scopePatterns || run?.metadata?.scopeFiles || [],
        deviations: []
      },
      mutationAttempted: false,
      recommendation: role === "verifier" ? "unverified" : "none",
      reason: "",
      generatedAt: now(),
      nextOwner: "Manager",
      contentHash: "sha256:<computed-by-runtime>",
      ledgerWatermark: 0,
      sessionId: "",
      transcriptId: "",
      redactions: [],
      metadata: {}
    },
    truthBoundary: role === "executor"
      ? "Executor output is a claim surface and cannot issue a verdict."
      : "Verifier output is a read-only recommendation; Manager owns the canonical verdict.",
    nextOwner: "Manager"
  };
}

function normalizeRoleReportInput(root, input, run, lease) {
  const role = normalizeRole(input.role);
  const session = readSessionAnchor(root);
  const claims = Array.isArray(input.claims) ? input.claims.map((claim) => ({
    claim: cleanText(claim?.claim),
    verificationStatus: cleanInline(claim?.verificationStatus) || "claimed",
    evidenceIds: normalizeTextList(claim?.evidenceIds)
  })) : [];
  const evidenceIds = normalizeTextList(input.evidenceIds);
  const scopeCheck = input.scopeCheck && typeof input.scopeCheck === "object" ? input.scopeCheck : {};
  const report = {
    schema: ROLE_REPORT_SCHEMA_V1,
    reportId: roleReportId(run.runId, role, lease.leaseId),
    workspaceId: run.workspaceId,
    runId: run.runId,
    briefId: run.briefId,
    leaseId: lease.leaseId,
    role,
    status: cleanInline(input.status).toLowerCase(),
    summary: cleanText(input.summary),
    claims,
    evidenceIds,
    filesChanged: normalizeTextList(input.filesChanged),
    requestedProbes: normalizeTextList(input.requestedProbes),
    scopeCheck: {
      status: cleanInline(scopeCheck.status).toLowerCase(),
      checkedPatterns: normalizeTextList(scopeCheck.checkedPatterns),
      deviations: normalizeTextList(scopeCheck.deviations)
    },
    mutationAttempted: Boolean(input.mutationAttempted),
    recommendation: cleanInline(input.recommendation || (role === "executor" ? "none" : "unverified")).toLowerCase(),
    reason: cleanText(input.reason),
    generatedAt: cleanInline(input.generatedAt) || now(),
    nextOwner: "Manager",
    contentHash: "",
    ledgerWatermark: currentLedgerWatermark(root) + 1,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    redactions: normalizeTextList(input.redactions),
    metadata: {
      ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
      source: "manager_persisted_role_return",
      selfReportIsVerdict: false
    }
  };
  report.contentHash = roleReportContentHash(report);
  return report;
}

function saveRoleReport(root, input = {}) {
  const role = normalizeRole(input.role);
  if (!role) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      error: "role-report-save requires role executor or verifier",
      nextOwner: "Manager"
    };
  }
  let runId;
  try {
    runId = safeTransportRunId(input.runId);
  } catch (error) {
    return { schema: ROLE_REPORT_SCHEMA_V1, status: "blocked", error: error.message, nextOwner: "Manager" };
  }
  const located = readRunRecord(root, runId);
  if (!located || located.legacy) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      error: located ? "role reports require a canonical run" : "run not found",
      nextOwner: "Manager"
    };
  }
  const run = readContractJsonIfValid(located.sourcePath);
  assertRunSemantics(run);
  const leaseId = cleanInline(input.leaseId);
  if (!leaseId) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      error: "role report requires the exact leaseId returned by role-enter",
      nextOwner: "Manager"
    };
  }
  const expectedReportId = roleReportId(runId, role, leaseId);
  const boundaryMismatches = [
    ["schema", cleanInline(input.schema), ROLE_REPORT_SCHEMA_V1],
    ["reportId", cleanInline(input.reportId), expectedReportId],
    ["workspaceId", cleanInline(input.workspaceId), run.workspaceId],
    ["briefId", cleanInline(input.briefId), run.briefId],
    ["nextOwner", cleanInline(input.nextOwner), "Manager"]
  ].filter(([, supplied, expected]) => supplied && supplied !== expected);
  if (boundaryMismatches.length) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: `role report boundary mismatch: ${boundaryMismatches.map(([field]) => field).join(", ")}`,
      nextOwner: "Manager"
    };
  }
  const lease = readContractJsonIfValid(roleLeaseReceiptPath(root, leaseId));
  if (!lease) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: "role report has no schema-valid lease receipt",
      nextOwner: "Manager"
    };
  }
  try {
    assertRoleLeaseSemantics(lease);
  } catch (error) {
    return { schema: ROLE_REPORT_SCHEMA_V1, status: "blocked", runId, leaseId, error: error.message, nextOwner: "Manager" };
  }
  if (
    lease.status !== "closed" ||
    lease.runId !== runId ||
    lease.briefId !== run.briefId ||
    lease.briefHash !== run.briefHash ||
    lease.role !== role
  ) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: "role report does not match a closed lease for this run revision and role",
      nextOwner: "Manager"
    };
  }

  const report = normalizeRoleReportInput(root, input, run, lease);
  try {
    assertRoleReportSemantics(report);
  } catch (error) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: error.message,
      nextOwner: "Manager"
    };
  }
  const expectedScopePatterns = normalizeTextList(run.scopePatterns || run.metadata?.scopeFiles);
  if (
    report.scopeCheck.status === "met" &&
    !expectedScopePatterns.every((pattern) => report.scopeCheck.checkedPatterns.includes(pattern))
  ) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: "role report scope check does not cover every approved run pattern",
      nextOwner: "Manager"
    };
  }
  if (
    role === "executor" &&
    !report.filesChanged.every((file) => matchesRoleScope(root, file, lease.scopePatterns))
  ) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: "executor report names a changed file outside its approved role lease",
      nextOwner: "Manager"
    };
  }

  let evidenceRecords;
  try {
    evidenceRecords = report.evidenceIds.map((evidenceId) => readEvidenceRecord(root, evidenceId));
  } catch (error) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: error.message,
      nextOwner: "Manager"
    };
  }
  for (const evidence of evidenceRecords) {
    if ((evidence.runId && evidence.runId !== runId) || (evidence.briefId && evidence.briefId !== run.briefId)) {
      return {
        schema: ROLE_REPORT_SCHEMA_V1,
        status: "blocked",
        runId,
        leaseId,
        error: `evidence ${evidence.evidenceId} is not bound to this run and brief`,
        nextOwner: "Manager"
      };
    }
  }
  const declaredEvidence = new Set(report.evidenceIds);
  if (report.claims.some((claim) => claim.evidenceIds.some((evidenceId) => !declaredEvidence.has(evidenceId)))) {
    return {
      schema: ROLE_REPORT_SCHEMA_V1,
      status: "blocked",
      runId,
      leaseId,
      error: "claim evidenceIds must also appear in the report evidenceIds set",
      nextOwner: "Manager"
    };
  }

  const file = roleReportReceiptPath(root, report.reportId);
  const existing = readContractJsonIfValid(file);
  if (existing) {
    try {
      assertRoleReportSemantics(existing);
    } catch (error) {
      return { schema: ROLE_REPORT_SCHEMA_V1, status: "blocked", runId, error: error.message, nextOwner: "Manager" };
    }
    if (existing.contentHash !== report.contentHash) {
      return {
        schema: ROLE_REPORT_SCHEMA_V1,
        status: "blocked",
        runId,
        reportId: report.reportId,
        error: "role report already exists with different content",
        nextOwner: "Manager"
      };
    }
    const eventId = roleReportEventId(existing.reportId);
    let recovered = false;
    if (!readLedgerEvents(root).some((event) => event.eventId === eventId)) {
      const event = appendLedgerEvent(root, "role_report_recorded", {
        eventId,
        reportId: existing.reportId,
        leaseId: existing.leaseId,
        runId,
        briefId: run.briefId,
        role,
        reportStatus: existing.status,
        recommendation: existing.recommendation,
        contentHash: existing.contentHash,
        evidenceIds: existing.evidenceIds,
        nextOwner: "Manager"
      });
      if (event.ledgerWatermark !== existing.ledgerWatermark) {
        throw new Error("role report recovery watermark changed");
      }
      recovered = true;
    }
    return {
      status: "ok",
      idempotent: !recovered,
      recovered,
      report: existing,
      reportId: existing.reportId,
      path: localPath(root, file),
      nextOwner: "Manager"
    };
  }

  writeJsonAtomic(file, report);
  const event = appendLedgerEvent(root, "role_report_recorded", {
    eventId: roleReportEventId(report.reportId),
    reportId: report.reportId,
    leaseId: report.leaseId,
    runId,
    briefId: run.briefId,
    role,
    reportStatus: report.status,
    recommendation: report.recommendation,
    contentHash: report.contentHash,
    evidenceIds: report.evidenceIds,
    nextOwner: "Manager"
  });
  if (event.ledgerWatermark !== report.ledgerWatermark) {
    throw new Error("role report ledger watermark changed during canonical write");
  }
  return {
    status: "ok",
    idempotent: false,
    report,
    reportId: report.reportId,
    path: localPath(root, file),
    ledgerWatermark: event.ledgerWatermark,
    nextOwner: "Manager"
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
  const run = runId ? readRunRecord(root, runId) : null;
  const currentLease = runId ? readActiveRoleLease(root) : null;
  const expectedLeaseId = currentLease?.status === "active" &&
    currentLease.runId === runId &&
    currentLease.role === wanted
      ? currentLease.leaseId
      : "";
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
    roleIsolation: {
      profile: "strict-role-lease-v1",
      mechanicallyEnforced: true,
      leaseRequired: Boolean(runId),
      leaseActive: Boolean(expectedLeaseId),
      expectedLeaseId,
      enterCommand: runId
        ? `role-enter --run-id ${runId} --role ${wanted}`
        : "",
      exitCommand: expectedLeaseId
        ? `role-exit --lease-id ${expectedLeaseId}`
        : "",
      arbitraryShellAllowed: false,
      controlPlaneWritesAllowed: false,
      readOnly: wanted === "verifier",
      scopePatterns: wanted === "executor"
        ? (run?.scopePatterns || run?.metadata?.scopeFiles || [])
        : []
    },
    roleReport: roleReportContract(root, wanted, {
      runId,
      leaseId: expectedLeaseId
    }),
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
      "Before spawning, Manager must create the run-bound role lease named in roleIsolation. A role without that lease fails closed on action tools.",
      `Spawn with the Claude Code Agent primitive into the plugin-provided ${scopedRole} role.`,
      "Include the complete context bundle in the Agent prompt; spawned agents do not inherit parent conversation, shared memory or files read by Manager.",
      "Pass complete prior findings with attribution when they matter. Use structured fields such as claim, evidence, source URL/document/page or file/line, verificationStatus, confidence and agent id.",
      "Public executor/verifier roles intentionally omit Agent from their frontmatter tools. They must not spawn nested subagents; route fan-out to internal or enterprise orchestration instead.",
      "Public executor/verifier roles intentionally omit Bash. Manager runs requested command probes and persists their canonical evidence.",
      "Manager is not the role-runtime. If the role primitive is unavailable, stop and surface the missing primitive.",
      "Keep Nogra bookkeeping in Manager. The spawned role-runtime receives the brief, scope and evidence contract and returns a report.",
      "After the role returns, Manager closes the lease, validates and saves the exact structured role report, then performs any Manager-owned probes or verdict write.",
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

function verifyLegacySupport(root, options) {
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

function normalizeAcceptanceEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return item;
    return { criterion: cleanText(item), status: "unknown" };
  });
}

function normalizeTextList(value) {
  return Array.isArray(value) ? value.map((item) => cleanText(item)).filter(Boolean) : [];
}

function verdictAuthorityView(value) {
  return {
    verdict: value.verdict,
    reason: value.reason,
    summary: value.summary,
    acceptance: value.acceptance,
    briefDeviations: value.briefDeviations,
    decisionRequired: value.decisionRequired,
    evidenceIds: value.evidenceIds,
    evidenceRefs: value.evidenceRefs,
    executionRole: value.executionRole,
    executionRuntime: value.executionRuntime,
    verificationRole: value.verificationRole,
    verificationRuntime: value.verificationRuntime,
    roleReportId: value.roleReportId || ""
  };
}

function verifyCanonicalSupport(root, record, options) {
  const runId = safeTransportRunId(record.runId);
  const runFile = canonicalRunPath(root, runId);
  const run = readContractJsonIfValid(runFile);
  assertRunSemantics(run);
  let evidence = options.inputPayload || {};
  const requestedRoleReportId = cleanInline(evidence.roleReportId);
  let roleReport = null;
  if (requestedRoleReportId) {
    roleReport = readContractJsonIfValid(roleReportReceiptPath(root, requestedRoleReportId));
    try {
      assertRoleReportSemantics(roleReport);
    } catch (error) {
      return {
        status: "blocked",
        mode: "local",
        hostedMcpUsed: false,
        run,
        validation: null,
        verdict: "unverified",
        reason: "The verifier return is missing or invalid.",
        error: error.message,
        nextOwner: "Manager"
      };
    }
    if (
      roleReport.role !== "verifier" ||
      roleReport.runId !== runId ||
      roleReport.briefId !== run.briefId
    ) {
      return {
        status: "blocked",
        mode: "local",
        hostedMcpUsed: false,
        run,
        validation: null,
        verdict: "unverified",
        reason: "The verifier return belongs to another role, run or brief.",
        error: "role report boundary mismatch",
        nextOwner: "Manager"
      };
    }
    evidence = {
      ...evidence,
      status: roleReport.status,
      verdict: roleReport.recommendation,
      reason: roleReport.reason,
      summary: roleReport.summary,
      evidenceIds: roleReport.evidenceIds,
      acceptance: roleReport.claims.map((claim) => ({
        criterion: claim.claim,
        status: claim.verificationStatus === "verified" ? "met" : "unclear",
        evidenceIds: claim.evidenceIds
      })),
      briefDeviations: roleReport.scopeCheck.deviations,
      decisionRequired: roleReport.recommendation === "decision_required",
      verificationRole: "nogra:verifier"
    };
  }
  const requestedVerificationRole = normalizeRole(evidence.verificationRole);
  if (requestedVerificationRole === "verifier" && !roleReport) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict: "unverified",
      reason: "Verifier output was not supplied as a schema-valid role report.",
      error: "nogra:verifier verification requires roleReportId",
      nextOwner: "Manager"
    };
  }
  const verificationStatus = inferVerificationStatus(evidence);
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
  if (run.lifecycle !== "returned" && run.lifecycle !== "verified") {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict,
      reason,
      error: `verification requires a returned run (found lifecycle ${run.lifecycle})`,
      nextOwner: "Manager"
    };
  }
  if (!run.outcome) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict,
      reason,
      error: "verification requires a recorded executor outcome",
      nextOwner: "Manager"
    };
  }

  const acceptance = normalizeAcceptanceEvidence(evidence.acceptance);
  const briefDeviations = normalizeTextList(evidence.briefDeviations);
  const evidenceIds = normalizeTextList(evidence.evidenceIds);
  let evidenceRecords = [];
  try {
    evidenceRecords = evidenceIds.map((evidenceId) => readEvidenceRecord(root, evidenceId));
  } catch (error) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict,
      reason,
      error: error.message,
      nextOwner: "Manager"
    };
  }
  if (verdict === "ship" && evidenceRecords.length === 0) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict: "unverified",
      reason: "No canonical evidence receipt was supplied.",
      error: "ship requires at least one schema-valid evidenceId; free-text evidence references cannot satisfy verification",
      nextOwner: "Manager"
    };
  }
  for (const record of evidenceRecords) {
    if (record.runId && record.runId !== runId) {
      return {
        status: "blocked",
        mode: "local",
        hostedMcpUsed: false,
        run,
        validation: null,
        verdict: "unverified",
        reason: `Evidence ${record.evidenceId} belongs to another run.`,
        error: `evidence run mismatch: expected ${runId}, received ${record.runId}`,
        nextOwner: "Manager"
      };
    }
    if (record.briefId && record.briefId !== run.briefId) {
      return {
        status: "blocked",
        mode: "local",
        hostedMcpUsed: false,
        run,
        validation: null,
        verdict: "unverified",
        reason: `Evidence ${record.evidenceId} belongs to another brief.`,
        error: `evidence brief mismatch: expected ${run.briefId}, received ${record.briefId}`,
        nextOwner: "Manager"
      };
    }
  }
  const evidenceRank = new Map([["reported", 0], ["edited", 1], ["tested", 2], ["verified", 3]]);
  const requestedLevel = cleanInline(run.evidenceLevel || "reported");
  const requiredSupportingRank = requestedLevel === "verified" ? evidenceRank.get("tested") : (evidenceRank.get(requestedLevel) ?? 0);
  if (verdict === "ship" && !evidenceRecords.some((item) => (evidenceRank.get(item.evidenceLevel) ?? -1) >= requiredSupportingRank)) {
    return {
      status: "blocked",
      mode: "local",
      hostedMcpUsed: false,
      run,
      validation: null,
      verdict: "unverified",
      reason: `Available evidence does not satisfy requested level ${requestedLevel}.`,
      error: `ship requires ${requestedLevel === "verified" ? "tested evidence plus this verification verdict" : `${requestedLevel}-or-stronger evidence`}`,
      nextOwner: "Manager"
    };
  }
  const evidenceRefs = [...new Set(evidenceRecords.flatMap((item) => item.artifacts.map((artifact) => artifact.ref)))];
  const summary = cleanText(evidence.summary || "Local verification support recorded. Manager remains final verification authority.");
  const decisionRequired = Boolean(evidence.decisionRequired);
  const verificationState = {
    verificationRole: cleanInline(evidence.verificationRole || run.verificationRole || run.metadata?.verificationRole || "Manager"),
    verificationRuntime: cleanInline(evidence.verificationRuntime || run.verificationRuntime || run.metadata?.verificationRuntime || ""),
    verificationRuntimeSource: cleanInline(evidence.verificationRuntimeSource || run.verificationRuntimeSource || run.metadata?.verificationRuntimeSource || ""),
    verificationStatus: cleanInline(evidence.verificationStatus || run.verificationStatus || run.metadata?.verificationStatus || verificationStatus)
  };
  verificationState.verificationLabel = [
    roleDisplayName(verificationState.verificationRole),
    runtimeDisplayName(verificationState.verificationRuntime),
    statusDisplayName(verificationState.verificationStatus)
  ].filter(Boolean).join(" · ");
  const existingVerdict = readContractJsonIfValid(verdictPath(root, runId));
  const candidateAuthority = {
    verdict,
    reason,
    summary,
    acceptance,
    briefDeviations,
    decisionRequired,
    evidenceIds,
    evidenceRefs,
    executionRole: run.executionRole,
    executionRuntime: run.executionRuntime,
    verificationRole: verificationState.verificationRole,
    verificationRuntime: verificationState.verificationRuntime,
    roleReportId: roleReport?.reportId || ""
  };
  if (existingVerdict) {
    assertVerdictSemantics(existingVerdict);
    if (canonicalJson(verdictAuthorityView(existingVerdict)) !== canonicalJson(candidateAuthority)) {
      return {
        status: "blocked",
        mode: "local",
        hostedMcpUsed: false,
        run,
        validation: readContractJsonIfValid(transportArtifactPath(root, runId, "validation.json")),
        verdict: existingVerdict.verdict,
        reason: existingVerdict.reason,
        error: "run already has a different canonical verdict; changing it requires an explicit Manager decision",
        nextOwner: "Manager"
      };
    }
    const existingValidation = readContractJsonIfValid(transportArtifactPath(root, runId, "validation.json"));
    const existingEvent = findRunEvent(root, runId, "run_verified");
    if (run.lifecycle === "verified" && existingValidation && existingEvent) {
      return {
        status: verificationStatus,
        mode: "local",
        hostedMcpUsed: false,
        idempotent: true,
        run,
        validation: existingValidation,
        verdict: existingVerdict.verdict,
        verdictRecord: existingVerdict,
        reason: existingVerdict.reason,
        nextOwner: "Manager"
      };
    }
  }

  const at = now();
  const verdictGeneratedAt = cleanInline(existingVerdict?.generatedAt) || at;
  const session = readSessionAnchor(root);
  const predictedWatermark = currentLedgerWatermark(root) + 1;
  const verdictRecord = {
    schema: VERDICT_SCHEMA_V1,
    verdictId: `verdict-${runId}`,
    workspaceId: run.workspaceId,
    runId,
    briefId: run.briefId,
    briefHash: run.briefHash,
    verdict,
    reason,
    generatedAt: verdictGeneratedAt,
    owner: "Manager",
    nextOwner: "Manager",
    summary,
    acceptance,
    briefDeviations,
    decisionRequired,
    evidenceIds,
    evidenceRefs,
    executionRole: run.executionRole,
    executionRuntime: run.executionRuntime,
    verificationRole: verificationState.verificationRole,
    verificationRuntime: verificationState.verificationRuntime,
    roleReportId: roleReport?.reportId || "",
    ledgerWatermark: predictedWatermark,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    redactions: [],
    metadata: {
      verificationStatus,
      roleReportId: roleReport?.reportId || "",
      source: roleReport ? "verifier_role_report" : "manager_verification"
    }
  };
  assertVerdictSemantics(verdictRecord);
  const validation = {
    schema: "nogra.local.validation.v1",
    generatedAt: at,
    runId,
    briefId: run.briefId,
    status: verificationStatus,
    verdict,
    hostedMcpUsed: false,
    summary,
    reason,
    executionRole: run.executionRole,
    executionRuntime: run.executionRuntime,
    executionEffort: run.executionEffort || "",
    executionContext: run.executionContext || "",
    executionRuntimePolicyProfile: run.executionRuntimePolicyProfile || "",
    executionLabel: run.executionLabel || "",
    ...verificationState,
    acceptance,
    briefDeviations,
    decisionRequired,
    evidenceIds,
    evidenceRefs,
    roleReportId: roleReport?.reportId || "",
    ledgerWatermark: predictedWatermark,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    canonicalVerdictPath: localPath(root, verdictPath(root, runId)),
    nextOwner: "Manager"
  };
  const updatedRun = {
    ...run,
    updatedAt: at,
    verifiedAt: run.verifiedAt || at,
    lifecycle: "verified",
    verdict,
    owner: "Manager",
    nextOwner: "Manager",
    verificationRole: verificationState.verificationRole,
    verificationRuntime: verificationState.verificationRuntime,
    verificationRuntimeSource: verificationState.verificationRuntimeSource,
    verificationStatus: verificationState.verificationStatus,
    verificationLabel: verificationState.verificationLabel,
    roleReportId: roleReport?.reportId || "",
    artifacts: {
      ...run.artifacts,
      validationExists: true
    },
    ledgerWatermark: predictedWatermark,
    sessionId: session.sessionId || run.sessionId,
    transcriptId: session.transcriptId || run.transcriptId,
    summary
  };
  assertRunTransition(run.lifecycle, updatedRun.lifecycle);
  assertRunSemantics(updatedRun);
  writeJsonAtomic(verdictPath(root, runId), verdictRecord);
  writeJsonAtomic(transportArtifactPath(root, runId, "validation.json"), validation);
  writeJsonAtomic(runFile, updatedRun);
  const event = appendRunEvent(root, "run_verified", updatedRun, {
    summary,
    nextOwner: "Manager",
    sessionId: session.sessionId,
    transcriptId: session.transcriptId
  });
  if (event.ledgerWatermark !== predictedWatermark) {
    throw new Error("run ledger watermark changed during canonical verification write");
  }
  return {
    status: verificationStatus,
    mode: "local",
    hostedMcpUsed: false,
    idempotent: Boolean(existingVerdict),
    recovered: Boolean(existingVerdict),
    run: updatedRun,
    validation,
    verdict,
    verdictRecord,
    reason,
    nextOwner: "Manager"
  };
}

function verifySupport(root, options) {
  const runId = safeTransportRunId(options.runId);
  const record = readRunRecord(root, runId);
  if (!record) {
    return {
      status: "missing",
      mode: "local",
      hostedMcpUsed: false,
      runId,
      error: "run not found",
      nextOwner: "Manager"
    };
  }
  return record.legacy
    ? verifyLegacySupport(root, { ...options, runId })
    : verifyCanonicalSupport(root, record, { ...options, runId });
}

function printText(payload) {
  if (payload.schema === "nogra.local.status.v1") {
    console.log("Nogra local status");
    console.log(`- Plugin: ${payload.plugin.name} ${payload.plugin.version}`);
    if (payload.workspace.mode === "invalid-config") {
      console.log(`- Workspace: invalid local config${payload.workspace.error ? ` (${payload.workspace.error})` : ""} — fix .nogra/config.json; re-running setup will not repair broken JSON`);
    } else {
      console.log(`- Workspace: ${payload.workspace.initialized ? payload.workspace.workspaceId || "local" : "not initialized"}`);
    }
    console.log(`- Control plane: ${payload.hostedMcpUsed ? "connected" : "local"}`);
    console.log(`- Bridge: ${payload.bridge?.status || "unknown"}${payload.bridge?.version ? ` ${payload.bridge.version}` : ""}`);
    console.log(`- Git: ${payload.git?.status || "unknown"}${Number.isFinite(Number(payload.git?.dirtyCount)) ? ` (${payload.git.dirtyCount})` : ""}`);
    console.log(`- Promotion: ${payload.promotion?.status || "unknown"}`);
    if (payload.continuity?.activeIntent?.exists) {
      const intent = payload.continuity.activeIntent;
      console.log(`- Active intent: ${intent.active ? "active" : intent.status || "inactive"}${intent.objective ? ` - ${intent.objective}` : ""}`);
    }
    console.log(`- Anchor: ${payload.ledger?.anchorStatus || "unknown"}${payload.ledger?.currentAnchorId ? ` (${payload.ledger.currentAnchorId})` : ""}`);
    console.log(`- Facts: ${payload.ledger?.factProjectionStatus || "unknown"} (${payload.ledger?.activeFacts || 0} active)`);
    for (const warning of payload.plugin.diagnostics?.warnings || []) {
      console.log(`- Warning: ${warning.message}`);
    }
    console.log(`- Recent briefs: ${payload.recent.briefs.length}`);
    console.log(`- Recent runs: ${(payload.recent.runs || payload.recent.transportRuns || []).length}`);
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
  } else if (command === "approval-create") {
    payload = createApproval(root, {
      briefId: options["brief-id"] || "",
      approvedBy: options["approved-by"] || options.approvedBy || "",
      expiresAt: options["expires-at"] || options.expiresAt || ""
    });
  } else if (command === "anchor-contract") {
    payload = anchorContract();
  } else if (command === "anchor-validate") {
    payload = validateAnchorPayload(root, readInput(options));
  } else if (command === "anchor-save") {
    payload = saveAnchor(root, readInput(options));
  } else if (command === "evidence-contract") {
    payload = evidenceContract();
  } else if (command === "evidence-save") {
    payload = saveEvidenceRecord(root, readInput(options));
  } else if (command === "fact-contract") {
    payload = factContract();
  } else if (command === "fact-record") {
    payload = recordFact(root, readInput(options));
  } else if (command === "fact-status") {
    payload = factStatus(root);
  } else if (command === "ledger-smoke") {
    payload = diagnosticLedgerSmoke(root, {
      label: options.label || ""
    });
  } else if (command === "transcript-diagnostic") {
    const diagnostic = analyzeTranscriptDiagnostic(root, {
      transcriptPath: options.transcript || options["transcript-path"] || "",
      sessionId: options["session-id"] || options.sessionId || ""
    });
    payload = options.write ? writeTranscriptDiagnosticReceipt(root, diagnostic) : diagnostic;
  } else if (command === "handoff-contract") {
    payload = handoffContract(root, options.kind || "executor", {
      runId: options["run-id"] || options.runId || ""
    });
  } else if (command === "role-enter") {
    payload = enterRole(root, {
      runId: options["run-id"] || options.runId || "",
      role: options.role || options.kind || "",
      expiresInMinutes: options["expires-in-minutes"] || options.expiresInMinutes || ""
    });
  } else if (command === "role-status") {
    payload = roleLeaseStatus(root);
  } else if (command === "role-exit") {
    payload = exitRole(root, {
      leaseId: options["lease-id"] || options.leaseId || "",
      reason: options.reason || ""
    });
  } else if (command === "role-report-contract") {
    payload = roleReportContract(root, options.kind || options.role || "executor", {
      runId: options["run-id"] || options.runId || "",
      leaseId: options["lease-id"] || options.leaseId || ""
    });
  } else if (command === "role-report-save") {
    payload = saveRoleReport(root, readInput(options));
  } else if (command === "dispatch") {
    payload = dispatch(root, {
      briefId: options["brief-id"] || "",
      approvalId: options["approval-id"] || options.approvalId || "",
      inputPayload: options.input ? readInput(options) : null,
      target: options.target || "",
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
