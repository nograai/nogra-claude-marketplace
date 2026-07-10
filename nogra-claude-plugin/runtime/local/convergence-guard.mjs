#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { normalizeActiveIntentGate, readActiveIntent as readActiveIntentState } from "./active-intent.mjs";

const PENDING_AUTHORIZATION_RUN_STATUSES = new Set(["queued", "running", "returning", "in_progress"]);
const TERMINAL_AUTHORIZATION_RUN_STATUSES = new Set(["returned", "ok", "partial"]);
const AUTHORIZATION_RECEIPT_TTL_MS = 12 * 60 * 60 * 1000;
// Receipt statuses that can never auto-approve an action, even when boundary
// class and scope match: the run stopped before a clean completion.
const APPROVAL_BLOCKING_RECEIPT_STATUSES = new Set(["partial", "blocked", "failed", "cancelled"]);
const GIT_RISK_SUBCOMMANDS = new Set([
  "push",
  "tag",
  "reset",
  "clean",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "checkout",
  "restore",
  "switch"
]);
// Git-write subcommands that can carry working-tree FILE targets (pathspecs):
// `checkout <ref> -- <pathspec...>`, `checkout -- <pathspec...>`,
// `checkout <ref-or-pathspec>` (git's own ambiguous single-positional form),
// `restore <pathspec...>` / `restore --source <ref> <pathspec>` /
// `restore --staged <pathspec>`, and `clean <pathspec>` (deletes untracked
// files matching the pathspec). Commands using these route by TARGET class
// (see gitWriteSurfaceTargetRisk): a git-write to a file is classified the
// SAME as a direct write to that file. Deliberately absent: `switch`
// (branch-only grammar — it never takes a pathspec, so pure branch switches
// always stay git-history) and `reset` (its pathspec forms touch the index
// only — git refuses `reset --hard` with paths — so a reset can never rewrite
// the working-tree file); push/tag/merge/rebase/cherry-pick/revert take
// refs, not pathspecs.
const FILE_TARGET_GIT_WRITE_SUBCOMMANDS = new Set([
  "checkout",
  "restore",
  "clean"
]);
const SAFE_INSPECTION_COMMANDS = new Set([
  "awk",
  "cat",
  "cut",
  "egrep",
  "fgrep",
  "find",
  "grep",
  "head",
  "jq",
  "ls",
  "nl",
  "pwd",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "tree",
  "tr",
  "true",
  "uniq",
  "wc"
]);
const SAFE_GIT_INSPECTION_SUBCOMMANDS = new Set([
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status"
]);
const INSTRUCTION_SURFACE_BASENAMES = new Set([
  "CLAUDE.md",
  "CLAUDE.local.md",
  "AGENTS.md",
  "SKILL.md",
  "plugin.json",
  "hooks.json"
]);
const CLAUDE_INSTRUCTION_SURFACE_DIRS = new Set([
  "agents",
  "commands",
  "hooks",
  "rules",
  "skills"
]);
const CLAUDE_INSTRUCTION_SURFACE_FILES = new Set([
  "settings.json",
  "settings.local.json"
]);

const DRIFT_GUARDS = [
  "A:speed-before-intent",
  "B:no-fabricated-grounding",
  "C:preserve-provenance",
  "D:respect-brief-contract",
  "E:wait-for-explicit-GO",
  "F:no-manufactured-friction",
  "G:no-bad-evidence-through",
  "H:answer-the-ask"
];

const INDEX_ANCHORS = [
  ["riskIntake", "risk-intake", ".nogra/index/risk-intake.md"],
  ["behaviorScore", "behavior-score", ".nogra/index/behavior-score.md"],
  ["riskRegistry", "risk-registry", ".nogra/index/risk-registry.md"],
  ["decisions", "decisions", ".nogra/state/DECISIONS.md"],
  ["expansions", "expansions", ".nogra/index/EXPANSIONS.md"]
];

function exists(file) {
  try {
    fs.accessSync(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(file, maxBytes = 20000) {
  const buffer = fs.readFileSync(file);
  return buffer.subarray(0, maxBytes).toString("utf8");
}

function readJsonIfValid(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function readWorkspaceConfig(root) {
  return readJsonIfValid(path.join(root, ".nogra", "config.json")) || {};
}

// Workspace gate settings. `gate` accepts the legacy string form
// ("hard"/"advisory") or an object form: { "mode": "advisory", "autoApprove": true }.
// autoApprove is the per-workspace opt-in for receipt-driven allow emission;
// default off preserves ask-only behavior exactly.
function gateSettings(root) {
  const config = readWorkspaceConfig(root);
  const raw = config.gate;
  const gateObject = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const modeSource = typeof raw === "string" ? raw : gateObject.mode;
  return {
    mode: cleanInline(modeSource).toLowerCase() === "hard" ? "hard" : "advisory",
    // Default OFF is locked by doctrine — do not flip. Only literal true
    // opts this workspace into receipt-driven allow emission.
    autoApprove: gateObject.autoApprove === true
  };
}

function readActiveIntent(root) {
  const state = readActiveIntentState(root);
  if (!state || !state.active || !state.intent) return null;
  const gate = normalizeActiveIntentGate(state.intent);
  if (!gate.authorize.length && !gate.nonGoals.length) return null;
  return gate;
}

function boundaryClass(risk, name, payload = {}) {
  // gate-arming is never auto-approvable — locked by doctrine; do not add it
  // to any approval path. The mapping stays first so no other class label can
  // shadow a write to the gate's own arming surface.
  if (risk === "gate-arming write") return "gate-arming";
  const fp = cleanInline(payload.file_path || payload.path || "").toLowerCase();
  if (fp.includes("boligscout")) return "boligscout";
  if (/^git /u.test(risk)) return "git-history";
  if (risk === "production deploy") return "production-deploy";
  if (risk === "instruction-surface write") return "instruction-surface";
  if (risk === "data migration" || risk === "database mutation") return "data-migration";
  if (risk === "customer/billing action") return "billing";
  if (risk === "destructive rm" || risk === "find action") return "destructive-write";
  return cleanInline(risk);
}

function nonGoalViolation(intent, cls, name, payload = {}) {
  if (!intent || !intent.nonGoals.length) return "";
  const text = (cleanInline(payload.file_path || payload.path || "") + " " + cleanInline(payload.command || "")).toLowerCase();
  for (const label of intent.nonGoals) {
    if (!label) continue;
    if (cls && cls === label) return label;
    if (text.includes(label)) return label;
  }
  return "";
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeScopeList(value, lowercase = false) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const cleaned = cleanInline(entry);
      return lowercase ? cleaned.toLowerCase() : cleaned;
    })
    .filter(Boolean)
    .slice(0, 64);
}

function escapeScopeRegExpChar(char) {
  return /[.*+?^${}()|[\]\\]/u.test(char) ? `\\${char}` : char;
}

// Deterministic glob for receipt scope patterns: `**` matches anything,
// `*` matches anything except `/`, `?` matches one non-`/` character.
function scopePatternRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeScopeRegExpChar(char);
    }
  }
  try {
    return new RegExp(`^${source}$`, "u");
  } catch {
    return null;
  }
}

// The concrete target a scope pattern must cover: the command string for
// Bash, the file path for write tools.
function scopeActionTarget(name, payload = {}) {
  if (name === "Bash") return cleanInline(payload.command || "");
  return cleanInline(payload.file_path || payload.path || "");
}

function relativeScopeTarget(root, target) {
  if (!root || !path.isAbsolute(target)) return "";
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith("..")) return "";
  return relative.replaceAll("\\", "/");
}

function matchesScopePatterns(root, target, patterns) {
  const normalizedTarget = cleanInline(target).replaceAll("\\", "/");
  if (!normalizedTarget || !Array.isArray(patterns) || !patterns.length) return false;
  const candidates = [normalizedTarget];
  const relative = relativeScopeTarget(root, normalizedTarget);
  if (relative) candidates.push(relative);
  return patterns.some((pattern) => {
    const regex = scopePatternRegExp(pattern);
    return Boolean(regex) && candidates.some((candidate) => regex.test(candidate));
  });
}

// Receipt-side boundary/scope check. A receipt only matches an action when it
// declares authorizedBoundaries AND the action's boundary class is covered AND
// the target matches a declared scope pattern. Everything else degrades to ask.
function receiptBoundaryScopeMatch(root, receipt, cls, target) {
  const boundaries = Array.isArray(receipt.authorizedBoundaries) ? receipt.authorizedBoundaries : [];
  const patterns = Array.isArray(receipt.scopePatterns) ? receipt.scopePatterns : [];
  // gate-arming is never auto-approvable — locked by doctrine; do not add it
  // to any approval path. Even a receipt that explicitly lists gate-arming in
  // authorizedBoundaries (with a covering scope pattern) must never match:
  // changing the gate's rules is the meta-action and only a live human
  // approval opens that door.
  if (cls === "gate-arming") return { matched: false, kind: "gate-arming", boundaries, patterns };
  if (!boundaries.length) return { matched: false, kind: "unscoped", boundaries, patterns };
  if (!cls || !boundaries.includes(cls)) return { matched: false, kind: "boundary-miss", boundaries, patterns };
  if (!patterns.length || !matchesScopePatterns(root, target, patterns)) {
    return { matched: false, kind: "scope-miss", boundaries, patterns };
  }
  return { matched: true, kind: "match", boundaries, patterns };
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function parseTimeMs(value) {
  const timestamp = Date.parse(cleanInline(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function runTimestampMs(run) {
  return parseTimeMs(run.updatedAt) || parseTimeMs(run.createdAt) || run.mtimeMs || 0;
}

function ledgerWatermark(root) {
  const file = path.join(root, ".nogra", "ledger", "events.jsonl");
  if (!exists(file)) return 0;
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).length;
}

function checkpointSourceWatermark(root) {
  const file = path.join(root, ".nogra", "state", "SESSION-CHECKPOINT.md");
  if (!exists(file)) return 0;
  const match = readText(file, 6000).match(/^SourceWatermark:\s*(\d+)\s*$/imu);
  return match ? Number(match[1]) : 0;
}

function listTransportRuns(root) {
  const dir = path.join(root, ".nogra", "transport", "runs");
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(dir, name);
      const payload = readJsonIfValid(file) || {};
      return {
        runId: cleanInline(payload.runId || name.replace(/\.json$/u, "")),
        briefId: cleanInline(payload.briefId || ""),
        title: cleanInline(payload.title || payload.metadata?.title || ""),
        objective: cleanInline(payload.objective || payload.metadata?.objective || ""),
        target: cleanInline(payload.target || payload.targetRole || ""),
        targetRole: cleanInline(payload.targetRole || payload.target || payload.metadata?.targetRole || ""),
        status: cleanInline(payload.status || ""),
        phase: cleanInline(payload.phase || ""),
        owner: cleanInline(payload.owner || payload.metadata?.owner || ""),
        nextOwner: cleanInline(payload.nextOwner || payload.metadata?.nextOwner || ""),
        stopReason: cleanInline(payload.stopReason || payload.metadata?.stopReason || ""),
        returnReason: cleanInline(payload.returnReason || payload.reason || payload.metadata?.returnReason || payload.metadata?.reason || ""),
        pendingState: cleanInline(payload.pendingState || payload.metadata?.pendingState || ""),
        authorizedBoundaries: normalizeScopeList(payload.authorizedBoundaries ?? payload.metadata?.authorizedBoundaries, true),
        scopePatterns: normalizeScopeList(payload.scope ?? payload.metadata?.scope),
        scratchRoots: normalizeScopeList(payload.scratchRoots ?? payload.metadata?.scratchRoots),
        createdAt: cleanInline(payload.createdAt || ""),
        updatedAt: cleanInline(payload.updatedAt || payload.createdAt || ""),
        topLevelRequiresManagerDecision: Boolean(payload.requiresManagerDecision),
        executionSizing: payload.executionSizing && typeof payload.executionSizing === "object" ? payload.executionSizing : {},
        executionCrossing: payload.executionCrossing && typeof payload.executionCrossing === "object" ? payload.executionCrossing : {},
        metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
        paths: payload.paths && typeof payload.paths === "object" ? payload.paths : {},
        artifacts: payload.artifacts && typeof payload.artifacts === "object" ? payload.artifacts : {},
        file,
        mtimeMs: mtimeMs(file)
      };
    })
    .filter((run) => run.runId)
    .map((run) => ({
      ...run,
      updatedAtMs: runTimestampMs(run),
      requiresManagerDecision: Boolean(
        run.topLevelRequiresManagerDecision ||
          run.executionSizing?.requiresManagerDecision ||
          run.metadata?.executionSizing?.requiresManagerDecision ||
          run.metadata?.requiresManagerDecision ||
          run.executionCrossing?.sizingDecisionRequired
      )
    }))
    .sort((a, b) => (b.updatedAtMs || b.mtimeMs) - (a.updatedAtMs || a.mtimeMs));
}

function currentActionReceipt(root) {
  return authorizationReceiptAssessment(root).currentActionReceipt;
}

function isPendingAuthorizationStatus(status) {
  return PENDING_AUTHORIZATION_RUN_STATUSES.has(cleanInline(status).toLowerCase());
}

function isTerminalAuthorizationStatus(status) {
  return TERMINAL_AUTHORIZATION_RUN_STATUSES.has(cleanInline(status).toLowerCase());
}

function isPotentialAuthorizationStatus(status) {
  return isPendingAuthorizationStatus(status) || isTerminalAuthorizationStatus(status);
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 72) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function artifactPath(root, run, key) {
  const value = cleanInline(run.paths?.[key] || "");
  if (value) return path.join(root, value);
  return "";
}

function hasTerminalEvidence(root, run) {
  if (run.artifacts?.reportExists || run.artifacts?.outputExists || run.artifacts?.validationExists) return true;
  return ["report", "output", "validation"].some((key) => {
    const file = artifactPath(root, run, key);
    return file && exists(file);
  });
}

function laterTerminalRunForSameBrief(run, runs) {
  if (!run.briefId) return null;
  const runTime = run.updatedAtMs || run.mtimeMs || 0;
  return runs.find((candidate) => {
    if (candidate.runId === run.runId || candidate.briefId !== run.briefId) return false;
    if (!isTerminalAuthorizationStatus(candidate.status)) return false;
    const candidateTime = candidate.updatedAtMs || candidate.mtimeMs || 0;
    return candidateTime > runTime;
  }) || null;
}

function authorizationReceiptIssue(root, run, runs, nowMs = Date.now()) {
  const status = run.status.toLowerCase();
  if (!isPotentialAuthorizationStatus(status)) return `status ${run.status || "missing"} is not an authorization state`;
  if (!run.briefId) return "missing brief scope";
  if (run.requiresManagerDecision) return "requiresManagerDecision=true";
  if (isPendingAuthorizationStatus(status) && !run.nextOwner.startsWith("nogra:")) {
    return `pending nextOwner=${run.nextOwner || "missing"}`;
  }
  const ageMs = nowMs - (run.updatedAtMs || run.mtimeMs || nowMs);
  if (ageMs > AUTHORIZATION_RECEIPT_TTL_MS) return `stale ${formatAge(ageMs)} receipt`;
  const supersedingRun = laterTerminalRunForSameBrief(run, runs);
  if (supersedingRun) return `superseded by ${supersedingRun.runId}`;
  if (isTerminalAuthorizationStatus(status) && !hasTerminalEvidence(root, run)) {
    return "terminal receipt has no report/output/validation artifact";
  }
  return "";
}

function decorateReceipt(root, run, runs, issue = "") {
  const nowMs = Date.now();
  const ageMs = nowMs - (run.updatedAtMs || run.mtimeMs || nowMs);
  return {
    ...run,
    ageMs,
    age: formatAge(ageMs),
    authorizationIssue: issue || authorizationReceiptIssue(root, run, runs, nowMs)
  };
}

function authorizationReceiptAssessment(root) {
  const runs = listTransportRuns(root);
  const assessed = runs
    .filter((run) => isPotentialAuthorizationStatus(run.status))
    .map((run) => {
      const issue = authorizationReceiptIssue(root, run, runs);
      return decorateReceipt(root, run, runs, issue);
    });
  if (!assessed.length) {
    return {
      currentActionReceipt: null,
      candidateActionReceipt: null,
      transportRuns: runs
    };
  }
  const validReceipt = assessed.find((run) => !run.authorizationIssue) || null;
  const invalidPendingReceipt = assessed.find((run) => run.authorizationIssue && isPendingAuthorizationStatus(run.status)) || null;
  const invalidReceipt = invalidPendingReceipt || assessed.find((run) => run.authorizationIssue) || null;
  const validTime = validReceipt ? validReceipt.updatedAtMs || validReceipt.mtimeMs || 0 : 0;
  const invalidPendingTime = invalidPendingReceipt ? invalidPendingReceipt.updatedAtMs || invalidPendingReceipt.mtimeMs || 0 : 0;
  if (validReceipt && (!invalidPendingReceipt || validTime >= invalidPendingTime)) {
    return {
      currentActionReceipt: validReceipt,
      candidateActionReceipt: null,
      transportRuns: runs
    };
  }
  const candidateReceipt = invalidReceipt && invalidReceipt.ageMs <= AUTHORIZATION_RECEIPT_TTL_MS ? invalidReceipt : null;
  return {
    currentActionReceipt: null,
    candidateActionReceipt: candidateReceipt,
    transportRuns: runs
  };
}

function resolveIndexAnchors(root) {
  const config = readWorkspaceConfig(root);
  const configuredPaths = config.paths && typeof config.paths === "object" ? config.paths : {};
  const files = INDEX_ANCHORS.map(([key, label, fallbackPath]) => {
    const relativePath = cleanInline(configuredPaths[key]) || fallbackPath;
    const file = path.join(root, relativePath);
    return {
      key,
      label,
      path: relativePath,
      exists: exists(file)
    };
  });
  return {
    files,
    existing: files.filter((file) => file.exists),
    missing: files.filter((file) => !file.exists),
    status: files.every((file) => file.exists) ? "ready" : "degraded"
  };
}

function latestBrief(root) {
  const dir = path.join(root, ".nogra", "briefs");
  if (!exists(dir)) return null;
  const entries = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const file = path.join(dir, name);
      return {
        briefId: name.replace(/\.md$/u, ""),
        path: path.join(".nogra", "briefs", name),
        mtimeMs: mtimeMs(file)
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0] || null;
}

export function resolveConvergenceGuard({ root } = {}) {
  const workspaceRoot = root ? path.resolve(root) : process.cwd();
  const currentLedgerWatermark = ledgerWatermark(workspaceRoot);
  const checkpointWatermark = checkpointSourceWatermark(workspaceRoot);
  const receiptAssessment = authorizationReceiptAssessment(workspaceRoot);
  return {
    workspaceRoot,
    currentActionReceipt: receiptAssessment.currentActionReceipt,
    candidateActionReceipt: receiptAssessment.candidateActionReceipt,
    transportRuns: receiptAssessment.transportRuns,
    latestBrief: latestBrief(workspaceRoot),
    index: resolveIndexAnchors(workspaceRoot),
    ledgerWatermark: currentLedgerWatermark,
    checkpointSourceWatermark: checkpointWatermark,
    checkpointStatus: currentLedgerWatermark > checkpointWatermark ? "stale" : "fresh",
    driftGuards: DRIFT_GUARDS
  };
}

export function renderConvergenceGuardContext({ root, eventName = "SessionStart" } = {}) {
  const guard = resolveConvergenceGuard({ root });
  const receipt = guard.currentActionReceipt;
  const candidate = guard.candidateActionReceipt;
  const brief = guard.latestBrief;
  const compaction = eventName === "PostCompact";
  const indexAnchors = guard.index.existing.map((file) => file.label).join(",") || "none";
  const indexPaths = guard.index.existing.map((file) => file.path).join(",") || "none";
  const missingIndexPaths = guard.index.missing.map((file) => file.path).join(",") || "none";
  const lines = [
    "<NOGRA_CONVERGENCE_GUARD>",
    "Nogra convergence: user intent and Claude action meet in Nogra before git/action risk.",
    `event=${eventName}`,
    `workspaceRoot=${guard.workspaceRoot}`,
    `ledgerWatermark=${guard.ledgerWatermark}`,
    `checkpointSourceWatermark=${guard.checkpointSourceWatermark}`,
    `checkpointStatus=${guard.checkpointStatus}`,
    `currentActionReceipt=${receipt ? receipt.runId : "none"}`,
    `currentActionStatus=${receipt ? receipt.status : "none"}`,
    `currentActionAge=${receipt ? receipt.age : "none"}`,
    `currentActionBrief=${receipt?.briefId || "none"}`,
    `candidateActionReceipt=${candidate ? candidate.runId : "none"}`,
    `candidateActionStatus=${candidate ? candidate.status : "none"}`,
    `candidateActionAge=${candidate ? candidate.age : "none"}`,
    `candidateActionIssue=${candidate?.authorizationIssue || "none"}`,
    `latestBrief=${brief ? brief.briefId : "none"}`,
    `latestBriefPath=${brief ? brief.path : "none"}`,
    "briefIsNotGO=true",
    `compactionDriftBoundary=${compaction ? "true" : "false"}`,
    `driftGuards=${guard.driftGuards.join(",")}`,
    `indexStatus=${guard.index.status}`,
    `indexAnchors=${indexAnchors}`,
    `indexPaths=${indexPaths}`,
    `missingIndexPaths=${missingIndexPaths}`,
    "riskBoundaries=git-history,destructive-write,production-deploy,data-migration,secrets,permissions,billing,customer-send",
    "rule=If a risk boundary has no currentActionReceipt, stop before the tool call and ask for explicit intent/GO or create/dispatch a Nogra brief.",
    "</NOGRA_CONVERGENCE_GUARD>"
  ];
  return lines.join("\n");
}

export function renderCacheSafeConvergenceGuardContext({ root, eventName = "SessionStart" } = {}) {
  const workspaceRoot = root ? path.resolve(root) : process.cwd();
  const compaction = eventName === "PostCompact";
  // Visibility clause: a standing delegation must never be ambient. When the
  // autoApprove opt-in is ON, name it here; when it is off (the default),
  // emit nothing so the rendered output stays byte-identical for default
  // workspaces (no cache invalidation, no behavior change). The line derives
  // ONLY from .nogra/config.json — semi-static, the same cache class as
  // workspaceId. Never surface ledger/transport/runtime state here: that
  // would break the prompt-cache-safe boot design.
  const settings = gateSettings(workspaceRoot);
  const delegations = [
    ...(settings.autoApprove ? ["autoApprove"] : [])
  ];
  const lines = [
    "<NOGRA_CONVERGENCE_GUARD>",
    "Nogra convergence: user intent and Claude action meet in Nogra before git/action risk.",
    "cacheSafe=true",
    `event=${eventName}`,
    `workspaceRoot=${workspaceRoot}`,
    "briefIsNotGO=true",
    ...(delegations.length ? [`gateDelegations=${delegations.join(",")}`] : []),
    `compactionDriftBoundary=${compaction ? "true" : "false"}`,
    `driftGuards=${DRIFT_GUARDS.join(",")}`,
    "riskBoundaries=git-history,destructive-write,production-deploy,data-migration,secrets,permissions,billing,customer-send",
    "stateInstruction=Read project-local .nogra/state files, /nogra:status, and current git state before current-state claims.",
    "rule=If a risk boundary has no current dispatch receipt, stop before the tool call and ask for explicit intent/GO or create/dispatch a Nogra brief.",
    "</NOGRA_CONVERGENCE_GUARD>"
  ];
  return lines.join("\n");
}

function shellWords(command) {
  const words = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/gu;
  let match;
  while ((match = pattern.exec(command))) {
    words.push(cleanInline(match[1] ?? match[2] ?? match[3]));
  }
  return words.filter(Boolean);
}

function gitRisk(command) {
  const words = shellWords(command);
  const riskySubcommands = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "git") continue;
    let subcommand = "";
    for (let cursor = index + 1; cursor < words.length; cursor += 1) {
      const word = words[cursor];
      if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(word)) {
        cursor += 1;
        continue;
      }
      if (word.startsWith("--git-dir=") || word.startsWith("--work-tree=") || word.startsWith("--namespace=")) {
        continue;
      }
      if (word.startsWith("-")) continue;
      subcommand = word;
      break;
    }
    if (subcommand && GIT_RISK_SUBCOMMANDS.has(subcommand)) {
      riskySubcommands.push(subcommand);
    }
  }
  if (!riskySubcommands.length) return "";
  // Consistency rule: a git-write that can carry a file target and TARGETS an
  // instruction surface is classified the same as a direct write to that
  // file — config.json targets become gate-arming (never approvable), other
  // instruction surfaces become instruction-surface (receipt-approvable like
  // a direct Edit). Every subcommand in the command is considered so a
  // compound command cannot hide the stricter class behind an earlier,
  // weaker git-write. gate-arming is never auto-approvable — locked by
  // doctrine; do not add it to any approval path.
  if (riskySubcommands.some((subcommand) => FILE_TARGET_GIT_WRITE_SUBCOMMANDS.has(subcommand))) {
    const surfaceRisk = gitWriteSurfaceTargetRisk(command, words);
    if (surfaceRisk) return surfaceRisk;
  }
  return `git ${riskySubcommands[0]}`;
}

// Target routing for git-writes that can carry file targets (the consistency
// rule): a git-write to a file is classified the SAME as a direct write to
// that file. Grammar covered: `checkout <ref> -- <pathspec...>`,
// `checkout -- <pathspec...>`, `checkout <ref-or-pathspec>` (git's own
// ambiguous single-positional form), `restore <pathspec...>`,
// `restore --source <ref>|--source=<ref> <pathspec>`,
// `restore --staged <pathspec>`, `clean <pathspec>`, with `git -C <dir>`
// prefixes, flag noise, and `NAME=value` env-assignment prefixes tolerated.
// Instead of a positional parser (whose failure modes could leak a permissive
// classification), every shell word — and the value side of any word carrying
// `=` — is classified through the SAME path-risk check as a direct write
// (pathRisk), plus a whole-command substring net for the arming surface.
// This is the fail-closed superset of positional parsing: every extracted
// pathspec is a shell word, an unparseable or indirected target that still
// textually names a surface routes to the stricter class (config.json
// mention wins as gate-arming), and a token naming no surface can only fall
// back to git-history exactly as before. Deliberate consequences, documented:
// a ref that merely LOOKS like a surface path (git checkout hooks.json) asks
// as instruction-surface (receipt-approvable, one ask), and a compound
// command mentioning .nogra/config.json anywhere alongside a
// file-target-capable git-write asks as gate-arming. Pure branch switches
// (git checkout main, git switch feature) name no surface and stay
// git-history byte-identically. Only the two surface classes route; every
// other pathRisk label (secrets/env, git metadata, risk-file heuristics)
// deliberately stays git-history so this change closes exactly one window.
// gate-arming is never auto-approvable — locked by doctrine; do not add it
// to any approval path.
function gitWriteSurfaceTargetRisk(command, words) {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes(".nogra/config.json")) return "gate-arming write";
  let surfaceRisk = "";
  for (const word of words) {
    const candidates = [word];
    const assignmentIndex = word.indexOf("=");
    if (assignmentIndex > 0 && assignmentIndex < word.length - 1) {
      candidates.push(word.slice(assignmentIndex + 1));
    }
    for (const candidate of candidates) {
      const risk = directWriteSurfaceRisk(candidate);
      if (risk === "gate-arming write") return risk;
      if (risk) surfaceRisk = risk;
    }
  }
  return surfaceRisk;
}

// The consistency rule's check: reuse the direct-write path-risk check
// (pathRisk) verbatim so a git-write target and a direct Edit of the same
// file can never diverge, and honor ONLY its two surface classes.
function directWriteSurfaceRisk(target) {
  const risk = pathRisk("Bash", { file_path: target });
  return risk === "gate-arming write" || risk === "instruction-surface write" ? risk : "";
}

function psqlMutationRisk(command) {
  const words = shellWords(command);
  if (!words.some((word) => path.basename(word).toLowerCase() === "psql")) return "";
  const sqlFragments = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const lower = word.toLowerCase();
    if (lower === "-c" || lower === "--command") {
      sqlFragments.push(words[index + 1] || "");
      index += 1;
      continue;
    }
    if (lower.startsWith("--command=")) {
      sqlFragments.push(word.slice("--command=".length));
    }
  }
  const sqlText = sqlFragments.length ? sqlFragments.join(" ") : command;
  return /\b(?:insert|update|delete|alter|drop|truncate|create|grant|revoke)\b/iu.test(sqlText)
    ? "database mutation"
    : "";
}

function findActionRisk(command) {
  const words = shellWords(command);
  for (let index = 0; index < words.length; index += 1) {
    if (path.basename(words[index]).toLowerCase() !== "find") continue;
    const findArgs = words.slice(index + 1);
    if (findArgs.some((word) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word))) {
      return "find action";
    }
  }
  return "";
}

function splitShellList(command) {
  const segments = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "`") return null;
    if (char === "$" && command[index + 1] === "(") return null;
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === "<") return null;
    if (char === ";") {
      segments.push(current.trim());
      current = "";
      continue;
    }
    if (char === "&") {
      if (command[index + 1] !== "&") return null;
      segments.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    if (char === "|" && command[index + 1] === "|") {
      segments.push(current.trim());
      current = "";
      index += 1;
      continue;
    }
    current += char;
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

function stripSafeInspectionRedirects(words) {
  const stripped = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "2>/dev/null" || word === "2>&1") continue;
    if (word === "2>" && words[index + 1] === "/dev/null") {
      index += 1;
      continue;
    }
    if (/(?:^|[^-])(?:\d?>|>>|&>)/u.test(word)) return null;
    stripped.push(word);
  }
  return stripped;
}

function safeGitInspection(words) {
  let subcommand = "";
  let cursor = 1;
  for (; cursor < words.length; cursor += 1) {
    const word = words[cursor];
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(word)) {
      cursor += 1;
      continue;
    }
    if (word.startsWith("--git-dir=") || word.startsWith("--work-tree=") || word.startsWith("--namespace=")) {
      continue;
    }
    if (word.startsWith("-")) continue;
    subcommand = word;
    break;
  }
  if (!SAFE_GIT_INSPECTION_SUBCOMMANDS.has(subcommand)) return false;
  return !words.slice(cursor + 1).some((word) => word === "--output" || word.startsWith("--output="));
}

function readOnlyInspectionSimpleCommand(segment) {
  const words = stripSafeInspectionRedirects(shellWords(segment));
  if (!words || !words.length) return false;
  const commandName = path.basename(words[0]).toLowerCase();
  if (commandName === "git") return safeGitInspection(words);
  if (!SAFE_INSPECTION_COMMANDS.has(commandName)) return false;
  if (commandName === "sed" && words.some((word) => word === "-i" || word.startsWith("-i."))) return false;
  if (commandName === "find" && words.some((word) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word))) return false;
  return true;
}

function readOnlyInspectionCommand(command) {
  const listSegments = splitShellList(command);
  if (!listSegments?.length) return false;
  return listSegments.every((listSegment) => {
    const pipeline = splitShellPipeline(listSegment);
    return Boolean(pipeline?.length) && pipeline.every(readOnlyInspectionSimpleCommand);
  });
}

// Write indicators for the gate-arming textual Bash check: a shell redirect
// (excluding plain stderr noise like `2>/dev/null` / `2>&1`), `tee`,
// `sed -i`, or `cp`/`mv` anywhere in the command. Deliberately coarse:
// v1 covers the listed indicators only. `git checkout/restore/clean` of the
// file — formerly a receipt-approvable git-history detour — is CLOSED: those
// commands now route by target class in gitRisk (see
// gitWriteSurfaceTargetRisk), so a config.json target classifies as
// gate-arming there. Known remaining vectors (accepted, documented rather
// than over-engineered): interpreter one-liners writing the file from inside
// node/python/perl, `dd of=...`, `rsync`/`install` onto the path,
// quote-splicing obfuscation of the path itself, and git-writes that reach
// the file without naming it — directory/glob pathspecs
// (`git checkout -- .nogra/`, `.nogra/config.*`) and `--pathspec-from-file`
// lists (all still git-history and asking without a matching receipt).
function hasGateArmingWriteIndicator(command) {
  const withoutStderrNoise = command
    .replace(/\s2>\s*\/dev\/null/gu, " ")
    .replace(/\s2>&1\b/gu, " ");
  if (/(?:^|\s)(?:\d?>{1,2}|&>{1,2})/u.test(withoutStderrNoise)) return true;
  const words = shellWords(command);
  const names = words.map((word) => path.basename(word).toLowerCase());
  if (names.includes("tee") || names.includes("cp") || names.includes("mv")) return true;
  if (names.includes("sed") && words.some((word) => word === "-i" || word.startsWith("-i."))) return true;
  return false;
}

// gate-arming (Bash side): pragmatic TEXTUAL detection — the command mentions
// a .nogra/config.json path AND carries a write indicator. Shell redirect
// targets are not path-mapped, so the FILE mention itself is the boundary;
// slightly over-broad is the correct trade (config writes are rare and meta).
// Read-only mentions (cat/grep/jq of the config) carry no write indicator and
// never trigger. gate-arming is never auto-approvable — locked by doctrine;
// do not add it to any approval path.
function gateArmingCommandRisk(command) {
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes(".nogra/config.json")) return "";
  return hasGateArmingWriteIndicator(command) ? "gate-arming write" : "";
}

function commandRisk(command) {
  const cleaned = cleanInline(command);
  if (!cleaned) return "";
  // gate-arming detection runs FIRST so no other risk label (e.g. a git
  // subcommand touching the config) can shadow it into a receipt-approvable
  // class. gate-arming is never auto-approvable — locked by doctrine; do not
  // add it to any approval path.
  const gateArming = gateArmingCommandRisk(cleaned);
  if (gateArming) return gateArming;
  const git = gitRisk(cleaned);
  if (git) return git;
  const psqlMutation = psqlMutationRisk(cleaned);
  if (psqlMutation) return psqlMutation;
  const findAction = findActionRisk(cleaned);
  if (findAction) return findAction;
  if (readOnlyInspectionCommand(cleaned)) return "";
  const curlPipe = curlPipelineRisk(cleaned);
  if (curlPipe) return curlPipe;
  if (/\brm\s+-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/u.test(cleaned)) return "destructive rm";
  if (/\b(?:vercel|wrangler|firebase|netlify)\b[\s\S]*\bdeploy\b/u.test(cleaned)) return "production deploy";
  if (/\bvercel\b/u.test(cleaned) && /(?:^|\s)--prod(?:\s|$)/u.test(cleaned)) return "production deploy";
  if (/\b(?:supabase|prisma)\b[\s\S]*\b(?:db\s+push|migrate|reset)\b/u.test(cleaned)) return "data migration";
  if (/\b(?:stripe|customer|email|sendgrid|postmark)\b/u.test(cleaned) && /\b(?:send|create|delete|refund|charge)\b/u.test(cleaned)) return "customer/billing action";
  if (/\b(?:gh|hub)\b[\s\S]*\b(?:release\s+create|pr\s+merge)\b/u.test(cleaned)) return "repository release/merge";
  return "";
}

function hasShellWriteRedirect(command) {
  return /(?:^|\s)(?:\d?>|>>|&>)/u.test(command);
}

function splitShellPipeline(command) {
  const segments = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      current += char;
      quote = char;
      continue;
    }
    if (char === "|") {
      if (command[index - 1] === "|" || command[index + 1] === "|") return null;
      segments.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

function hasUnsafeShellControl(command) {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") return true;
    if (char === "$" && command[index + 1] === "(") return true;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ";" || char === "&" || char === "<") return true;
    if (char === "|" && command[index + 1] === "|") return true;
  }
  return false;
}

function firstCommand(segment) {
  const words = shellWords(segment);
  if (!words.length) return "";
  return path.basename(words[0]).toLowerCase();
}

function hasCurlSegment(segment) {
  return shellWords(segment).some((word) => path.basename(word).toLowerCase() === "curl");
}

function interpreterExecutesStdin(segment) {
  // A bare interpreter (no inline script and no script-file argument) reads its
  // piped stdin AS the program to run — genuine remote code execution when fed
  // from curl (e.g. `curl … | sh`). An interpreter given an inline script
  // (-c/-e/--command/--eval) or a local script-file argument instead runs LOCAL
  // code and treats the piped bytes as plain DATA on stdin
  // (e.g. `curl … | python3 -c 'json.load(sys.stdin)'`) — data parsing, not
  // remote execution. Only the former is a "remote execution pipe".
  const rest = shellWords(segment).slice(1);
  const inlineScriptFlags = new Set(["-c", "-e", "--command", "--eval"]);
  for (const word of rest) {
    if (inlineScriptFlags.has(word)) return false;
    if (word.startsWith("-c") && word.length > 2) return false;
    if (word.startsWith("-e") && word.length > 2) return false;
    if (word === "-") return true;
    if (!word.startsWith("-")) return false;
  }
  return true;
}

function curlPipelineRisk(command) {
  const segments = splitShellPipeline(command);
  if (!segments || segments.length < 2 || !hasCurlSegment(segments[0])) return "";
  const writeSinks = new Set(["tee", "sponge"]);
  const executors = new Set(["bash", "sh", "zsh", "fish", "node", "python", "python3", "ruby", "perl", "php", "osascript"]);
  for (const segment of segments.slice(1)) {
    const commandName = firstCommand(segment);
    if (writeSinks.has(commandName)) return "shell write sink";
    if (executors.has(commandName) && interpreterExecutesStdin(segment)) return "remote execution pipe";
  }
  return "";
}

function hasUnsafePublicFetchPipeline(command) {
  const segments = splitShellPipeline(command);
  if (!segments) return true;
  if (segments.length <= 1) return false;
  const safeInspectCommands = new Set(["awk", "cat", "cut", "egrep", "fgrep", "grep", "head", "jq", "nl", "rg", "sed", "sort", "tail", "tr", "uniq", "wc"]);
  for (const segment of segments.slice(1)) {
    const words = shellWords(segment);
    const commandName = firstCommand(segment);
    if (!safeInspectCommands.has(commandName)) return true;
    if (commandName === "sed" && words.some((word) => word === "-i" || word.startsWith("-i."))) return true;
  }
  return false;
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host === "::1") return false;
    if (/^(?:127|10)\./u.test(host)) return false;
    if (/^192\.168\./u.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./u);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

function hasCurlCredentialSignal(words) {
  const joined = words.join(" ").toLowerCase();
  if (/(?:authorization|cookie|x-api-key|api[_-]?key|access[_-]?token|bearer|oauth|token=|password=)/u.test(joined)) return true;
  return words.some((word, index) => {
    const lower = word.toLowerCase();
    if (["-u", "--user", "-b", "--cookie", "--oauth2-bearer", "--aws-sigv4"].includes(lower)) return true;
    if (["-h", "--header"].includes(lower)) {
      const next = String(words[index + 1] || "").toLowerCase();
      return /authorization|cookie|x-api-key/u.test(next);
    }
    return false;
  });
}

function hasCurlMutationSignal(words) {
  for (let index = 0; index < words.length; index += 1) {
    const raw = words[index];
    const word = raw.toLowerCase();
    if (["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--form", "--upload-file", "-o", "--output", "--remote-name", "--create-dirs"].includes(word)) {
      return true;
    }
    if (["-F", "-T", "-O"].includes(raw)) {
      return true;
    }
    if (word.startsWith("--data") || word.startsWith("--form")) return true;
    if (["-x", "--request"].includes(word)) {
      const method = String(words[index + 1] || "").toUpperCase();
      if (method && !["GET", "HEAD", "OPTIONS"].includes(method)) return true;
    }
    if (word.startsWith("--request=")) {
      const method = word.slice("--request=".length).toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) return true;
    }
    if (word.startsWith("-x") && word.length > 2) {
      const method = raw.slice(2).toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) return true;
    }
  }
  return false;
}

function publicFetchClassification(command) {
  const cleaned = cleanInline(command);
  if (!cleaned || hasShellWriteRedirect(cleaned) || hasUnsafeShellControl(cleaned) || hasUnsafePublicFetchPipeline(cleaned)) return null;
  const words = shellWords(cleaned);
  const curlIndex = words.findIndex((word) => path.basename(word).toLowerCase() === "curl");
  if (curlIndex === -1) return null;
  const url = words.find((word) => /^https?:\/\//iu.test(word));
  if (!url || !isPublicHttpUrl(url)) return null;
  if (hasCurlCredentialSignal(words) || hasCurlMutationSignal(words)) return null;
  return {
    state: "approved",
    risk: "low",
    authorization: "high",
    actionType: "read-only public fetch",
    mutation: "none",
    credentials: "none detected",
    reason: "read-only fetch of a public URL for inspection, with no credential flags or data mutation detected"
  };
}

function actionImpact(actionType) {
  const action = cleanInline(actionType).toLowerCase();
  if (action === "read-only public fetch") {
    return "reads a public URL for inspection; no mutation or credentials detected";
  }
  if (action === "git commit") {
    return "creates a local commit; no push, deploy, or live-system change";
  }
  if (action === "git push") {
    return "publishes commits to a remote branch and may trigger CI or deploy workflows";
  }
  if (action === "git tag") {
    return "creates or changes Git tag metadata; remote publication depends on the command";
  }
  if (["git reset", "git clean", "git checkout", "git restore", "git switch"].includes(action)) {
    return "changes local working tree or Git state; reversibility depends on the command";
  }
  if (["git merge", "git rebase", "git cherry-pick", "git revert"].includes(action)) {
    return "changes local Git history or working tree state; review conflicts and scope before proceeding";
  }
  if (action === "destructive rm") {
    return "may delete local files recursively or forcefully; reversibility may be low";
  }
  if (action === "find action") {
    return "may delete files or execute commands through find; reversibility may be low";
  }
  if (action === "production deploy") {
    return "may change the public production surface";
  }
  if (action === "data migration") {
    return "may mutate persisted schema or data; reversibility may be low";
  }
  if (action === "database mutation") {
    return "may mutate database rows or schema; reversibility depends on backups and environment";
  }
  if (action === "customer/billing action") {
    return "may change customer, payment, or outbound communication state";
  }
  if (action === "repository release/merge") {
    return "publishes repository state or merges code on the remote platform";
  }
  if (action === "remote execution pipe") {
    return "executes code fetched from a public URL in a local shell/runtime";
  }
  if (action === "shell write sink") {
    return "writes fetched output into the local filesystem";
  }
  if (action === "instruction-surface write") {
    return "changes instructions, hooks, skills, or plugin metadata that can affect agent behavior";
  }
  if (action === "gate-arming write") {
    return "can change standing delegations (autoApprove) — the rules the gate itself enforces";
  }
  if (action === "git metadata write") {
    return "writes inside Git metadata; repository integrity or history can be affected";
  }
  if (action === "secrets/env write") {
    return "changes secrets or environment configuration";
  }
  if (action.endsWith(" risk file")) {
    return "edits a sensitive project area such as migrations, auth, billing, or permissions";
  }
  return "may mutate workspace or external state; verify scope before proceeding";
}

function shortReceiptId(receiptId) {
  const cleaned = cleanInline(receiptId);
  const matches = Array.from(cleaned.matchAll(/[a-f0-9]{8}/giu), (match) => match[0]);
  return matches.length ? matches[matches.length - 1] : cleaned;
}

function auditFields(review) {
  const fields = [
    `risk=${review.risk}`,
    `authorization=${review.authorization}`,
    `actionType=${review.actionType || "unknown"}`
  ];
  if (review.currentActionReceipt) fields.push(`currentActionReceipt=${review.currentActionReceipt}`);
  if (review.currentActionStatus) fields.push(`currentActionStatus=${review.currentActionStatus}`);
  if (review.currentActionAge) fields.push(`currentActionAge=${review.currentActionAge}`);
  if (review.currentActionBrief) fields.push(`currentActionBrief=${review.currentActionBrief}`);
  if (review.currentActionNextOwner) fields.push(`currentActionNextOwner=${review.currentActionNextOwner}`);
  if (review.state === "needs confirmation" && !review.currentActionReceipt) fields.push("currentActionReceipt=none");
  if (review.candidateActionReceipt) fields.push(`candidateActionReceipt=${review.candidateActionReceipt}`);
  if (review.candidateActionStatus) fields.push(`candidateActionStatus=${review.candidateActionStatus}`);
  if (review.candidateActionAge) fields.push(`candidateActionAge=${review.candidateActionAge}`);
  if (review.candidateActionIssue) fields.push(`candidateActionIssue=${review.candidateActionIssue}`);
  return fields.join("; ");
}

function coverageLine(review) {
  if (review.state === "approved" && review.authorization === "inherited") {
    return `matched to current dispatch receipt ${review.currentActionReceipt}`;
  }
  if (review.state === "approved") {
    return "matched as low-risk inspection; no dispatch receipt required";
  }
  if (review.authorization === "class-scope-required") {
    return "no class-scoped receipt match";
  }
  return "no valid receipt match";
}

function reasonLine(review) {
  if (review.state === "needs confirmation" && review.authorization === "class-scope-required") {
    return `current receipt ${shortReceiptId(review.currentActionReceipt)} is valid but has no boundary-class scope; high/critical boundaries require explicit confirmation until receipt classes exist`;
  }
  if (review.state === "needs confirmation" && review.candidateActionReceipt) {
    return `closest receipt ${shortReceiptId(review.candidateActionReceipt)} is ${review.candidateActionStatus || "unknown"} (${review.candidateActionAge || "age unknown"}) and cannot match this action: ${review.candidateActionIssue || "issue unknown"}`;
  }
  if (review.state === "needs confirmation") {
    return "no current dispatch receipt was found";
  }
  if (review.currentActionReceipt) {
    return `${review.reason}; status=${review.currentActionStatus || "unknown"} age=${review.currentActionAge || "unknown"} brief=${review.currentActionBrief || "unknown"} nextOwner=${review.currentActionNextOwner || "unknown"}`;
  }
  return review.reason;
}

function readableIssue(issue) {
  const cleaned = cleanInline(issue);
  if (!cleaned) return "not a valid match";
  if (cleaned === "requiresManagerDecision=true") return "needs Manager decision first";
  if (cleaned.startsWith("pending nextOwner=")) {
    return `waiting on ${cleaned.slice("pending nextOwner=".length) || "another owner"}`;
  }
  if (cleaned.startsWith("status ")) {
    return `status ${cleaned.slice("status ".length)}`;
  }
  if (cleaned === "missing brief scope") return "has no brief scope";
  if (cleaned === "terminal receipt has no report/output/validation artifact") {
    return "has no returned evidence";
  }
  if (cleaned.startsWith("superseded by ")) return `superseded by ${shortReceiptId(cleaned.slice("superseded by ".length))}`;
  return cleaned;
}

function receiptReturnReason(review) {
  return cleanInline(review.returnReason || review.currentActionReturnReason || review.candidateActionReturnReason || "");
}

function statusCoverageLine(review, action) {
  const status = cleanInline(review.currentActionStatus || review.candidateActionStatus || "").toLowerCase();
  if (status === "partial") {
    const reason = receiptReturnReason(review) || "work stopped before completion";
    return `Why: recent Nogra run ${shortReceiptId(review.currentActionReceipt || review.candidateActionReceipt)} is partial (${reason}), so it cannot approve ${action}`;
  }
  if (status === "blocked" || status === "failed" || status === "cancelled") {
    return `Why: recent Nogra run ${shortReceiptId(review.currentActionReceipt || review.candidateActionReceipt)} is ${status}, so it cannot approve ${action}`;
  }
  return "";
}

function readableCoverageLine(review, action) {
  const statusLine = statusCoverageLine(review, action);
  if (statusLine) return statusLine;
  if (review.authorization === "receipt-scope-miss" && review.currentActionReceipt) {
    const receiptId = shortReceiptId(review.currentActionReceipt);
    const target = review.scopeMissTarget || "unknown";
    const declaredScope = review.scopeMissDeclaredScope || "none";
    if (review.scopeMissKind === "boundary-miss") {
      return `Why: recent Nogra run ${receiptId} does not authorize boundary ${review.scopeMissBoundary || "unknown"} for target ${target}; authorized boundaries: [${review.scopeMissAuthorizedBoundaries || "none"}], declared scope: [${declaredScope}]`;
    }
    return `Why: recent Nogra run ${receiptId} authorizes boundary ${review.scopeMissBoundary || "unknown"}, but target ${target} is outside its declared scope [${declaredScope}]`;
  }
  if (review.currentActionReceipt) {
    return `Why: recent Nogra run ${shortReceiptId(review.currentActionReceipt)} exists, but it does not cover ${action}`;
  }
  if (review.candidateActionReceipt) {
    return `Why: recent Nogra run ${shortReceiptId(review.candidateActionReceipt)} cannot approve this (${readableIssue(review.candidateActionIssue)})`;
  }
  return `Why: no active Nogra run covers ${action}`;
}

function auditReceipt(review) {
  if (review.currentActionReceipt) {
    return `receipt=${shortReceiptId(review.currentActionReceipt)} status=${review.currentActionStatus || "unknown"}`;
  }
  if (review.candidateActionReceipt) {
    return `candidate=${shortReceiptId(review.candidateActionReceipt)} status=${review.candidateActionStatus || "unknown"}`;
  }
  return "receipt=none";
}

function auditCoverage(review) {
  if (review.state === "approved") return "covered";
  if (review.authorization === "missing") return "missing";
  return "not-covered";
}

function readableAuditLine(review, action) {
  return `Audit: action=${action}; coverage=${auditCoverage(review)}; ${auditReceipt(review)}`;
}

function visibleCandidateReceipt(candidate) {
  if (!candidate) return null;
  if (candidate.ageMs > AUTHORIZATION_RECEIPT_TTL_MS) return null;
  if (String(candidate.authorizationIssue || "").startsWith("stale ")) return null;
  return candidate;
}

function actionReviewMessage(review) {
  const action = review.actionType || "this action";
  const parts = review.state === "needs confirmation"
    ? [
        `Nogra check: ${action}`,
        "Approve only if you intended this now",
        `Impact: ${actionImpact(action)}`,
        readableCoverageLine(review, action),
        "Next: approve once to continue, or stop and brief this action first",
        readableAuditLine(review, action)
      ]
    : [
        review.authorization === "inherited" ? `Nogra check: ${action} matched current Nogra run` : `Nogra check: ${action}`,
        `Impact: ${actionImpact(action)}`,
        `Coverage: ${coverageLine(review)}`,
        `Reason: ${reasonLine(review)}`,
        readableAuditLine(review, action)
      ];
  let message = parts.join("\n");
  if (review.state === "approved" && !review.autoApproved) {
    message = `${message}. Claude Code permission rules still apply`;
  }
  return `${message}.`;
}

function pathRisk(toolName, toolInput = {}) {
  const filePath = cleanInline(toolInput.file_path || toolInput.path || "");
  if (!filePath) return "";
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] || normalized;
  // gate-arming: ANY write tool targeting a .nogra/config.json (any
  // workspace's, not just the current root) — the surface where standing
  // delegations (gate.autoApprove) are armed. The FILE is
  // the boundary: content-aware narrowing must never narrow this detection.
  // Checked first so no other risk label can shadow it. gate-arming is never
  // auto-approvable — locked by doctrine; do not add it to any approval path.
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (
    lowerSegments.length >= 2 &&
    lowerSegments[lowerSegments.length - 1] === "config.json" &&
    lowerSegments[lowerSegments.length - 2] === ".nogra"
  ) {
    return "gate-arming write";
  }
  if (normalized.includes("/.git/") || normalized.endsWith("/.git") || normalized === ".git") return "git metadata write";
  if (/\/?\.env(?:\.|$)/u.test(normalized)) return "secrets/env write";
  if (
    INSTRUCTION_SURFACE_BASENAMES.has(basename) ||
    isClaudeInstructionSurfacePath(segments) ||
    normalized.includes("/.claude-plugin/hooks/") ||
    normalized.startsWith(".claude-plugin/hooks/") ||
    normalized.includes("/nogra-claude-plugin/hooks/") ||
    normalized.startsWith("hooks/")
  ) {
    return "instruction-surface write";
  }
  if (/\b(?:migration|migrations|schema|billing|payments|stripe|auth|permissions|roles)\b/iu.test(normalized)) {
    return `${toolName} risk file`;
  }
  return "";
}

function isClaudeInstructionSurfacePath(segments = []) {
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== ".claude") continue;
    const next = segments[index + 1] || "";
    return CLAUDE_INSTRUCTION_SURFACE_DIRS.has(next) || CLAUDE_INSTRUCTION_SURFACE_FILES.has(next);
  }
  return false;
}

function toolName(input = {}) {
  return cleanInline(input.tool_name || input.toolName || input.name || input.tool || "");
}

function toolInput(input = {}) {
  return input.tool_input && typeof input.tool_input === "object"
    ? input.tool_input
    : input.toolInput && typeof input.toolInput === "object"
    ? input.toolInput
    : input.input && typeof input.input === "object"
    ? input.input
    : {};
}

// --- Run-scratch WRITE-OPS coverage class -----------------------------
// A deterministic, additive auto-approval class limited to pure file-op
// writes -- a SINGLE plain Bash invocation of rm, rmdir, mkdir, mv, cp or
// touch, or a direct Edit/Write/MultiEdit tool call -- whose resolved
// target(s) all fall inside the dispatch receipt's declared scratchRoots.
// EXEC (any other binary, including interpreters like node/python3/sh) is
// never eligible: this class recognizes exactly six fixed binaries, so an
// interpreter with scratch-path arguments never reaches this code at all and
// asks exactly as before this change (fail-closed by construction, not by a
// runtime check). Compound/piped Bash (;, &&, ||, |, backticks, $(),
// redirects) is likewise never eligible -- fail-closed by construction, not
// by pattern-matching every escape. An action that never references a
// declared scratch root returns null (no decision; existing classification
// stands, byte-identical). An action that DOES reference a scratch root but
// resolves outside it via `..` or a symlink asks rather than silently
// allowing or silently falling through -- the raw command textually engaged
// the root, so silence would be ambiguous.
const RUN_SCRATCH_WRITE_OP_BINARIES = new Set(["rm", "rmdir", "mkdir", "mv", "cp", "touch"]);

// Variable expansion ($VAR, ~), globs (*, ?, [ ]) and brace expansion ({ })
// cannot be resolved from the raw command text alone. An unresolvable token
// can never count as "within" a scratch root (it always blocks allow); it
// counts as ENGAGED only when it textually names a scratch root, so an
// unrelated `rm $HOME/x` keeps today's exact fall-through behavior.
function hasUnresolvableRunScratchToken(word) {
  return /[$~*?[\]{}]/u.test(word);
}

// A single, uncompounded Bash invocation: no `;`, `&`, `<`, backtick, `$(`,
// `||`, a single `|`, or any output redirect (stdout or stderr). Anything
// else fails closed -- falls through with no run-scratch decision at all, so
// existing classification (or native ask) applies unchanged.
function isSingleSimpleBashCommand(command) {
  if (hasUnsafeShellControl(command)) return false;
  if (hasShellWriteRedirect(command)) return false;
  const pipeline = splitShellPipeline(command);
  if (!pipeline || pipeline.length !== 1) return false;
  return true;
}

function runScratchBashBinary(command) {
  if (!isSingleSimpleBashCommand(command)) return "";
  const words = shellWords(command);
  if (!words.length) return "";
  const binary = path.basename(words[0]).toLowerCase();
  return RUN_SCRATCH_WRITE_OP_BINARIES.has(binary) ? binary : "";
}

function runScratchBashArguments(command) {
  return shellWords(command).slice(1).filter((word) => !word.startsWith("-"));
}

// Tolerant realpath: resolves symlinks along the nearest EXISTING ancestor
// chain, then reattaches any not-yet-created tail components literally. A
// path component that does not exist yet (the file/dir a write-op is about
// to create) cannot itself be a symlink escape -- only an EXISTING segment
// can be, so resolving only as far as reality goes is sufficient and never
// approximates a real symlink.
function tolerantRealpath(target) {
  let current = target;
  const tail = [];
  while (!exists(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  try {
    const real = fs.realpathSync(current);
    return tail.length ? path.join(real, ...tail) : real;
  } catch {
    return target;
  }
}

function withinScratchRoots(target, scratchRoots) {
  return scratchRoots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
}

// Raw textual containment BEFORE `..`/symlink resolution: did the command
// literally reference a declared scratch root as a path prefix? This is the
// signal that separates "unrelated action, run-scratch does not apply" (null,
// existing behavior preserved) from "engaged a scratch root but the resolved
// target escapes it" (ask).
function rawEngagesScratchRoot(rawAbsolute, scratchRoots) {
  const normalized = rawAbsolute.replaceAll("\\", "/");
  return scratchRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function resolveRunScratchTarget(cwd, arg) {
  const rawAbsolute = (path.isAbsolute(arg) ? arg : `${cwd}/${arg}`).replaceAll("\\", "/");
  const lexicalAbsolute = path.resolve(cwd, arg);
  const real = tolerantRealpath(lexicalAbsolute);
  return { rawAbsolute, real };
}

// One evaluation per action: every target must resolve inside a declared
// scratch root to allow; if the action engages a scratch root at all (raw
// prefix match on any argument, e.g. mv/cp crossing the boundary in either
// direction) but any target resolves outside it, the whole action asks; if
// the action never references a scratch root at all, this class does not
// apply (null) and the caller falls through unchanged.
function evaluateRunScratchTargets(cwd, args, scratchRoots) {
  if (!args.length) return null;
  let engaged = false;
  let allWithin = true;
  const resolvedTargets = [];
  for (const arg of args) {
    if (hasUnresolvableRunScratchToken(arg)) {
      allWithin = false;
      resolvedTargets.push(`${arg} (unresolvable)`);
      const rawAbsolute = (path.isAbsolute(arg) ? arg : `${cwd}/${arg}`).replaceAll("\\", "/");
      if (rawEngagesScratchRoot(rawAbsolute, scratchRoots)) engaged = true;
      continue;
    }
    const { rawAbsolute, real } = resolveRunScratchTarget(cwd, arg);
    resolvedTargets.push(real);
    const realWithin = withinScratchRoots(real, scratchRoots);
    if (rawEngagesScratchRoot(rawAbsolute, scratchRoots) || realWithin) engaged = true;
    if (!realWithin) allWithin = false;
  }
  if (!engaged) return null;
  return { allWithin, resolvedTargets };
}

// Every auto-approval this gate emits -- the pre-existing receipt scope-match
// class AND this new run-scratch class -- carries the same grep-provable
// citation phrase in its decision reason.
function autoApprovalCitation(action, runId) {
  return `approved ${action} — in scope of your GO, receipt ${runId}`;
}

function evaluateRunScratchAction({ name, payload, command, cwd, receipt }) {
  const scratchRoots = Array.isArray(receipt.scratchRoots) ? receipt.scratchRoots : [];
  if (!scratchRoots.length) return null;
  let actionLabel = "";
  let args = [];
  if (name === "Bash") {
    const binary = runScratchBashBinary(command);
    if (!binary) return null;
    args = runScratchBashArguments(command);
    actionLabel = `run-scratch ${binary}`;
  } else if (name === "Edit" || name === "Write" || name === "MultiEdit") {
    const filePath = cleanInline(payload.file_path || payload.path || "");
    if (!filePath) return null;
    args = [filePath];
    actionLabel = `run-scratch ${name.toLowerCase()}`;
  } else {
    return null;
  }
  const evaluation = evaluateRunScratchTargets(cwd, args, scratchRoots);
  if (!evaluation) return null;
  const targetLabel = name === "Bash" ? command : args[0];
  const sharedReview = {
    actionType: actionLabel,
    currentActionReceipt: receipt.runId,
    currentActionStatus: receipt.status,
    currentActionAge: receipt.age,
    currentActionBrief: receipt.briefId,
    currentActionNextOwner: receipt.nextOwner,
    currentActionReturnReason: receipt.returnReason
  };
  if (evaluation.allWithin) {
    const allowReason = `Nogra approved this run — run-scratch write (${targetLabel}) inside declared scratch roots; ${autoApprovalCitation(actionLabel, receipt.runId)}`;
    const review = {
      ...sharedReview,
      state: "approved",
      risk: "low",
      authorization: "run-scratch",
      autoApproved: true,
      mutation: "scratch-only",
      credentials: "none",
      reason: allowReason
    };
    const reviewMessage = [
      `Nogra check: ${actionLabel} matched current Nogra run`,
      "Impact: writes only inside the run's declared scratch roots",
      `Reason: ${allowReason}`,
      `Audit: action=${actionLabel}; coverage=covered; receipt=${shortReceiptId(receipt.runId)} status=${receipt.status}.`
    ].join("\n");
    return { shouldAsk: false, denyEligible: false, shouldAllow: true, allowReason, review, reviewMessage };
  }
  const reason = `${actionLabel} references declared scratch root(s) [${scratchRoots.join(", ")}] but target ${targetLabel} resolves outside them (resolved: ${evaluation.resolvedTargets.join(", ")})`;
  const review = {
    ...sharedReview,
    state: "needs confirmation",
    risk: "high",
    authorization: "run-scratch-escape",
    mutation: "possible",
    credentials: "unknown",
    scopeMissTarget: targetLabel,
    scratchRootsDeclared: scratchRoots.join(", "),
    scratchResolvedTarget: evaluation.resolvedTargets.join(", "),
    reason
  };
  const reviewMessage = [
    `Nogra check: ${actionLabel} escapes the run's declared scratch roots`,
    "Approve only if you intended this now",
    "Impact: the resolved target is outside the run's declared scratch roots (possible ../ or symlink escape, or a mv/cp crossing the boundary)",
    `Why: ${reason}`,
    "Next: approve once to continue, or stop and brief this action first",
    `Audit: action=${actionLabel}; coverage=scratch-escape; receipt=${shortReceiptId(receipt.runId)} status=${receipt.status}.`
  ].join("\n");
  return { shouldAsk: true, denyEligible: false, shouldAllow: false, allowReason: "", review, reviewMessage };
}

export function evaluateToolConvergenceRisk({ root, input } = {}) {
  const name = toolName(input);
  const payload = toolInput(input);
  let guard = null;
  let risk = "";
  let review = null;
  if (name === "Bash") {
    const command = payload.command || input.command || "";
    risk = commandRisk(command);
  } else if (["Edit", "Write", "MultiEdit"].includes(name)) {
    risk = pathRisk(name, payload);
  }
  const settings = gateSettings(root);
  const mode = settings.mode;
  const intent = readActiveIntent(root);
  const cls = boundaryClass(risk, name, payload);
  const target = scopeActionTarget(name, payload);

  // Non-goals stay first in evaluation order and override any receipt.
  const nonGoal = nonGoalViolation(intent, cls, name, payload);
  if (nonGoal) {
    review = {
      state: "needs confirmation",
      risk: "high",
      authorization: "non-goal",
      actionType: risk || cls || "action",
      reason: `[${nonGoal}] is a declared non-goal of the running intent - needs an explicit GO`
    };
    return {
      shouldAsk: true,
      denyEligible: mode === "hard",
      gateMode: mode,
      risk: risk || cls,
      toolName: name,
      guard,
      review,
      shouldAllow: false,
      allowReason: "",
      reviewMessage: `Nogra check: ${review.actionType}\nImpact: declared non-goal of the running intent\nReason: ${review.reason}\nNext: give an explicit GO, or this stays blocked.`
    };
  }

  // Gate arming (second in evaluation order, after non-goals): a write that
  // touches .nogra/config.json is the meta-action — it can change the rules
  // the gate itself enforces (gate.autoApprove). The gate
  // guards its own door with a deterministic ALWAYS-ASK: this branch returns
  // before receipts or active intent are even resolved, so
  // gate-arming is structurally excluded from every approval path — no
  // receipt match (receiptBoundaryScopeMatch also refuses it), no
  // active-intent authorize, no allow emission, no
  // PermissionRequest auto-answer. gate-arming is never auto-approvable —
  // locked by doctrine; do not add it to any approval path.
  //
  // Belt-and-suspenders (documentation only — the plugin never applies
  // settings changes): a native Claude Code ask rule is the floor no hook
  // output can override, because permission rules are evaluated regardless
  // of hook decisions. Operators who want that native floor can add to
  // .claude/settings.json:
  //   { "permissions": { "ask": [
  //       "Edit(**/.nogra/config.json)",
  //       "Write(**/.nogra/config.json)"
  //   ] } }
  if (cls === "gate-arming") {
    const armingFile = name === "Bash" ? ".nogra/config.json" : target || ".nogra/config.json";
    review = {
      state: "needs confirmation",
      risk: "critical",
      authorization: "gate-arming",
      actionType: risk,
      reason: "writes to .nogra/config.json can change standing delegations (autoApprove) and are never auto-approvable; only a live human approval opens this door"
    };
    const armingMessage = [
      `Nogra check: gate-arming write (${armingFile})`,
      "Gate arming: this write can change standing delegations (autoApprove). Approve only if you intend to change the gate's rules right now",
      `Impact: ${actionImpact(risk)}`,
      "Why: .nogra/config.json is the surface where the gate's own rules are armed; no receipt or active intent can approve gate arming — only a live human approval opens this door",
      "Audit: action=gate-arming write; coverage=never-auto-approvable; decidedBy=gate (deterministic, no model judgment)."
    ].join("\n");
    return {
      shouldAsk: true,
      denyEligible: mode === "hard",
      gateMode: mode,
      risk,
      toolName: name,
      boundaryClass: cls,
      guard,
      review,
      shouldAllow: false,
      allowReason: "",
      reviewMessage: armingMessage,
      gateSettings: settings
    };
  }

  // Run-scratch WRITE-OPS class (third in the ladder, after non-goals and
  // gate-arming, BEFORE the no-risk early return): a GO-dispatched run's own
  // scratchpad housekeeping must not raise a raw operator ask. Deliberately
  // placed after gate-arming so a write-op that also touches
  // .nogra/config.json (e.g. cp of the config into scratch) keeps its
  // gate-arming always-ask byte-identically. Requires the same workspace
  // opt-in (gate.autoApprove) as every other allow emission — default-off
  // workspaces stay byte-identical — plus a valid current receipt that
  // declares scratchRoots and is not in an approval-blocking status. Only
  // the six fixed write-op binaries and direct Edit/Write/MultiEdit calls
  // can ever reach this evaluation; exec and compound/piped commands are
  // structurally excluded (fail-closed) and flow through unchanged.
  if (settings.autoApprove) {
    const scratchCommand = name === "Bash" ? cleanInline(payload.command || input.command || "") : "";
    const scratchCandidate = name === "Bash"
      ? Boolean(runScratchBashBinary(scratchCommand))
      : ["Edit", "Write", "MultiEdit"].includes(name);
    if (scratchCandidate) {
      guard = resolveConvergenceGuard({ root });
      const scratchReceipt = guard.currentActionReceipt;
      const scratchStatusBlocked = scratchReceipt
        ? APPROVAL_BLOCKING_RECEIPT_STATUSES.has(cleanInline(scratchReceipt.status).toLowerCase())
        : true;
      if (scratchReceipt && !scratchStatusBlocked) {
        const scratchDecision = evaluateRunScratchAction({
          name,
          payload,
          command: scratchCommand,
          cwd: cleanInline(input.cwd) || process.cwd(),
          receipt: scratchReceipt
        });
        if (scratchDecision) {
          return {
            ...scratchDecision,
            gateMode: mode,
            risk: risk || scratchDecision.review.actionType,
            toolName: name,
            boundaryClass: "run-scratch",
            guard,
            gateSettings: settings
          };
        }
      }
    }
  }

  if (!risk) {
    return { shouldAsk: false, denyEligible: false, gateMode: mode, risk, toolName: name, guard, review, shouldAllow: false, allowReason: "", reviewMessage: "" };
  }
  guard = guard || resolveConvergenceGuard({ root });
  const receipt = guard.currentActionReceipt;
  const candidate = visibleCandidateReceipt(guard.candidateActionReceipt);

  // gate-arming can never reach this branch (the deterministic always-ask
  // above returns first), so an active-intent gate.authorize entry of
  // "gate-arming" is inert by construction — locked by doctrine; do not add
  // it to any approval path.
  if (intent && intent.authorize.includes(cls)) {
    const scopeDeclared = intent.scope.length > 0;
    const scopeMatched = scopeDeclared && matchesScopePatterns(root, target, intent.scope);
    // An intent without declared scope keeps the legacy class-only approval
    // (never allow-eligible). A declared scope must match to approve at all.
    if (!scopeDeclared || scopeMatched) {
      review = { state: "approved", risk: "high", authorization: "active-intent", actionType: risk, reason: `matched running active-intent (authorize: ${cls})` };
      const shouldAllow = settings.autoApprove && scopeMatched;
      return {
        shouldAsk: false,
        denyEligible: false,
        gateMode: mode,
        risk,
        toolName: name,
        guard,
        review,
        shouldAllow,
        allowReason: shouldAllow
          ? `Nogra approved this run — active intent GO (authorize: ${cls}), boundary ${cls}, scope match: ${target}`
          : "",
        reviewMessage: `Nogra check: ${risk} matched running active-intent\nImpact: ${actionImpact(risk)}\nReason: ${review.reason}.`
      };
    }
    // Scope declared but target outside it: fall through to receipt evaluation.
  }

  const scopedReceiptMatch = receipt && settings.autoApprove
    ? receiptBoundaryScopeMatch(root, receipt, cls, target)
    : null;
  const statusBlocksApproval = receipt
    ? APPROVAL_BLOCKING_RECEIPT_STATUSES.has(cleanInline(receipt.status).toLowerCase())
    : false;
  let shouldAllow = false;
  let allowReason = "";

  if (receipt && scopedReceiptMatch?.matched && !statusBlocksApproval) {
    shouldAllow = true;
    // Citation surface: every auto-approval reason carries the same
    // grep-provable citation phrase (see autoApprovalCitation) naming the
    // action and the covering receipt.
    allowReason = `Nogra approved this run — brief ${receipt.briefId} (GO), boundary ${cls}, scope match: ${target}; ${autoApprovalCitation(risk, receipt.runId)}`;
    review = {
      state: "approved",
      risk: "high",
      authorization: "inherited",
      autoApproved: true,
      actionType: risk,
      mutation: "possible",
      credentials: "unknown",
      currentActionReceipt: receipt.runId,
      currentActionStatus: receipt.status,
      currentActionAge: receipt.age,
      currentActionBrief: receipt.briefId,
      currentActionNextOwner: receipt.nextOwner,
      currentActionReturnReason: receipt.returnReason,
      reason: allowReason
    };
  } else if (receipt && scopedReceiptMatch && scopedReceiptMatch.kind !== "unscoped" && !statusBlocksApproval) {
    review = {
      state: "needs confirmation",
      risk: "high",
      authorization: "receipt-scope-miss",
      actionType: risk,
      mutation: "possible",
      credentials: "unknown",
      currentActionReceipt: receipt.runId,
      currentActionStatus: receipt.status,
      currentActionAge: receipt.age,
      currentActionBrief: receipt.briefId,
      currentActionNextOwner: receipt.nextOwner,
      currentActionReturnReason: receipt.returnReason,
      scopeMissKind: scopedReceiptMatch.kind,
      scopeMissBoundary: cls,
      scopeMissTarget: target,
      scopeMissAuthorizedBoundaries: scopedReceiptMatch.boundaries.join(", "),
      scopeMissDeclaredScope: scopedReceiptMatch.patterns.join(", "),
      reason: `${risk} does not match receipt ${receipt.runId} boundary/scope authorization`
    };
  } else {
    review = {
      state: "needs confirmation",
      risk: "high",
      authorization: receipt ? "class-scope-required" : candidate ? "invalid" : "missing",
      actionType: risk,
      mutation: "possible",
      credentials: "unknown",
      currentActionReceipt: receipt?.runId || "",
      currentActionStatus: receipt?.status || "",
      currentActionAge: receipt?.age || "",
      currentActionBrief: receipt?.briefId || "",
      currentActionNextOwner: receipt?.nextOwner || "",
      currentActionReturnReason: receipt?.returnReason || "",
      candidateActionReceipt: candidate?.runId || "",
      candidateActionStatus: candidate?.status || "",
      candidateActionAge: candidate?.age || "",
      candidateActionIssue: candidate?.authorizationIssue || "",
      candidateActionReturnReason: candidate?.returnReason || "",
      reason: receipt
        ? `${risk} reaches a high/critical boundary without class-scoped receipt authorization`
        : candidate
        ? `${risk} reaches a high/critical boundary with no valid receipt match; latest visible receipt is not a valid match`
        : `${risk} reaches a high/critical boundary with no valid receipt match`
    };
  }
  const reviewMessage = review ? actionReviewMessage(review) : "";
  const denyEligible = mode === "hard" && review.state === "needs confirmation" && !review.currentActionReceipt;
  return {
    shouldAsk: Boolean(review?.state === "needs confirmation"),
    denyEligible,
    gateMode: mode,
    risk,
    toolName: name,
    guard,
    review,
    shouldAllow,
    allowReason,
    reviewMessage,
    gateSettings: settings
  };
}
