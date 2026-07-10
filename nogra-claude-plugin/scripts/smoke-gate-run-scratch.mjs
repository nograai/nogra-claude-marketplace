#!/usr/bin/env node

// Gate run-scratch smoke: the deterministic run-scratch WRITE-OPS coverage
// class. After GO, a dispatched run's own scratch housekeeping (rm, rmdir,
// mkdir, mv, cp, touch, and direct Edit/Write/MultiEdit) auto-approves WITH a
// citation when every resolved target sits inside the receipt's declared
// scratchRoots. EXEC IS FAIL-CLOSED: interpreters/arbitrary binaries (node,
// python3, sh, npx, ...) never auto-approve, even when every path argument is
// inside scratch — an exec's effects are not bounded by its argument paths.
// Compound/piped/redirected commands are fail-closed the same way. `..` and
// symlink escapes and mv/cp boundary crossings ask. Receipts without
// scratchRoots, expired/absent receipts, approval-blocking statuses, and the
// default autoApprove-off workspace all keep today's byte-identical behavior.
// gate-arming and non-goals keep strict precedence over this class. Also
// covers the dispatch side: the receipt's scratchRoots list is declared
// deterministically at dispatch time (run artifacts dir by default, plus
// optional repeatable --scratch-root entries). Zero live model calls; temp
// fixture workspaces only.

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
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");

const RECEIPT_RUN_ID = "transport-gate-scratch-live";
const RECEIPT_BRIEF_ID = "brief-gate-scratch";
const CITATION_MARK = "— in scope of your GO, receipt ";

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

function runLocal(args, input) {
  const output = execFileSync(process.execPath, [localRuntime, ...args, "--json"], {
    cwd: os.tmpdir(),
    input: input ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    env: hookEnv()
  });
  return JSON.parse(output);
}

function makeWorkspace(name, gate) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `nogra-gate-scratch-${name}-`)));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `gate-scratch-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) {
    config.gate = gate;
  }
  writeJson(path.join(root, ".nogra", "config.json"), config);
  return root;
}

function writeReceipt(root, overrides = {}) {
  const receipt = {
    runId: RECEIPT_RUN_ID,
    briefId: RECEIPT_BRIEF_ID,
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

function makeScratchWorkspace(name, gate, receiptOverrides = {}) {
  const root = makeWorkspace(name, gate);
  const scratch = path.join(root, "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(scratch, "tmpfile.txt"), "x", "utf8");
  writeReceipt(root, { scratchRoots: [scratch], ...receiptOverrides });
  return { root, scratch };
}

function bashInput(root, command, sessionId, cwd = root) {
  return {
    cwd,
    workspace_roots: [root],
    tool_name: "Bash",
    tool_input: { command },
    session_id: sessionId,
    transcript_path: `/tmp/transcript-${sessionId}.jsonl`
  };
}

function writeToolInput(root, toolName, filePath, sessionId) {
  return {
    cwd: root,
    workspace_roots: [root],
    tool_name: toolName,
    tool_input: toolName === "Write"
      ? { file_path: filePath, content: "scratch note" }
      : toolName === "MultiEdit"
        ? { file_path: filePath, edits: [{ old_string: "a", new_string: "b" }] }
        : { file_path: filePath, old_string: "a", new_string: "b" },
    session_id: sessionId,
    transcript_path: `/tmp/transcript-${sessionId}.jsonl`
  };
}

function permissionReview(output) {
  return String(output.hookSpecificOutput?.permissionDecisionReason || output.systemMessage || "");
}

// Pre-change byte baselines (captured 2026-07-04 BEFORE the run-scratch class
// landed). The ask message for a receipt-present, not-covered destructive rm
// and the no-receipt ask carry no target path, so they compare byte-for-byte
// across fixture workspaces.
function askJson(message) {
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

const RM_NOT_COVERED_BASELINE = askJson([
  "Nogra check: destructive rm",
  "Approve only if you intended this now",
  "Impact: may delete local files recursively or forcefully; reversibility may be low",
  `Why: recent Nogra run ${RECEIPT_RUN_ID} exists, but it does not cover destructive rm`,
  "Next: approve once to continue, or stop and brief this action first",
  `Audit: action=destructive rm; coverage=not-covered; receipt=${RECEIPT_RUN_ID} status=queued.`
].join("\n"));

const RM_NO_RECEIPT_BASELINE = askJson([
  "Nogra check: destructive rm",
  "Approve only if you intended this now",
  "Impact: may delete local files recursively or forcefully; reversibility may be low",
  "Why: no active Nogra run covers destructive rm",
  "Next: approve once to continue, or stop and brief this action first",
  "Audit: action=destructive rm; coverage=missing; receipt=none."
].join("\n"));

function assertScratchAllow(output, opLabel, label) {
  assert(output.hookSpecificOutput?.permissionDecision === "allow", `${label}: scratch-internal ${opLabel} should emit permissionDecision allow`);
  const reason = String(output.hookSpecificOutput?.permissionDecisionReason || "");
  assert(reason.includes("Nogra approved this run"), `${label}: allow reason should use the approval phrasing`);
  assert(reason.includes(`approved run-scratch ${opLabel} ${CITATION_MARK}${RECEIPT_RUN_ID}`), `${label}: allow reason should carry the exact citation line`);
  assert(reason.includes("inside declared scratch roots"), `${label}: allow reason should say the target is inside declared scratch roots`);
}

function assertScratchEscapeAsk(raw, opLabel, label) {
  assert(!raw.includes("\"permissionDecision\":\"allow\""), `${label}: an escape must never allow`);
  const output = JSON.parse(raw);
  assert(output.hookSpecificOutput?.permissionDecision === "ask", `${label}: an escape should ask`);
  const review = permissionReview(output);
  assert(review.includes(`Nogra check: run-scratch ${opLabel} escapes the run's declared scratch roots`), `${label}: escape review should carry the escape headline`);
  assert(review.includes("coverage=scratch-escape"), `${label}: escape audit line should mark scratch-escape coverage`);
  assert(review.includes(RECEIPT_RUN_ID), `${label}: escape review should name the receipt`);
}

function assertNeverAllows(raw, label) {
  assert(!raw.includes("\"permissionDecision\":\"allow\""), `${label} must never emit permissionDecision allow`);
  assert(!raw.includes("\"behavior\":\"allow\""), `${label} must never answer a permission dialog with allow`);
}

function main() {
  const cleanupRoots = [];
  const track = (root) => {
    cleanupRoots.push(root);
    return root;
  };

  // --- Case 1: dispatch declares deterministic scratchRoots on the receipt.
  const dispatchWs = track(makeWorkspace("dispatch"));
  const brief = {
    title: "Run-scratch smoke brief",
    intent: "Prove dispatch declares deterministic scratchRoots.",
    contextHandoff: "Smoke workspace created by the run-scratch gate smoke.",
    scope: {
      in: ["Create local smoke evidence."],
      out: ["No external control-plane dependency."],
      files: [".nogra/briefs/drafts"]
    },
    successCriteria: ["Dispatch receipt declares scratchRoots."],
    stopCriteria: ["If local validation fails, stop."],
    maxOutput: { format: "evidence-first state brief", limit: "short" }
  };
  const saved = runLocal(["brief-save", "--root", dispatchWs, "--source", "run-scratch-smoke"], brief);
  assert(saved.valid === true, "brief-save should accept the smoke brief");
  const defaultDispatch = runLocal(["dispatch", "--root", dispatchWs, "--brief-id", saved.briefId]);
  assert(defaultDispatch.status === "ready", "dispatch should create a receipt");
  const expectedArtifactsRoot = path.join(dispatchWs, ".nogra", "transport", "artifacts", defaultDispatch.runId);
  assert(Array.isArray(defaultDispatch.scratchRoots) && defaultDispatch.scratchRoots.length === 1, "default dispatch should declare exactly one scratch root");
  assert(defaultDispatch.scratchRoots[0] === expectedArtifactsRoot, "default scratch root should be the run's own artifacts dir (absolute, deterministic)");
  const defaultRun = JSON.parse(fs.readFileSync(path.join(dispatchWs, ".nogra", "transport", "runs", `${defaultDispatch.runId}.json`), "utf8"));
  assert(Array.isArray(defaultRun.scratchRoots) && defaultRun.scratchRoots[0] === expectedArtifactsRoot, "run receipt should persist scratchRoots top-level");
  assert(defaultRun.metadata?.scratchRoots?.[0] === expectedArtifactsRoot, "run receipt metadata should persist scratchRoots");

  const extraScratch = path.join(dispatchWs, "session-scratch");
  fs.mkdirSync(extraScratch, { recursive: true });
  const flaggedDispatch = runLocal([
    "dispatch", "--root", dispatchWs, "--brief-id", saved.briefId,
    "--scratch-root", extraScratch,
    "--scratch-root", extraScratch,
    "--scratch-root", "relative-scratch"
  ]);
  assert(flaggedDispatch.status === "ready", "dispatch with --scratch-root should create a receipt");
  const flaggedExpected = [
    path.join(dispatchWs, ".nogra", "transport", "artifacts", flaggedDispatch.runId),
    fs.realpathSync(extraScratch),
    path.join(dispatchWs, "relative-scratch")
  ];
  assert(JSON.stringify(flaggedDispatch.scratchRoots) === JSON.stringify(flaggedExpected), `repeatable --scratch-root should append deduped, normalized roots after the artifacts dir (got ${JSON.stringify(flaggedDispatch.scratchRoots)})`);

  // --- Case 2: scratch-internal write-ops under a scratchRoots receipt
  // auto-approve WITH the citation.
  const { root: allowWs, scratch: allowScratch } = makeScratchWorkspace("allow", { mode: "advisory", autoApprove: true });
  track(allowWs);
  const allowCases = [
    ["rm", `rm -rf ${path.join(allowScratch, "tmpfile.txt")}`],
    ["rm", `rm ${path.join(allowScratch, "tmpfile.txt")}`],
    ["mkdir", `mkdir -p ${path.join(allowScratch, "sub", "deep")}`],
    ["touch", `touch ${path.join(allowScratch, "marker.txt")}`],
    ["rmdir", `rmdir ${path.join(allowScratch, "sub")}`],
    ["mv", `mv ${path.join(allowScratch, "tmpfile.txt")} ${path.join(allowScratch, "renamed.txt")}`],
    ["cp", `cp ${path.join(allowScratch, "tmpfile.txt")} ${path.join(allowScratch, "copy.txt")}`]
  ];
  for (const [op, command] of allowCases) {
    assertScratchAllow(
      runHook(preToolUseHook, bashInput(allowWs, command, `scratch-allow-${op}-${command.length}`)),
      op,
      `Bash ${op} inside scratch`
    );
  }
  // Relative path resolved against the session cwd inside the scratch root.
  assertScratchAllow(
    runHook(preToolUseHook, bashInput(allowWs, "rm tmpfile.txt", "scratch-allow-relative", allowScratch)),
    "rm",
    "relative-path rm with cwd inside scratch"
  );
  for (const toolName of ["Write", "Edit", "MultiEdit"]) {
    assertScratchAllow(
      runHook(preToolUseHook, writeToolInput(allowWs, toolName, path.join(allowScratch, "note.md"), `scratch-allow-${toolName.toLowerCase()}`)),
      toolName.toLowerCase(),
      `${toolName} tool inside scratch`
    );
  }
  // PermissionRequest responder answers the dialog for the covered action.
  const scratchPermission = runHook(permissionRequestHook, bashInput(allowWs, `rm -rf ${path.join(allowScratch, "copy.txt")}`, "scratch-allow-permreq"));
  assert(scratchPermission.hookSpecificOutput?.decision?.behavior === "allow", "PermissionRequest responder should allow a covered scratch write-op");
  assert(String(scratchPermission.systemMessage || "").includes(`${CITATION_MARK}${RECEIPT_RUN_ID}`), "PermissionRequest answer should carry the citation line");

  // --- Case 3: the same commands OUTSIDE the declared roots keep today's
  // byte-identical behavior (ask for rm, silent for mkdir/touch).
  const outsideRm = runHookRaw(preToolUseHook, bashInput(allowWs, `rm -rf ${path.join(allowWs, "src", "app.mjs")}`, "scratch-outside-rm"));
  assert(outsideRm === RM_NOT_COVERED_BASELINE, "rm outside scratch roots must stay byte-identical to the pre-change not-covered ask");
  assert(runHookRaw(preToolUseHook, bashInput(allowWs, `mkdir -p ${path.join(allowWs, "src", "newdir")}`, "scratch-outside-mkdir")) === "", "mkdir outside scratch roots must stay byte-identical (silent)");
  assert(runHookRaw(preToolUseHook, bashInput(allowWs, "rm $HOME/unrelated.txt", "scratch-outside-var")) === "", "unresolvable non-scratch target must keep today's silent fall-through");

  // --- Case 4: EXEC IS FAIL-CLOSED — interpreters/arbitrary binaries with
  // scratch-internal arguments never auto-approve and stay byte-identical
  // (silent gate; the native permission flow asks exactly as today).
  fs.writeFileSync(path.join(allowScratch, "evil.py"), "print('x')\n", "utf8");
  fs.writeFileSync(path.join(allowScratch, "x.mjs"), "console.log('x')\n", "utf8");
  const execCommands = [
    ["python3", `python3 ${path.join(allowScratch, "evil.py")}`],
    ["node", `node ${path.join(allowScratch, "x.mjs")}`],
    ["sh", `sh ${path.join(allowScratch, "evil.py")}`],
    ["bash", `bash ${path.join(allowScratch, "evil.py")}`],
    ["npx", `npx tsx ${path.join(allowScratch, "x.mjs")}`],
    ["uvx", `uvx run ${path.join(allowScratch, "evil.py")}`]
  ];
  for (const [name, command] of execCommands) {
    const raw = runHookRaw(preToolUseHook, bashInput(allowWs, command, `scratch-exec-${name}`));
    assertNeverAllows(raw, `exec ${name} with scratch-internal args`);
    assert(raw === "", `exec ${name} with scratch-internal args must stay byte-identical to the pre-change silent gate (native flow asks)`);
    const permReq = runHookRaw(permissionRequestHook, bashInput(allowWs, command, `scratch-exec-${name}-permreq`));
    assert(permReq.trim() === "", `PermissionRequest responder must stay silent for exec ${name} with scratch-internal args`);
  }

  // --- Case 5: compound/piped/redirected forms are fail-closed — never
  // eligible for run-scratch even when every named path is inside scratch.
  const compoundCases = [
    ["chained-mkdir", `mkdir -p ${path.join(allowScratch, "a")} && mkdir -p ${path.join(allowScratch, "b")}`],
    ["semicolon-rm", `rm -rf ${path.join(allowScratch, "a")}; rm -rf ${path.join(allowScratch, "b")}`],
    ["piped-touch", `touch ${path.join(allowScratch, "a.txt")} | cat`],
    ["redirect-touch", `touch ${path.join(allowScratch, "a.txt")} > ${path.join(allowScratch, "b.txt")}`],
    ["subshell-rm", `rm -rf $(echo ${path.join(allowScratch, "a")})`]
  ];
  for (const [name, command] of compoundCases) {
    assertNeverAllows(
      runHookRaw(preToolUseHook, bashInput(allowWs, command, `scratch-compound-${name}`)),
      `compound form (${name})`
    );
  }

  // --- Case 6: ../ and symlink escapes ask; mv/cp crossing the boundary in
  // either direction asks; unresolvable globs on scratch paths ask.
  assertScratchEscapeAsk(
    runHookRaw(preToolUseHook, bashInput(allowWs, `rm -rf ${allowScratch}/../victim.txt`, "scratch-escape-dotdot")),
    "rm",
    "../ escape"
  );
  const outsideDir = path.join(allowWs, "outside");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "target.txt"), "x", "utf8");
  fs.symlinkSync(outsideDir, path.join(allowScratch, "link"));
  assertScratchEscapeAsk(
    runHookRaw(preToolUseHook, bashInput(allowWs, `rm -rf ${path.join(allowScratch, "link", "target.txt")}`, "scratch-escape-symlink")),
    "rm",
    "symlink escape"
  );
  assertScratchEscapeAsk(
    runHookRaw(preToolUseHook, bashInput(allowWs, `mv ${path.join(allowScratch, "renamed.txt")} ${path.join(allowWs, "kept.txt")}`, "scratch-escape-mv-out")),
    "mv",
    "mv crossing the boundary out"
  );
  assertScratchEscapeAsk(
    runHookRaw(preToolUseHook, bashInput(allowWs, `cp ${path.join(allowWs, "outside", "target.txt")} ${path.join(allowScratch, "pulled.txt")}`, "scratch-escape-cp-in")),
    "cp",
    "cp crossing the boundary in"
  );
  assertScratchEscapeAsk(
    runHookRaw(preToolUseHook, bashInput(allowWs, `rm -rf ${allowScratch}/*.txt`, "scratch-escape-glob")),
    "rm",
    "unresolvable glob under a scratch root"
  );
  const escapePermission = runHookRaw(permissionRequestHook, bashInput(allowWs, `rm -rf ${allowScratch}/../victim.txt`, "scratch-escape-permreq"));
  assert(escapePermission.trim() === "", "PermissionRequest responder must stay silent on a scratch escape");

  // --- Case 7: precedence — gate-arming and non-goals stay ahead of
  // run-scratch. A write-op pulling .nogra/config.json INTO scratch is still
  // gate-arming; a declared non-goal still short-circuits first.
  const armingRaw = runHookRaw(preToolUseHook, bashInput(allowWs, `cp ${path.join(allowWs, ".nogra", "config.json")} ${path.join(allowScratch, "config-copy.json")}`, "scratch-arming"));
  assertNeverAllows(armingRaw, "cp of .nogra/config.json into scratch");
  assert(permissionReview(JSON.parse(armingRaw)).includes("Nogra check: gate-arming write"), "cp of .nogra/config.json into scratch must classify as gate-arming, not run-scratch");
  const { root: nonGoalWs, scratch: nonGoalScratch } = makeScratchWorkspace("non-goal", { mode: "advisory", autoApprove: true });
  track(nonGoalWs);
  writeJson(path.join(nonGoalWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "No destructive writes in this window.",
    gate: { nonGoals: ["destructive-write"] }
  });
  const nonGoalRaw = runHookRaw(preToolUseHook, bashInput(nonGoalWs, `rm -rf ${path.join(nonGoalScratch, "tmpfile.txt")}`, "scratch-non-goal"));
  assertNeverAllows(nonGoalRaw, "non-goal scratch rm");
  assert(permissionReview(JSON.parse(nonGoalRaw)).includes("declared non-goal"), "a declared non-goal must short-circuit before run-scratch coverage");

  // --- Case 8: no coverage without the full receipt chain — receipt without
  // scratchRoots, opt-in off, expired receipt, absent receipt, and
  // approval-blocking status all keep today's behavior and never allow.
  const noRootsWs = track(makeWorkspace("no-scratchroots", { mode: "advisory", autoApprove: true }));
  writeReceipt(noRootsWs);
  const noRootsScratch = path.join(noRootsWs, "scratch");
  fs.mkdirSync(noRootsScratch, { recursive: true });
  assert(runHookRaw(preToolUseHook, bashInput(noRootsWs, `rm -rf ${path.join(noRootsScratch, "tmpfile.txt")}`, "scratch-noroots-rm")) === RM_NOT_COVERED_BASELINE, "receipt without scratchRoots must keep the byte-identical not-covered ask");
  assert(runHookRaw(preToolUseHook, bashInput(noRootsWs, `mkdir -p ${path.join(noRootsScratch, "sub")}`, "scratch-noroots-mkdir")) === "", "receipt without scratchRoots must keep mkdir silent (native flow decides)");

  const { root: offWs, scratch: offScratch } = makeScratchWorkspace("opt-in-off", undefined);
  track(offWs);
  const offSweep = [
    runHookRaw(preToolUseHook, bashInput(offWs, `rm -rf ${path.join(offScratch, "tmpfile.txt")}`, "scratch-off-rm")),
    runHookRaw(preToolUseHook, bashInput(offWs, `mkdir -p ${path.join(offScratch, "sub")}`, "scratch-off-mkdir")),
    runHookRaw(permissionRequestHook, bashInput(offWs, `rm -rf ${path.join(offScratch, "tmpfile.txt")}`, "scratch-off-permreq"))
  ];
  for (const raw of offSweep) {
    assertNeverAllows(raw, "opt-in-off workspace with scratchRoots receipt");
  }
  assert(offSweep[0] === RM_NOT_COVERED_BASELINE, "opt-in-off scratch rm must keep the byte-identical not-covered ask");
  assert(offSweep[1] === "", "opt-in-off scratch mkdir must stay silent");

  const { root: expiredWs, scratch: expiredScratch } = makeScratchWorkspace("expired", { mode: "advisory", autoApprove: true }, {
    updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
  });
  track(expiredWs);
  assert(runHookRaw(preToolUseHook, bashInput(expiredWs, `rm -rf ${path.join(expiredScratch, "tmpfile.txt")}`, "scratch-expired-rm")) === RM_NO_RECEIPT_BASELINE, "an expired receipt must fall back to the byte-identical no-receipt ask");

  const absentWs = track(makeWorkspace("absent", { mode: "advisory", autoApprove: true }));
  const absentScratch = path.join(absentWs, "scratch");
  fs.mkdirSync(absentScratch, { recursive: true });
  assert(runHookRaw(preToolUseHook, bashInput(absentWs, `rm -rf ${path.join(absentScratch, "tmpfile.txt")}`, "scratch-absent-rm")) === RM_NO_RECEIPT_BASELINE, "an absent receipt must keep the byte-identical no-receipt ask");

  const { root: partialWs, scratch: partialScratch } = makeScratchWorkspace("partial", { mode: "advisory", autoApprove: true }, {
    status: "partial",
    phase: "returned",
    nextOwner: "Manager",
    returnReason: "Work stopped before completion.",
    paths: { validation: `.nogra/transport/artifacts/${RECEIPT_RUN_ID}/validation.json` },
    artifacts: { validationExists: true }
  });
  track(partialWs);
  writeJson(path.join(partialWs, ".nogra", "transport", "artifacts", RECEIPT_RUN_ID, "validation.json"), { verdict: "partial" });
  const partialRaw = runHookRaw(preToolUseHook, bashInput(partialWs, `rm -rf ${path.join(partialScratch, "tmpfile.txt")}`, "scratch-partial-rm"));
  assertNeverAllows(partialRaw, "partial-status receipt with scratchRoots");

  // --- Case 9: citation surface on BOTH coverage classes — the existing
  // receipt scope-match allow carries the same grep-provable citation line.
  const scopeWs = track(makeWorkspace("scope-match", { mode: "advisory", autoApprove: true }));
  writeReceipt(scopeWs, {
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  const scopeAllow = runHook(preToolUseHook, bashInput(scopeWs, "vercel --prod", "scratch-scope-allow"));
  assert(scopeAllow.hookSpecificOutput?.permissionDecision === "allow", "control: scope-match receipt should still allow");
  const scopeReason = String(scopeAllow.hookSpecificOutput?.permissionDecisionReason || "");
  assert(scopeReason.includes(`approved production deploy ${CITATION_MARK}${RECEIPT_RUN_ID}`), "scope-match allow reason should carry the exact citation line");
  const scopePermission = runHook(permissionRequestHook, bashInput(scopeWs, "vercel --prod", "scratch-scope-permreq"));
  assert(String(scopePermission.systemMessage || "").includes(CITATION_MARK), "scope-match PermissionRequest answer should carry the citation line");

  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("gate run-scratch smoke passed: dispatch declares deterministic scratchRoots (artifacts dir + repeatable --scratch-root), scratch-internal write-ops allow with the citation, exec stays fail-closed (silent, never allow), compound/piped/redirect forms never allow, ../ and symlink escapes and mv/cp boundary crossings ask, no-scratchRoots/opt-in-off/expired/absent/partial receipts keep byte-identical pre-change behavior, gate-arming and non-goals keep precedence, and both coverage classes carry the grep-provable citation");
}

main();
