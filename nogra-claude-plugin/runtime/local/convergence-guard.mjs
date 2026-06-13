#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const PENDING_AUTHORIZATION_RUN_STATUSES = new Set(["queued", "running", "returning", "in_progress"]);
const TERMINAL_AUTHORIZATION_RUN_STATUSES = new Set(["returned", "ok", "partial"]);
const AUTHORIZATION_RECEIPT_TTL_MS = 12 * 60 * 60 * 1000;
const CLASS_SCOPED_RECEIPT_INHERITANCE_ENABLED = false;
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

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
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
        target: cleanInline(payload.target || payload.targetRole || ""),
        targetRole: cleanInline(payload.targetRole || payload.target || payload.metadata?.targetRole || ""),
        status: cleanInline(payload.status || ""),
        phase: cleanInline(payload.phase || ""),
        owner: cleanInline(payload.owner || payload.metadata?.owner || ""),
        nextOwner: cleanInline(payload.nextOwner || payload.metadata?.nextOwner || ""),
        stopReason: cleanInline(payload.stopReason || payload.metadata?.stopReason || ""),
        returnReason: cleanInline(payload.returnReason || payload.reason || payload.metadata?.returnReason || payload.metadata?.reason || ""),
        pendingState: cleanInline(payload.pendingState || payload.metadata?.pendingState || ""),
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
      return `git ${subcommand}`;
    }
  }
  return "";
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

function commandRisk(command) {
  const cleaned = cleanInline(command);
  if (!cleaned) return "";
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

function curlPipelineRisk(command) {
  const segments = splitShellPipeline(command);
  if (!segments || segments.length < 2 || !hasCurlSegment(segments[0])) return "";
  const writeSinks = new Set(["tee", "sponge"]);
  const executors = new Set(["bash", "sh", "zsh", "fish", "node", "python", "python3", "ruby", "perl", "php", "osascript"]);
  for (const segment of segments.slice(1)) {
    const commandName = firstCommand(segment);
    if (writeSinks.has(commandName)) return "shell write sink";
    if (executors.has(commandName)) return "remote execution pipe";
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
  if (review.state === "approved") {
    message = `${message}. Claude Code permission rules still apply`;
  }
  return `${message}.`;
}

function pathRisk(toolName, toolInput = {}) {
  const filePath = cleanInline(toolInput.file_path || toolInput.path || "");
  if (!filePath) return "";
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("/.git/") || normalized.endsWith("/.git") || normalized === ".git") return "git metadata write";
  if (/\/?\.env(?:\.|$)/u.test(normalized)) return "secrets/env write";
  if (/\b(?:migration|migrations|schema|billing|payments|stripe|auth|permissions|roles)\b/iu.test(normalized)) {
    return `${toolName} risk file`;
  }
  return "";
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
  if (!risk) {
    return {
      shouldAsk: false,
      risk,
      toolName: name,
      guard,
      review,
      reviewMessage: ""
    };
  }
  guard = resolveConvergenceGuard({ root });
  const receipt = guard.currentActionReceipt;
  const candidate = visibleCandidateReceipt(guard.candidateActionReceipt);
  if (receipt && CLASS_SCOPED_RECEIPT_INHERITANCE_ENABLED) {
    review = {
      state: "approved",
      risk: "high",
      authorization: "inherited",
      actionType: risk,
      mutation: "possible",
      credentials: "unknown",
      currentActionReceipt: receipt.runId,
      currentActionStatus: receipt.status,
      currentActionAge: receipt.age,
      currentActionBrief: receipt.briefId,
      currentActionNextOwner: receipt.nextOwner,
      currentActionReturnReason: receipt.returnReason,
      reason: `${risk} is matched to a valid class-scoped dispatch receipt`
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
  return {
    shouldAsk: Boolean(review?.state === "needs confirmation"),
    risk,
    toolName: name,
    guard,
    review,
    reviewMessage
  };
}
