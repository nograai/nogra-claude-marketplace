#!/usr/bin/env node

// Gate arming smoke: the gate guards its own door.
// Writes that touch .nogra/config.json — the surface where standing
// delegations (gate.autoApprove) are armed — form the deterministic
// always-ask boundary class 'gate-arming'. It is structurally excluded from
// EVERY approval path: no receipt match (even one explicitly listing
// gate-arming in authorizedBoundaries), no active-intent authorize, no allow
// emission, no PermissionRequest auto-answer. Covers: the maximal approval
// stack still asks; Bash write-indicator detection vs read-only mentions;
// non-goal ordering (non-goals still short-circuit first); hard-mode deny;
// and byte-stability for unrelated writes against pre-change baselines
// captured on 2026-07-03 BEFORE the gate-arming change landed. Zero live
// model calls. Temp fixture workspaces only; never touches real workspace
// .nogra state.

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

function makeWorkspace(name, gate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nogra-gate-arming-${name}-`));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `gate-arming-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) {
    config.gate = gate;
  }
  writeJson(path.join(root, ".nogra", "config.json"), config);
  return root;
}

// The maximal approval stack (Success Criterion 1): a valid, fresh receipt
// that explicitly lists gate-arming in authorizedBoundaries, a scope pattern
// covering everything, and the workspace autoApprove toggle ON. None of it
// may open gate-arming.
function writeMaximalReceipt(root) {
  const receipt = {
    runId: "transport-gate-arming-live",
    briefId: "brief-gate-arming",
    status: "queued",
    phase: "queued",
    owner: "Manager",
    nextOwner: "nogra:executor",
    target: "executor",
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    authorizedBoundaries: ["gate-arming", "instruction-surface", "production-deploy"],
    scope: ["**"]
  };
  writeJson(path.join(root, ".nogra", "transport", "runs", `${receipt.runId}.json`), receipt);
  return receipt;
}

function writeInput(root, toolName, filePath, sessionId) {
  return {
    cwd: root,
    workspace_roots: [root],
    tool_name: toolName,
    tool_input: toolName === "MultiEdit"
      ? { file_path: filePath, edits: [{ old_string: "a", new_string: "b" }] }
      : { file_path: filePath, old_string: "a", new_string: "b" },
    session_id: sessionId,
    transcript_path: `/tmp/transcript-${sessionId}.jsonl`
  };
}

function editInput(root, filePath, sessionId) {
  return writeInput(root, "Edit", filePath, sessionId);
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

function permissionReview(output) {
  return String(output.hookSpecificOutput?.permissionDecisionReason || output.systemMessage || "");
}

// The enriched gate-arming ask: names the file, states standing delegations
// can change, and instructs approval only for an intentional rules-change now.
const ARMING_HEADLINE = "Gate arming: this write can change standing delegations (autoApprove). Approve only if you intend to change the gate's rules right now";

function assertArmingAsk(raw, label, expectedDecision = "ask") {
  assert(!raw.includes("\"permissionDecision\":\"allow\""), `${label}: gate-arming must never emit permissionDecision allow`);
  assert(!raw.includes("\"behavior\":\"allow\""), `${label}: gate-arming must never answer a permission dialog with allow`);
  const output = JSON.parse(raw);
  assert(output.hookSpecificOutput?.permissionDecision === expectedDecision, `${label}: gate-arming should emit permissionDecision ${expectedDecision}`);
  const review = permissionReview(output);
  assert(review.includes("Nogra check: gate-arming write ("), `${label}: gate-arming review should carry the gate-arming action headline`);
  assert(review.includes(".nogra/config.json"), `${label}: gate-arming review should name the config file`);
  assert(review.includes(ARMING_HEADLINE), `${label}: gate-arming review should carry the enriched arming reason verbatim`);
  assert(review.includes("only a live human approval opens this door"), `${label}: gate-arming review should say only a live human approval opens the door`);
  assert(review.includes("decidedBy=gate (deterministic, no model judgment)"), `${label}: gate-arming audit line should attribute the deterministic gate, never a model`);
  return output;
}

// Pre-change baselines, captured byte-for-byte on 2026-07-03 BEFORE the
// gate-arming change landed (default fixture workspace, no receipt).
// Unrelated writes and read-only config mentions must keep rendering exactly
// these bytes. The pre-change gate emitted "" (silent) for an Edit to
// .nogra/config.json — that was the arming gap this smoke locks shut.
function askBaseline(action, impact) {
  const message = [
    `Nogra check: ${action}`,
    "Approve only if you intended this now",
    `Impact: ${impact}`,
    `Why: no active Nogra run covers ${action}`,
    "Next: approve once to continue, or stop and brief this action first",
    `Audit: action=${action}; coverage=missing; receipt=none.`
  ].join("\n");
  return JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
      permissionDecision: "ask",
      permissionDecisionReason: message
    }
  });
}

const INSTRUCTION_SURFACE_BASELINE = askBaseline(
  "instruction-surface write",
  "changes instructions, hooks, skills, or plugin metadata that can affect agent behavior"
);
const DEPLOY_BASELINE = askBaseline("production deploy", "may change the public production surface");

function main() {
  const cleanupRoots = [];
  const track = (root) => {
    cleanupRoots.push(root);
    return root;
  };
  const mockDir = track(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-gate-arming-mocks-")));

  // --- Case 1: byte-stability for unrelated writes (Success Criterion 5).
  const baselineWs = track(makeWorkspace("baseline"));
  assert(
    runHookRaw(preToolUseHook, editInput(baselineWs, path.join(baselineWs, "src", "app.mjs"), "arming-base-ordinary")) === "",
    "ordinary project-file edit must stay byte-identical to the pre-change baseline (silent)"
  );
  assert(
    runHookRaw(preToolUseHook, editInput(baselineWs, path.join(baselineWs, ".nogra", "state", "CURRENT-TASKS.md"), "arming-base-nogra-state")) === "",
    "other .nogra file edit must stay byte-identical to the pre-change baseline (silent)"
  );
  assert(
    runHookRaw(preToolUseHook, editInput(baselineWs, path.join(baselineWs, "hooks.json"), "arming-base-hooks-json")) === INSTRUCTION_SURFACE_BASELINE,
    "instruction-surface no-receipt ask must stay byte-identical to the pre-change baseline"
  );
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "vercel --prod", "arming-base-deploy")) === DEPLOY_BASELINE,
    "production-deploy no-receipt ask must stay byte-identical to the pre-change baseline"
  );

  // --- Case 2: the gap is closed — default workspace, no receipt, every
  // write tool targeting .nogra/config.json asks with the enriched reason.
  // Pre-change baseline for this exact fixture was "" (silent pass-through).
  for (const toolName of ["Edit", "Write", "MultiEdit"]) {
    const raw = runHookRaw(preToolUseHook, writeInput(baselineWs, toolName, path.join(baselineWs, ".nogra", "config.json"), `arming-gap-${toolName.toLowerCase()}`));
    assert(raw !== "", `${toolName} on .nogra/config.json must no longer pass silently (the 2026-07-03 arming gap)`);
    assertArmingAsk(raw, `${toolName} on .nogra/config.json (no receipt)`);
  }
  // Any workspace's config.json is the boundary, not just the current root's.
  const foreignConfig = path.join(mockDir, "other-workspace", ".nogra", "config.json");
  assertArmingAsk(
    runHookRaw(preToolUseHook, editInput(baselineWs, foreignConfig, "arming-gap-foreign")),
    "Edit on another workspace's .nogra/config.json"
  );
  const gapPermission = runHookRaw(permissionRequestHook, editInput(baselineWs, path.join(baselineWs, ".nogra", "config.json"), "arming-gap-permreq"));
  assert(gapPermission.trim() === "", "PermissionRequest responder must emit nothing for gate-arming (no receipt)");

  // --- Case 3: the maximal approval stack still asks (Success Criteria 1+3).
  const maximalWs = track(makeWorkspace("maximal", {
    mode: "advisory",
    autoApprove: true
  }));
  writeMaximalReceipt(maximalWs);

  // Control: the stack is potent — an in-scope instruction-surface edit under
  // the same receipt DOES allow. Only gate-arming must refuse.
  const controlAllow = runHook(preToolUseHook, editInput(maximalWs, path.join(maximalWs, "hooks.json"), "arming-maximal-control"));
  assert(controlAllow.hookSpecificOutput?.permissionDecision === "allow", "control: the maximal stack should allow an in-scope instruction-surface edit (stack is live)");
  assert(String(controlAllow.hookSpecificOutput?.permissionDecisionReason || "").includes("boundary instruction-surface"), "control allow reason should carry the boundary class");

  const maximalEditRaw = runHookRaw(preToolUseHook, editInput(maximalWs, path.join(maximalWs, ".nogra", "config.json"), "arming-maximal-edit"));
  const maximalAsk = assertArmingAsk(maximalEditRaw, "Edit on .nogra/config.json (maximal approval stack)");
  const maximalReview = permissionReview(maximalAsk);
  assert(!maximalReview.includes("Nogra approved"), "maximal-stack gate-arming ask must not carry any approval phrasing");

  const maximalBashRaw = runHookRaw(preToolUseHook, bashInput(maximalWs, "printf '{\"gate\":{\"autoApprove\":true}}' > .nogra/config.json", "arming-maximal-bash"));
  assertArmingAsk(maximalBashRaw, "Bash redirect into .nogra/config.json (maximal approval stack)");

  const maximalPermission = runHookRaw(permissionRequestHook, editInput(maximalWs, path.join(maximalWs, ".nogra", "config.json"), "arming-maximal-permreq"));
  assert(maximalPermission.trim() === "", "PermissionRequest responder must emit nothing for gate-arming even under the maximal approval stack");
  const maximalBashPermission = runHookRaw(permissionRequestHook, bashInput(maximalWs, "printf '{\"gate\":{\"autoApprove\":true}}' > .nogra/config.json", "arming-maximal-bash-permreq"));
  assert(maximalBashPermission.trim() === "", "PermissionRequest responder must emit nothing for Bash gate-arming under the maximal approval stack");

  // --- Case 4: active-intent authorize can never cover gate-arming.
  const intentWs = track(makeWorkspace("intent", { mode: "advisory", autoApprove: true }));
  writeJson(path.join(intentWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "Arming-bypass fixture: an intent that claims authority over the gate itself.",
    gate: {
      authorize: ["gate-arming"],
      scope: ["**"]
    }
  });
  const intentRaw = runHookRaw(preToolUseHook, editInput(intentWs, path.join(intentWs, ".nogra", "config.json"), "arming-intent"));
  const intentAsk = assertArmingAsk(intentRaw, "Edit on .nogra/config.json (active-intent authorize gate-arming)");
  const intentReview = permissionReview(intentAsk);
  assert(!intentReview.includes("matched running active-intent"), "active-intent authorize must never appear as coverage for gate-arming");
  assert(!intentReview.includes("active intent GO"), "active-intent GO phrasing must never appear for gate-arming");
  const intentPermission = runHookRaw(permissionRequestHook, editInput(intentWs, path.join(intentWs, ".nogra", "config.json"), "arming-intent-permreq"));
  assert(intentPermission.trim() === "", "PermissionRequest responder must emit nothing for gate-arming under an active-intent authorize");

  // --- Case 5: Bash detection sweep (Success Criterion 2) — write indicators
  // trigger, read-only mentions do not.
  const bashWriteCommands = [
    ["redirect", "echo '{}' > .nogra/config.json"],
    ["append-redirect", `printf '%s' x >> ${path.join(baselineWs, ".nogra", "config.json")}`],
    ["tee", "cat patch.json | tee .nogra/config.json"],
    ["sed-inplace", "sed -i '' 's/\"autoApprove\": false/\"autoApprove\": true/' .nogra/config.json"],
    ["cp", "cp /tmp/staged-config.json .nogra/config.json"],
    ["mv", "mv /tmp/staged-config.json .nogra/config.json"]
  ];
  for (const [name, command] of bashWriteCommands) {
    assertArmingAsk(
      runHookRaw(preToolUseHook, bashInput(baselineWs, command, `arming-bash-${name}`)),
      `Bash write indicator (${name})`
    );
  }
  const bashReadOnlyCommands = [
    ["cat", "cat .nogra/config.json"],
    ["cat-stderr", "cat .nogra/config.json 2>/dev/null"],
    ["grep", "grep autoApprove .nogra/config.json"],
    ["jq", "jq .gate .nogra/config.json"]
  ];
  for (const [name, command] of bashReadOnlyCommands) {
    assert(
      runHookRaw(preToolUseHook, bashInput(baselineWs, command, `arming-bash-ro-${name}`)) === "",
      `read-only config mention (${name}) must not trigger gate-arming (byte-identical silent baseline)`
    );
  }

  // --- Case 6: non-goal ordering regression (Success Criterion 4) — a
  // declared non-goal still short-circuits FIRST, before the gate-arming
  // branch, even with the maximal receipt present.
  const nonGoalWs = track(makeWorkspace("non-goal", { mode: "advisory", autoApprove: true }));
  writeMaximalReceipt(nonGoalWs);
  writeJson(path.join(nonGoalWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "No gate reconfiguration in this window.",
    gate: {
      nonGoals: ["gate-arming"]
    }
  });
  const nonGoalRaw = runHookRaw(preToolUseHook, editInput(nonGoalWs, path.join(nonGoalWs, ".nogra", "config.json"), "arming-non-goal"));
  assert(!nonGoalRaw.includes("\"permissionDecision\":\"allow\""), "non-goal gate-arming must never allow");
  const nonGoalAsk = JSON.parse(nonGoalRaw);
  assert(nonGoalAsk.hookSpecificOutput?.permissionDecision === "ask", "non-goal gate-arming should keep asking");
  const nonGoalReview = permissionReview(nonGoalAsk);
  assert(nonGoalReview.includes("declared non-goal"), "the non-goal check must short-circuit first (unchanged evaluation order)");
  assert(!nonGoalReview.includes(ARMING_HEADLINE), "the non-goal message must come from the non-goal branch, not the gate-arming branch (ordering proof)");

  // --- Case 7: hard mode — gate-arming is deny-eligible, consistent with
  // existing hard-mode semantics.
  const hardWs = track(makeWorkspace("hard", { mode: "hard" }));
  assertArmingAsk(
    runHookRaw(preToolUseHook, editInput(hardWs, path.join(hardWs, ".nogra", "config.json"), "arming-hard")),
    "Edit on .nogra/config.json (hard mode)",
    "deny"
  );

  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("gate arming smoke passed: config.json writes always ask with the enriched arming reason (maximal receipt+intent stack refused, responder silent), Bash write indicators detected while read-only mentions stay silent, non-goals still short-circuit first, hard mode denies, unrelated writes byte-identical to pre-change baselines");
}

main();
