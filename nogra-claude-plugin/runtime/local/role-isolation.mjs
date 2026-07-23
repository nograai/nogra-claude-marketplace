import fs from "node:fs";
import path from "node:path";
import {
  ROLE_LEASE_SCHEMA_V1,
  assertRoleLeaseSemantics
} from "./contract-spine.mjs";

export const ROLE_TOOL_POLICY = Object.freeze({
  executor: Object.freeze(["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob"]),
  verifier: Object.freeze(["Read", "Grep", "Glob"])
});

const ACTION_TOOLS = new Set(["Bash", "Edit", "MultiEdit", "Write"]);
const WRITE_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);

function now() {
  return new Date().toISOString();
}

function cleanInline(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, payload) {
  ensureDir(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function readJsonIfValid(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function containedBy(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function existingAncestor(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
  return current;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function scopePatternRegExp(pattern) {
  const normalized = String(pattern || "").replaceAll("\\", "/").replace(/^\.\/+/u, "");
  if (!normalized) return null;
  if (!/[*?]/u.test(normalized)) {
    return new RegExp(`^${escapeRegExp(normalized)}(?:/.*)?$`, "u");
  }
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, "u");
}

export function normalizeRole(value) {
  const role = cleanInline(value).toLowerCase().split(":").pop() || "";
  return Object.hasOwn(ROLE_TOOL_POLICY, role) ? role : "";
}

export function hookRole(input = {}) {
  return normalizeRole(input.agent_type || input.subagent_type);
}

export function activeRoleLeasePath(root) {
  return path.join(path.resolve(root), ".nogra", "runtime", "role-lease.json");
}

export function roleLeaseReceiptPath(root, leaseId) {
  const safeLeaseId = cleanInline(leaseId);
  if (!/^role-lease-[A-Za-z0-9_.-]+$/u.test(safeLeaseId)) {
    throw new Error(`invalid role lease id: ${safeLeaseId || "(empty)"}`);
  }
  return path.join(path.resolve(root), ".nogra", "receipts", "role-leases", `${safeLeaseId}.json`);
}

export function roleReportReceiptPath(root, reportId) {
  const safeReportId = cleanInline(reportId);
  if (!/^role-report-[A-Za-z0-9_.-]+$/u.test(safeReportId)) {
    throw new Error(`invalid role report id: ${safeReportId || "(empty)"}`);
  }
  return path.join(path.resolve(root), ".nogra", "receipts", "role-reports", `${safeReportId}.json`);
}

export function readActiveRoleLease(root) {
  const lease = readJsonIfValid(activeRoleLeasePath(root));
  if (!lease) return null;
  assertRoleLeaseSemantics(lease);
  return lease;
}

export function writeRoleLease(root, lease) {
  assertRoleLeaseSemantics(lease);
  writeJsonAtomic(roleLeaseReceiptPath(root, lease.leaseId), lease);
  writeJsonAtomic(activeRoleLeasePath(root), lease);
  return lease;
}

export function roleLeaseStatus(root) {
  const lease = readActiveRoleLease(root);
  if (!lease) {
    return {
      schema: ROLE_LEASE_SCHEMA_V1,
      status: "none",
      owner: "Manager",
      nextOwner: "Manager"
    };
  }
  const expired = lease.status === "active" && Date.parse(lease.expiresAt) <= Date.now();
  return {
    ...lease,
    effectiveStatus: expired ? "expired" : lease.status,
    nextOwner: "Manager"
  };
}

export function normalizeScopePatterns(root, patterns) {
  const workspace = fs.realpathSync(path.resolve(root));
  const normalized = [];
  const seen = new Set();
  for (const value of Array.isArray(patterns) ? patterns : []) {
    const raw = cleanInline(value).replaceAll("\\", "/");
    if (!raw || raw.includes("\0")) {
      throw new Error("role scope contains an empty or invalid path");
    }
    const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
    if (!containedBy(workspace, absolute)) {
      throw new Error(`role scope escapes the workspace: ${raw}`);
    }
    const relative = path.relative(workspace, absolute).replaceAll("\\", "/");
    if (!relative || relative === ".") {
      throw new Error("role scope cannot authorize the whole workspace");
    }
    if (relative === ".nogra" || relative.startsWith(".nogra/")) {
      throw new Error(`role scope cannot authorize Manager-owned control-plane state: ${raw}`);
    }
    if (!seen.has(relative)) {
      seen.add(relative);
      normalized.push(relative);
    }
  }
  return normalized;
}

export function resolveScopedTarget(root, target) {
  const workspace = fs.realpathSync(path.resolve(root));
  const raw = cleanInline(target);
  if (!raw || raw.includes("\0")) {
    throw new Error("write tool did not provide a valid target path");
  }
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  if (!containedBy(workspace, absolute)) {
    throw new Error(`target escapes the workspace: ${raw}`);
  }
  const ancestor = existingAncestor(absolute);
  if (!ancestor) {
    throw new Error(`target has no resolvable workspace ancestor: ${raw}`);
  }
  const realAncestor = fs.realpathSync(ancestor);
  if (!containedBy(workspace, realAncestor)) {
    throw new Error(`target resolves through a symlink outside the workspace: ${raw}`);
  }
  if (fs.existsSync(absolute)) {
    const realTarget = fs.realpathSync(absolute);
    if (!containedBy(workspace, realTarget)) {
      throw new Error(`target resolves outside the workspace: ${raw}`);
    }
  }
  const relative = path.relative(workspace, absolute).replaceAll("\\", "/");
  if (!relative || relative === ".") {
    throw new Error("role cannot write the workspace root");
  }
  return relative;
}

export function matchesRoleScope(root, target, patterns) {
  const relative = resolveScopedTarget(root, target);
  if (relative === ".nogra" || relative.startsWith(".nogra/")) return false;
  return patterns.some((pattern) => scopePatternRegExp(pattern)?.test(relative));
}

function toolTargets(input = {}) {
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const targets = [];
  for (const value of [toolInput.file_path, toolInput.path, input.file_path, input.path]) {
    const cleaned = cleanInline(value);
    if (cleaned && !targets.includes(cleaned)) targets.push(cleaned);
  }
  return targets;
}

function deny(role, reason, action = "role-isolation") {
  const message = `Nogra ${role} boundary blocked this action: ${reason}`;
  return {
    applicable: true,
    denyEligible: true,
    shouldAsk: false,
    shouldAllow: false,
    reviewMessage: message,
    action,
    reason
  };
}

function pass(role) {
  return {
    applicable: true,
    denyEligible: false,
    shouldAsk: false,
    shouldAllow: false,
    reviewMessage: "",
    action: "role-isolation",
    reason: `${role} action is inside the active role lease`
  };
}

function bindLease(root, lease, agentId) {
  const cleanAgentId = cleanInline(agentId);
  if (!cleanAgentId) {
    throw new Error("role hook is missing agent_id");
  }
  if (lease.agentId && lease.agentId !== cleanAgentId) {
    throw new Error(`role lease is already bound to another agent (${lease.agentId})`);
  }
  if (lease.agentId === cleanAgentId) return lease;
  const bound = {
    ...lease,
    agentId: cleanAgentId,
    updatedAt: now(),
    metadata: {
      ...(lease.metadata || {}),
      boundAt: now()
    }
  };
  return writeRoleLease(root, bound);
}

export function evaluateRoleToolUse({ root, input = {} }) {
  const role = hookRole(input);
  if (!role) return { applicable: false };
  const tool = cleanInline(input.tool_name || input.toolName);

  let lease;
  try {
    lease = readActiveRoleLease(root);
  } catch (error) {
    return deny(role, `role lease is unreadable or invalid (${error.message})`);
  }
  if (!lease) return deny(role, "no active Manager-issued role lease exists");
  if (lease.status !== "active") return deny(role, `role lease is ${lease.status}`);
  if (Date.parse(lease.expiresAt) <= Date.now()) return deny(role, "role lease has expired");
  if (lease.role !== role) return deny(role, `active lease belongs to ${lease.role}, not ${role}`);

  try {
    lease = bindLease(root, lease, input.agent_id || input.agentId);
  } catch (error) {
    return deny(role, error.message);
  }

  if (!lease.allowedTools.includes(tool)) {
    return deny(role, `${tool} is not in the lease operation set`);
  }
  if (READ_TOOLS.has(tool)) {
    const targets = toolTargets(input);
    try {
      for (const target of targets) {
        resolveScopedTarget(root, target);
      }
      if (role === "executor" && tool === "Read" && (
        !targets.length ||
        !targets.every((target) => matchesRoleScope(root, target, lease.scopePatterns))
      )) {
        return deny(role, "Read target is outside the approved run scope");
      }
    } catch (error) {
      return deny(role, error.message);
    }
    return pass(role);
  }
  if (!ACTION_TOOLS.has(tool)) return deny(role, `${tool || "(unknown tool)"} is not a recognized role operation`);
  if (role === "verifier") {
    return deny(role, `${tool} is not a read-only verifier operation`);
  }
  if (tool === "Bash") {
    return deny(role, "arbitrary shell is not available to the strict public executor");
  }
  if (!WRITE_TOOLS.has(tool)) return pass(role);

  const targets = toolTargets(input);
  if (!targets.length) return deny(role, `${tool} did not expose a target path`);
  try {
    if (!targets.every((target) => matchesRoleScope(root, target, lease.scopePatterns))) {
      return deny(role, `${tool} target is outside the approved run scope`);
    }
  } catch (error) {
    return deny(role, error.message);
  }
  return pass(role);
}
