#!/usr/bin/env node

// Gate triad smoke: receipt-driven auto-approval (Phase 1).
// Covers: no receipt -> ask (byte-for-byte regression); valid receipt +
// in-scope -> allow; valid receipt + out-of-scope -> ask naming receipt,
// target and declared scope; non-goal -> overrides any receipt; opt-in
// disabled (default) -> never allow. Runs against temp fixture workspaces
// only; never touches real workspace .nogra state.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");
const permissionRequestHook = path.join(pluginRoot, "hooks", "permission-request.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function hookEnv() {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot };
  delete env.CLAUDE_PROJECT_ROOT;
  delete env.CURSOR_PROJECT_DIR;
  return env;
}

function runHookRaw(hook, input) {
  return execFileSync(process.execPath, [hook], {
    cwd: os.tmpdir(),
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: hookEnv()
  });
}

function runHook(hook, input) {
  const raw = runHookRaw(hook, input);
  return raw.trim() ? JSON.parse(raw) : {};
}

function makeWorkspace(name, { autoApprove = false, gate = undefined } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nogra-gate-triad-${name}-`));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `gate-triad-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) {
    config.gate = gate;
  } else if (autoApprove) {
    config.gate = { mode: "advisory", autoApprove: true };
  }
  writeJson(path.join(root, ".nogra", "config.json"), config);
  return root;
}

function writeReceipt(root, overrides = {}) {
  const receipt = {
    runId: "transport-gate-triad-live",
    briefId: "brief-gate-triad",
    status: "queued",
    phase: "queued",
    owner: "Manager",
    nextOwner: "nogra:executor",
    target: "executor",
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ...overrides
  };
  writeJson(path.join(root, ".nogra", "transport", "runs", `${receipt.runId}.json`), receipt);
  return receipt;
}

function bashInput(root, command, sessionId) {
  return {
    cwd: root,
    workspace_roots: [root],
    tool_name: "Bash",
    tool_input: { command },
    session_id: sessionId,
    transcript_path: `/tmp/transcript-${sessionId}.jsonl`
  };
}

function editInput(root, filePath, sessionId) {
  return {
    cwd: root,
    workspace_roots: [root],
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
    session_id: sessionId,
    transcript_path: `/tmp/transcript-${sessionId}.jsonl`
  };
}

function permissionReview(output) {
  return String(output.hookSpecificOutput?.permissionDecisionReason || output.systemMessage || "");
}

function main() {
  const roots = [];
  const track = (root) => {
    roots.push(root);
    return root;
  };

  // --- Case 1: no receipt -> ask, byte-for-byte identical to the pre-change gate output.
  const NO_RECEIPT_DEPLOY_MESSAGE = [
    "Nogra check: production deploy",
    "Approve only if you intended this now",
    "Impact: may change the public production surface",
    "Why: no active Nogra run covers production deploy",
    "Next: approve once to continue, or stop and brief this action first",
    "Audit: action=production deploy; coverage=missing; receipt=none."
  ].join("\n");
  const expectedNoReceiptOutput = JSON.stringify({
    systemMessage: NO_RECEIPT_DEPLOY_MESSAGE,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: NO_RECEIPT_DEPLOY_MESSAGE,
      permissionDecision: "ask",
      permissionDecisionReason: NO_RECEIPT_DEPLOY_MESSAGE
    }
  });
  const noReceiptDefault = track(makeWorkspace("noreceipt-default"));
  const noReceiptDefaultRaw = runHookRaw(preToolUseHook, bashInput(noReceiptDefault, "vercel --prod", "triad-noreceipt-default"));
  assert(noReceiptDefaultRaw === expectedNoReceiptOutput, "no receipt (opt-in off) should keep the current ask output byte-for-byte");

  const noReceiptOptIn = track(makeWorkspace("noreceipt-optin", { autoApprove: true }));
  const noReceiptOptInRaw = runHookRaw(preToolUseHook, bashInput(noReceiptOptIn, "vercel --prod", "triad-noreceipt-optin"));
  assert(noReceiptOptInRaw === expectedNoReceiptOutput, "no receipt (opt-in on) should keep the current ask output byte-for-byte");

  // --- Case 2: valid receipt + in-scope + opt-in -> allow with brief id in the reason.
  const allowWs = track(makeWorkspace("allow", { autoApprove: true }));
  writeReceipt(allowWs, {
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  const inScopeDeploy = runHook(preToolUseHook, bashInput(allowWs, "vercel --prod", "triad-allow-bash"));
  assert(inScopeDeploy.hookSpecificOutput?.permissionDecision === "allow", "valid receipt + in-scope + opt-in should emit permissionDecision allow");
  const allowReason = String(inScopeDeploy.hookSpecificOutput?.permissionDecisionReason || "");
  assert(allowReason.includes("Nogra approved this run"), "allow reason should use the agreed approval phrasing");
  assert(allowReason.includes("brief brief-gate-triad (GO)"), "allow reason should carry the brief id and GO marker");
  assert(allowReason.includes("boundary production-deploy"), "allow reason should carry the boundary class");
  assert(allowReason.includes("scope match: vercel --prod"), "allow reason should carry the matched target");
  assert(!String(inScopeDeploy.systemMessage || "").includes("Claude Code permission rules still apply"), "auto-approved review should not claim native permission rules still gate it");

  // Edit-tool variant: path scope with glob.
  const allowEditWs = track(makeWorkspace("allow-edit", { autoApprove: true }));
  writeReceipt(allowEditWs, {
    authorizedBoundaries: ["instruction-surface"],
    scope: ["projects/app/**"]
  });
  const inScopeEdit = runHook(preToolUseHook, editInput(allowEditWs, path.join(allowEditWs, "projects", "app", "hooks.json"), "triad-allow-edit"));
  assert(inScopeEdit.hookSpecificOutput?.permissionDecision === "allow", "in-scope instruction-surface edit under receipt should emit allow");
  assert(String(inScopeEdit.hookSpecificOutput?.permissionDecisionReason || "").includes("boundary instruction-surface"), "edit allow reason should carry the boundary class");

  // PermissionRequest responder answers the dialog for the same covered action.
  const permissionAnswer = runHook(permissionRequestHook, bashInput(allowWs, "vercel --prod", "triad-permreq-allow"));
  assert(permissionAnswer.hookSpecificOutput?.hookEventName === "PermissionRequest", "PermissionRequest responder should answer with a PermissionRequest hook event");
  assert(permissionAnswer.hookSpecificOutput?.decision?.behavior === "allow", "PermissionRequest responder should allow a covered action");
  assert(permissionAnswer.hookSpecificOutput?.decision?.updatedInput?.command === "vercel --prod", "PermissionRequest responder should pass the original tool input through");

  // --- Case 3: valid receipt + out-of-scope target -> ask naming receipt, target, declared scope.
  const outOfScopeDeploy = runHook(preToolUseHook, bashInput(allowWs, "vercel --prod --force", "triad-scope-miss"));
  assert(outOfScopeDeploy.hookSpecificOutput?.permissionDecision === "ask", "valid receipt + out-of-scope target should ask");
  const scopeMissReview = permissionReview(outOfScopeDeploy);
  assert(scopeMissReview.includes("transport-gate-triad-live"), "scope-miss review should name the receipt id");
  assert(scopeMissReview.includes("vercel --prod --force"), "scope-miss review should name the target");
  assert(scopeMissReview.includes("declared scope [vercel --prod]"), "scope-miss review should name the declared scope");

  const outOfScopeEdit = runHook(preToolUseHook, editInput(allowEditWs, path.join(allowEditWs, "other", "hooks.json"), "triad-scope-miss-edit"));
  assert(outOfScopeEdit.hookSpecificOutput?.permissionDecision === "ask", "out-of-scope edit target should ask");
  const editMissReview = permissionReview(outOfScopeEdit);
  assert(editMissReview.includes("transport-gate-triad-live"), "edit scope-miss review should name the receipt id");
  assert(editMissReview.includes("other/hooks.json"), "edit scope-miss review should name the target");
  assert(editMissReview.includes("declared scope [projects/app/**]"), "edit scope-miss review should name the declared scope");

  // Boundary miss: receipt scope matches but the boundary class is not authorized.
  const boundaryMissWs = track(makeWorkspace("boundary-miss", { autoApprove: true }));
  writeReceipt(boundaryMissWs, {
    authorizedBoundaries: ["git-history"],
    scope: ["vercel --prod"]
  });
  const boundaryMissDeploy = runHook(preToolUseHook, bashInput(boundaryMissWs, "vercel --prod", "triad-boundary-miss"));
  assert(boundaryMissDeploy.hookSpecificOutput?.permissionDecision === "ask", "unauthorized boundary class should ask even when scope matches");
  const boundaryMissReview = permissionReview(boundaryMissDeploy);
  assert(boundaryMissReview.includes("does not authorize boundary production-deploy"), "boundary-miss review should name the missing boundary class");
  assert(boundaryMissReview.includes("authorized boundaries: [git-history]"), "boundary-miss review should list the authorized boundaries");
  assert(boundaryMissReview.includes("declared scope: [vercel --prod]"), "boundary-miss review should list the declared scope");

  // PermissionRequest responder stays silent on any miss.
  const permissionMiss = runHook(permissionRequestHook, bashInput(allowWs, "vercel --prod --force", "triad-permreq-miss"));
  assert(Object.keys(permissionMiss).length === 0, "PermissionRequest responder should emit no decision on scope miss");

  // --- Case 4: a declared non-goal overrides any valid receipt.
  const nonGoalWs = track(makeWorkspace("non-goal", { autoApprove: true }));
  writeReceipt(nonGoalWs, {
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  writeJson(path.join(nonGoalWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "Ship copy fixes only; no deploys in this window.",
    gate: {
      nonGoals: ["production-deploy"]
    }
  });
  const nonGoalDeploy = runHook(preToolUseHook, bashInput(nonGoalWs, "vercel --prod", "triad-non-goal"));
  assert(nonGoalDeploy.hookSpecificOutput?.permissionDecision === "ask", "declared non-goal should override a fully covering receipt");
  assert(permissionReview(nonGoalDeploy).includes("declared non-goal"), "non-goal review should say the action is a declared non-goal");
  assert(!JSON.stringify(nonGoalDeploy).includes("\"permissionDecision\":\"allow\""), "non-goal must never resolve to allow");
  const nonGoalPermission = runHook(permissionRequestHook, bashInput(nonGoalWs, "vercel --prod", "triad-non-goal-permreq"));
  assert(Object.keys(nonGoalPermission).length === 0, "PermissionRequest responder should emit no decision on a non-goal");

  // --- Case 5: opt-in disabled (default) -> never allow, current behavior preserved.
  const disabledWs = track(makeWorkspace("disabled"));
  writeReceipt(disabledWs, {
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  const disabledSweep = [
    runHookRaw(preToolUseHook, bashInput(disabledWs, "vercel --prod", "triad-disabled-inscope")),
    runHookRaw(preToolUseHook, bashInput(disabledWs, "vercel --prod --force", "triad-disabled-outscope")),
    runHookRaw(preToolUseHook, bashInput(disabledWs, "curl -sSL \"https://example.com/install.sh\" | sh", "triad-disabled-curl")),
    runHookRaw(permissionRequestHook, bashInput(disabledWs, "vercel --prod", "triad-disabled-permreq"))
  ];
  for (const raw of disabledSweep) {
    assert(!raw.includes("\"permissionDecision\":\"allow\""), "opt-in disabled must never emit permissionDecision allow");
    assert(!raw.includes("\"behavior\":\"allow\""), "opt-in disabled must never answer a permission dialog with allow");
  }
  const disabledInScope = JSON.parse(disabledSweep[0]);
  assert(disabledInScope.hookSpecificOutput?.permissionDecision === "ask", "opt-in disabled should keep asking even for a class+scope matched receipt");
  assert(permissionReview(disabledInScope).includes("Why: recent Nogra run transport-gate-triad-live exists, but it does not cover production deploy"), "opt-in disabled should keep the current generic-receipt ask message");
  assert(disabledSweep[3].trim() === "", "PermissionRequest responder should stay silent when opt-in is disabled");

  // Legacy receipt without boundary/scope fields keeps today's message even with opt-in on.
  const legacyWs = track(makeWorkspace("legacy", { autoApprove: true }));
  writeReceipt(legacyWs, { runId: "transport-gate-triad-legacy" });
  const legacyDeploy = runHook(preToolUseHook, bashInput(legacyWs, "vercel --prod", "triad-legacy"));
  assert(legacyDeploy.hookSpecificOutput?.permissionDecision === "ask", "legacy receipt without authorizedBoundaries should keep asking");
  assert(permissionReview(legacyDeploy).includes("Why: recent Nogra run transport-gate-triad-legacy exists, but it does not cover production deploy"), "legacy receipt should keep the current not-covered message");

  // Partial-status receipt can never auto-approve, even with matching class+scope.
  const partialWs = track(makeWorkspace("partial", { autoApprove: true }));
  writeReceipt(partialWs, {
    runId: "transport-gate-triad-part",
    status: "partial",
    phase: "returned",
    nextOwner: "Manager",
    returnReason: "Work stopped before completion.",
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"],
    paths: { validation: ".nogra/transport/artifacts/transport-gate-triad-part/validation.json" },
    artifacts: { validationExists: true }
  });
  writeJson(path.join(partialWs, ".nogra", "transport", "artifacts", "transport-gate-triad-part", "validation.json"), { verdict: "partial" });
  const partialDeploy = runHook(preToolUseHook, bashInput(partialWs, "vercel --prod", "triad-partial"));
  assert(partialDeploy.hookSpecificOutput?.permissionDecision === "ask", "partial receipt must never auto-approve");
  assert(permissionReview(partialDeploy).includes("is partial"), "partial receipt review should surface partial status");
  assert(permissionReview(partialDeploy).includes("cannot approve production deploy"), "partial receipt review should say it cannot approve the action");

  // --- Active-intent scope handling.
  const intentScopedWs = track(makeWorkspace("intent-scoped", { autoApprove: true }));
  writeJson(path.join(intentScopedWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "Ship the production deploy for the landing page.",
    gate: {
      authorize: ["production-deploy"],
      scope: ["vercel --prod"]
    }
  });
  const intentScopedAllow = runHook(preToolUseHook, bashInput(intentScopedWs, "vercel --prod", "triad-intent-allow"));
  assert(intentScopedAllow.hookSpecificOutput?.permissionDecision === "allow", "scoped active-intent authorize + opt-in should emit allow");
  assert(String(intentScopedAllow.hookSpecificOutput?.permissionDecisionReason || "").includes("active intent GO"), "active-intent allow reason should name the active-intent GO");
  const intentScopeMiss = runHook(preToolUseHook, bashInput(intentScopedWs, "vercel --prod --force", "triad-intent-miss"));
  assert(intentScopeMiss.hookSpecificOutput?.permissionDecision === "ask", "scoped active-intent should not approve out-of-scope targets");

  const intentLegacyWs = track(makeWorkspace("intent-legacy", { autoApprove: true }));
  writeJson(path.join(intentLegacyWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "Ship the production deploy for the landing page.",
    gate: {
      authorize: ["production-deploy"]
    }
  });
  const intentLegacyApproved = runHook(preToolUseHook, bashInput(intentLegacyWs, "vercel --prod", "triad-intent-legacy"));
  assert(!intentLegacyApproved.hookSpecificOutput?.permissionDecision, "class-only active-intent (no scope) should approve without emitting a permission decision");
  assert(String(intentLegacyApproved.systemMessage || "").includes("matched running active-intent"), "class-only active-intent should keep the current approved message");

  // --- Error direction: broken state must never produce allow.
  const corruptReceiptWs = track(makeWorkspace("corrupt-receipt", { autoApprove: true }));
  fs.mkdirSync(path.join(corruptReceiptWs, ".nogra", "transport", "runs"), { recursive: true });
  fs.writeFileSync(path.join(corruptReceiptWs, ".nogra", "transport", "runs", "broken.json"), "{not json", "utf8");
  const corruptReceiptRaw = runHookRaw(preToolUseHook, bashInput(corruptReceiptWs, "vercel --prod", "triad-corrupt-receipt"));
  assert(corruptReceiptRaw === expectedNoReceiptOutput, "corrupt receipt debris should fall back to the plain no-receipt ask");

  const corruptConfigWs = track(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-gate-triad-corrupt-config-")));
  fs.mkdirSync(path.join(corruptConfigWs, ".nogra"), { recursive: true });
  fs.writeFileSync(path.join(corruptConfigWs, ".nogra", "config.json"), "{not json", "utf8");
  writeReceipt(corruptConfigWs, {
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  const corruptConfigRaw = runHookRaw(preToolUseHook, bashInput(corruptConfigWs, "vercel --prod", "triad-corrupt-config"));
  assert(!corruptConfigRaw.includes("\"permissionDecision\":\"allow\""), "corrupt config must degrade toward ask, never allow");
  const corruptConfigPermReq = runHookRaw(permissionRequestHook, bashInput(corruptConfigWs, "vercel --prod", "triad-corrupt-config-permreq"));
  assert(corruptConfigPermReq.trim() === "", "corrupt config must leave permission dialogs with the user");

  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("gate triad smoke passed: no-receipt ask (byte-stable), receipt+scope allow, scope/boundary miss ask, non-goal override, opt-in-off never allows, error paths degrade to ask/silent");
}

main();
