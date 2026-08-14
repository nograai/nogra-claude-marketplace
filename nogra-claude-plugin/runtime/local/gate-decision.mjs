import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateToolConvergenceRisk } from "./convergence-guard.mjs";

// Shared receipt-check plumbing for the permission-facing hooks
// (PreToolUse and PermissionRequest): stdin parsing, workspace-root
// resolution, and the single convergence evaluation both hooks act on.
// Any error here must degrade toward "no decision", never toward allow.
//
// The shipped gate is pure deterministic provenance: a valid receipt that
// mechanically matches the action's boundary class and scope can allow;
// gate-arming always asks; everything else asks. There is no model-judgment
// upgrade path — a gray-zone receipt/scope mismatch always falls through to
// ask.

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

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function firstWorkspaceRoot(input) {
  if (!Array.isArray(input.workspace_roots)) return "";
  return input.workspace_roots.find((entry) => typeof entry === "string" && entry.trim() !== "") || "";
}

export function hasNograConfig(root) {
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

export function resolveProjectRoot(input) {
  const explicitRoot = process.env.CLAUDE_PROJECT_ROOT || process.env.CURSOR_PROJECT_DIR || "";
  if (explicitRoot) return resolve(explicitRoot);

  const workspaceRoot = firstWorkspaceRoot(input);
  if (hasNograConfig(workspaceRoot)) return resolve(workspaceRoot);

  const cwdRoot = nearestNograRoot(cleanInline(input.cwd));
  if (cwdRoot) return cwdRoot;

  return resolve(
    workspaceRoot ||
      cleanInline(input.cwd) ||
      process.cwd()
  );
}

export function readHookInput() {
  return parseInput(readStdin());
}

// gate-arming detector: writes to .nogra/config.json — the surface where
// standing delegations are armed — form the deterministic always-ask class.
// gate-arming is never auto-approvable — locked by doctrine; do not add it
// to any approval path.
function isGateArmingResult(result) {
  return (
    result?.boundaryClass === "gate-arming" ||
    result?.risk === "gate-arming write"
  );
}

// One-shot gate decision for a hook invocation. Returns
// { configured, input, root, result } where result carries shouldAsk,
// denyEligible, shouldAllow, allowReason and reviewMessage.
export function resolveGateDecision(inputOverride) {
  const input = inputOverride && typeof inputOverride === "object" ? inputOverride : readHookInput();
  const root = resolveProjectRoot(input);
  if (!hasNograConfig(root)) {
    return { configured: false, input, root, result: null };
  }
  const result = evaluateToolConvergenceRisk({ root, input });
  // Final structural clamp: whatever upstream logic produced, a gate-arming
  // result can never leave this function allow-capable, so neither the
  // PreToolUse emitter nor the PermissionRequest responder (allow-or-silent)
  // can ever open the gate's own door. gate-arming is never auto-approvable —
  // locked by doctrine; do not add it to any approval path.
  if (isGateArmingResult(result)) {
    result.shouldAllow = false;
    result.allowReason = "";
  }
  return { configured: true, input, root, result };
}
