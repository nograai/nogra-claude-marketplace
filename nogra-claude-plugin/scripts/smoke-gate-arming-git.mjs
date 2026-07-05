#!/usr/bin/env node

// Gate arming smoke (git-write routing): a git-write that TARGETS an
// instruction surface routes by target class — the same class as a direct
// write to that file — instead of the receipt-approvable git-history class.
// This closes the documented residual detour from the arm-self-gate run:
// before this change, `git checkout -- .nogra/config.json` classified as
// git-history and a git-history receipt (or the PermissionRequest responder)
// could approve it — a detour around the arm-self-gate.
//
// Target grammar covered by the routing (Fase 0 grounding):
//   git checkout <ref> -- <pathspec...>   file targets after `--`
//   git checkout -- <pathspec...>         file targets after `--`
//   git checkout <ref-or-pathspec>        git's own ambiguous positional form
//   git restore <pathspec...>             positionals are always pathspecs
//   git restore --source <ref> <pathspec> (and --source=<ref>)
//   git restore --staged <pathspec>       index-only, still surface-routed
//   git clean <pathspec>                  deletes untracked matches
//   git -C <dir> ... / flag noise / NAME=value env-assignment prefixes
// Never file-target-capable (stay git-history): git switch (branch-only
// grammar), git checkout <branch> / git switch <branch> pure switches, and
// git reset pathspec forms (index-only; git refuses `reset --hard` with
// paths). Fail-closed: an unparseable/indirected target on a
// file-target-capable git-write that textually mentions a surface name
// routes to the stricter class — a `.nogra/config.json` mention wins as
// gate-arming, other surface names as instruction-surface — never
// git-history. Byte-stability baselines were captured on 2026-07-03 BEFORE
// the change landed. Zero live model calls.
// Temp fixture workspaces only; never touches real workspace .nogra state.

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nogra-gate-arming-git-${name}-`));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `gate-arming-git-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) {
    config.gate = gate;
  }
  writeJson(path.join(root, ".nogra", "config.json"), config);
  return root;
}

function writeReceipt(root, authorizedBoundaries) {
  const receipt = {
    runId: "transport-gate-arming-git-live",
    briefId: "brief-gate-arming-git",
    status: "queued",
    phase: "queued",
    owner: "Manager",
    nextOwner: "nogra:executor",
    target: "executor",
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    authorizedBoundaries,
    scope: ["**"]
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

// The enriched gate-arming ask — identical to the direct-write arm layer's.
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
// git-write routing change landed (default fixture workspace, no receipt).
// Non-surface git-writes, pure branch switches, and non-git commands must
// keep rendering exactly these bytes. The pre-change gate rendered the SAME
// git-history bytes for `git checkout -- .nogra/config.json` and
// `git checkout -- CLAUDE.md` — that receipt-approvable detour is the gap
// this smoke locks shut.
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

const GIT_TREE_IMPACT = "changes local working tree or Git state; reversibility depends on the command";
const GIT_CHECKOUT_BASELINE = askBaseline("git checkout", GIT_TREE_IMPACT);
const GIT_RESTORE_BASELINE = askBaseline("git restore", GIT_TREE_IMPACT);
const GIT_SWITCH_BASELINE = askBaseline("git switch", GIT_TREE_IMPACT);
const GIT_CLEAN_BASELINE = askBaseline("git clean", GIT_TREE_IMPACT);
const GIT_RESET_BASELINE = askBaseline("git reset", GIT_TREE_IMPACT);
const GIT_PUSH_BASELINE = askBaseline("git push", "publishes commits to a remote branch and may trigger CI or deploy workflows");
const DEPLOY_BASELINE = askBaseline("production deploy", "may change the public production surface");
const INSTRUCTION_SURFACE_BASELINE = askBaseline(
  "instruction-surface write",
  "changes instructions, hooks, skills, or plugin metadata that can affect agent behavior"
);

function main() {
  const cleanupRoots = [];
  const track = (root) => {
    cleanupRoots.push(root);
    return root;
  };
  const mockDir = track(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-gate-arming-git-mocks-")));

  // --- Case 1: byte-stability (Success Criterion 5) — non-surface git-writes,
  // pure branch switches, and non-git commands stay byte-identical to the
  // pre-change baselines. This is the anti-over-broadening proof: we close
  // one window, not all of git.
  const baselineWs = track(makeWorkspace("baseline"));
  const stableCases = [
    ["checkout-branch", "git checkout main", GIT_CHECKOUT_BASELINE],
    ["switch-branch", "git switch feature", GIT_SWITCH_BASELINE],
    ["switch-surface-like-branch", "git switch config-rework", GIT_SWITCH_BASELINE],
    ["checkout-dashdash-ordinary", "git checkout -- src/app.mjs", GIT_CHECKOUT_BASELINE],
    ["checkout-ref-dashdash-ordinary", "git checkout HEAD -- src/app.mjs", GIT_CHECKOUT_BASELINE],
    ["checkout-new-branch", "git checkout -b feature-x", GIT_CHECKOUT_BASELINE],
    ["checkout-c-prefix", "git -C sub checkout main", GIT_CHECKOUT_BASELINE],
    ["restore-ordinary", "git restore src/app.mjs", GIT_RESTORE_BASELINE],
    ["restore-source-ordinary", "git restore --source HEAD~1 src/app.mjs", GIT_RESTORE_BASELINE],
    ["restore-staged-ordinary", "git restore --staged src/app.mjs", GIT_RESTORE_BASELINE],
    // Only the two surface classes route; secrets/env stays git-history.
    ["checkout-env-file", "git checkout -- .env", GIT_CHECKOUT_BASELINE],
    // Bare settings.json outside .claude/ is NOT a surface for a direct Edit
    // either — consistency holds in both directions (no over-tightening).
    ["checkout-bare-settings", "git checkout -- settings.json", GIT_CHECKOUT_BASELINE],
    ["clean-flags-only", "git clean -fd", GIT_CLEAN_BASELINE],
    ["clean-ordinary-path", "git clean -f build/", GIT_CLEAN_BASELINE],
    ["reset-hard", "git reset --hard HEAD~1", GIT_RESET_BASELINE],
    // Deliberate: git reset pathspec forms are index-only (git refuses hard
    // reset with paths) — a reset can never rewrite the working-tree config,
    // so even a config.json pathspec stays git-history.
    ["reset-config-path", "git reset .nogra/config.json", GIT_RESET_BASELINE],
    ["push", "git push origin main", GIT_PUSH_BASELINE],
    ["non-git-deploy", "vercel --prod", DEPLOY_BASELINE]
  ];
  for (const [name, command, baseline] of stableCases) {
    assert(
      runHookRaw(preToolUseHook, bashInput(baselineWs, command, `arming-git-stable-${name}`)) === baseline,
      `${name} (${command}) must stay byte-identical to its pre-change baseline`
    );
  }
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "cat .nogra/config.json", "arming-git-stable-cat")) === "",
    "read-only config mention must stay byte-identical to the pre-change baseline (silent)"
  );
  assert(
    runHookRaw(preToolUseHook, editInput(baselineWs, path.join(baselineWs, "src", "app.mjs"), "arming-git-stable-edit")) === "",
    "ordinary project-file edit must stay byte-identical to the pre-change baseline (silent)"
  );

  // --- Case 2: the detour is closed (Success Criterion 2). A live receipt
  // that PROVABLY approves git checkout of an ordinary source file (control)
  // must not open any git-write onto .nogra/config.json — those route to the
  // always-ask gate-arming class before receipts are even consulted.
  const historyWs = track(makeWorkspace("history", {
    mode: "advisory",
    autoApprove: true
  }));
  writeReceipt(historyWs, ["git-history"]);

  // Control: the receipt is potent for git-history — the ordinary checkout
  // allows on BOTH the PreToolUse gate and the PermissionRequest responder.
  const historyControl = runHook(preToolUseHook, bashInput(historyWs, "git checkout -- src/app.mjs", "arming-git-history-control"));
  assert(historyControl.hookSpecificOutput?.permissionDecision === "allow", "control: git-history receipt should allow an ordinary git checkout (receipt is live)");
  assert(String(historyControl.hookSpecificOutput?.permissionDecisionReason || "").includes("boundary git-history"), "control allow reason should carry the git-history boundary class");
  const historyControlResponder = runHook(permissionRequestHook, bashInput(historyWs, "git checkout -- src/app.mjs", "arming-git-history-control-permreq"));
  assert(historyControlResponder.hookSpecificOutput?.decision?.behavior === "allow", "control: the PermissionRequest responder should answer allow for the ordinary git checkout");

  const closedDetours = [
    ["checkout-dashdash", "git checkout -- .nogra/config.json"],
    ["checkout-ref-dashdash", "git checkout HEAD -- .nogra/config.json"],
    ["checkout-positional", "git checkout .nogra/config.json"],
    ["restore", "git restore .nogra/config.json"],
    ["restore-source", "git restore --source HEAD~1 .nogra/config.json"],
    ["restore-staged", "git restore --staged .nogra/config.json"],
    ["clean", "git clean -f .nogra/config.json"],
    ["checkout-foreign-config", `git checkout -- ${path.join(mockDir, "other-workspace", ".nogra", "config.json")}`]
  ];
  for (const [name, command] of closedDetours) {
    assertArmingAsk(
      runHookRaw(preToolUseHook, bashInput(historyWs, command, `arming-git-detour-${name}`)),
      `git-write detour (${name}) under a live git-history receipt`
    );
    assert(
      runHookRaw(permissionRequestHook, bashInput(historyWs, command, `arming-git-detour-${name}-permreq`)).trim() === "",
      `PermissionRequest responder must emit nothing for git-write detour (${name})`
    );
  }

  // --- Case 3: consistency for other surfaces (Success Criterion 3) — a
  // git-write targeting CLAUDE.md is instruction-surface, identical in class
  // and receipt behavior to a direct Edit of the same file. No over-tightening:
  // it stays receipt-approvable.
  const surfaceWs = track(makeWorkspace("surface", { mode: "advisory", autoApprove: true }));
  writeReceipt(surfaceWs, ["instruction-surface"]);
  const editAllow = runHook(preToolUseHook, editInput(surfaceWs, path.join(surfaceWs, "CLAUDE.md"), "arming-git-surface-edit"));
  assert(editAllow.hookSpecificOutput?.permissionDecision === "allow", "control: instruction-surface receipt should allow a direct Edit of CLAUDE.md");
  const editReason = String(editAllow.hookSpecificOutput?.permissionDecisionReason || "");
  assert(editReason.includes("boundary instruction-surface"), "direct-Edit allow reason should carry the instruction-surface boundary class");
  const gitSurfaceAllow = runHook(preToolUseHook, bashInput(surfaceWs, "git checkout -- CLAUDE.md", "arming-git-surface-checkout"));
  assert(gitSurfaceAllow.hookSpecificOutput?.permissionDecision === "allow", "git checkout of CLAUDE.md should be receipt-approvable under the SAME instruction-surface boundary as a direct Edit");
  const gitSurfaceReason = String(gitSurfaceAllow.hookSpecificOutput?.permissionDecisionReason || "");
  assert(gitSurfaceReason.includes("boundary instruction-surface"), "git-write allow reason should carry the instruction-surface boundary class (identical class to direct Edit)");
  assert(!gitSurfaceReason.includes("boundary git-history"), "git checkout of CLAUDE.md must no longer classify as git-history");
  assert(!gitSurfaceReason.includes(ARMING_HEADLINE), "git checkout of CLAUDE.md must not over-tighten into gate-arming");
  const gitSurfaceResponder = runHook(permissionRequestHook, bashInput(surfaceWs, "git checkout -- CLAUDE.md", "arming-git-surface-checkout-permreq"));
  assert(gitSurfaceResponder.hookSpecificOutput?.decision?.behavior === "allow", "the PermissionRequest responder should answer allow for the receipt-covered git checkout of CLAUDE.md");

  // Matrix: every basename from BOTH existing surface lists routes to
  // instruction-surface, byte-identical to the direct-Edit ask for the same
  // file (no receipt) — the strongest possible identical-class proof.
  const surfaceBasenames = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "SKILL.md", "plugin.json", "hooks.json"];
  const claudeSurfaceFiles = [".claude/settings.json", ".claude/settings.local.json"];
  for (const target of [...surfaceBasenames, ...claudeSurfaceFiles]) {
    const viaCheckout = runHookRaw(preToolUseHook, bashInput(baselineWs, `git checkout -- ${target}`, `arming-git-matrix-checkout-${target}`));
    const viaRestore = runHookRaw(preToolUseHook, bashInput(baselineWs, `git restore ${target}`, `arming-git-matrix-restore-${target}`));
    const viaEdit = runHookRaw(preToolUseHook, editInput(baselineWs, path.join(baselineWs, target), `arming-git-matrix-edit-${target}`));
    assert(viaCheckout === INSTRUCTION_SURFACE_BASELINE, `git checkout of ${target} should render the instruction-surface ask`);
    assert(viaRestore === INSTRUCTION_SURFACE_BASELINE, `git restore of ${target} should render the instruction-surface ask`);
    assert(viaEdit === INSTRUCTION_SURFACE_BASELINE && viaCheckout === viaEdit, `git-write and direct Edit of ${target} must render byte-identical asks (identical class)`);
  }
  // Path-prefix surfaces reuse the same direct-write logic too.
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "git checkout -- hooks/pre-tool-use.mjs", "arming-git-matrix-hooks-dir")) === INSTRUCTION_SURFACE_BASELINE,
    "git checkout of a hooks/ path should render the instruction-surface ask (same list, same logic as direct writes)"
  );

  // --- Case 4: fail-closed (Success Criterion 4) — indirected or compound
  // git-writes that mention the arming surface route to gate-arming; pure
  // branch switches stay git-history byte-identically (asserted in Case 1 and
  // re-asserted here for the criterion's exact fixtures).
  const failClosedArming = [
    ["env-assignment", "TARGET=.nogra/config.json git checkout -- $TARGET"],
    ["compound-second-segment", "git checkout ordinary.txt && git restore .nogra/config.json"],
    ["weaker-first-git-write", "git push origin main && git checkout -- .nogra/config.json"]
  ];
  for (const [name, command] of failClosedArming) {
    assertArmingAsk(
      runHookRaw(preToolUseHook, bashInput(baselineWs, command, `arming-git-failclosed-${name}`)),
      `fail-closed arming (${name})`
    );
  }
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "F=CLAUDE.md git checkout -- $F", "arming-git-failclosed-surface-env")) === INSTRUCTION_SURFACE_BASELINE,
    "env-assignment indirection of a surface basename should fail closed to instruction-surface"
  );
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "git checkout main", "arming-git-failclosed-branch")) === GIT_CHECKOUT_BASELINE,
    "git checkout main (pure branch switch) must stay git-history byte-identically"
  );
  assert(
    runHookRaw(preToolUseHook, bashInput(baselineWs, "git switch feature", "arming-git-failclosed-switch")) === GIT_SWITCH_BASELINE,
    "git switch feature (pure branch switch) must stay git-history byte-identically"
  );

  // --- Case 5: hard mode — git-write gate-arming routes are deny-eligible,
  // consistent with the direct-write arm layer's hard-mode semantics.
  const hardWs = track(makeWorkspace("hard", { mode: "hard" }));
  assertArmingAsk(
    runHookRaw(preToolUseHook, bashInput(hardWs, "git checkout -- .nogra/config.json", "arming-git-hard")),
    "git checkout of .nogra/config.json (hard mode)",
    "deny"
  );

  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("gate arming git smoke passed: git checkout/restore/clean targeting .nogra/config.json always asks as gate-arming (live git-history receipt refused, responder silent), surface targets classify identically to direct Edits across both surface lists (receipt-approvable, byte-identical asks), fail-closed indirection/compound forms route to the stricter class, and pure branch switches plus non-surface git-writes stay byte-identical to pre-change baselines");
}

main();
