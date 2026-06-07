#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");
const ledgerRuntime = path.join(pluginRoot, "scripts", "nogra-ledger.mjs");
const sessionStartHook = path.join(pluginRoot, "hooks", "session-start.mjs");
const userPromptSubmitHook = path.join(pluginRoot, "hooks", "user-prompt-submit.mjs");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");

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
      frontmatter[match[1]] = match[2].trim();
    }
  }
  return frontmatter;
}

function agentFrontmatter(fileName) {
  return parseFrontmatter(fs.readFileSync(path.join(pluginRoot, "agents", fileName), "utf8"));
}

function agentText(fileName) {
  return fs.readFileSync(path.join(pluginRoot, "agents", fileName), "utf8");
}

function pluginText(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

function displayRuntime(runtime) {
  return String(runtime || "")
    .trim()
    .replace(/^anthropic:/, "")
    .replace(/^claude-/, "")
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part, index) => (/^\d+$/.test(part) && index > 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ")
    .replace(/\b(\d)\s+(\d)\b/g, "$1.$2");
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function run(args, input, env = {}) {
  const output = execFileSync(process.execPath, [localRuntime, ...args, "--json"], {
    cwd: repoRoot,
    input: input ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env }
  });
  return JSON.parse(output);
}

function runLedger(args, input, cwd = repoRoot) {
  const output = execFileSync(process.execPath, [ledgerRuntime, ...args, "--json"], {
    cwd,
    input: input ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function runHook(hook, input) {
  const output = execFileSync(process.execPath, [hook], {
    cwd: repoRoot,
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot }
  });
  return JSON.parse(output);
}

function runSessionStartHook(input) {
  return runHook(sessionStartHook, input);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRunFails(args, message) {
  try {
    run(args);
  } catch {
    return;
  }
  throw new Error(message);
}

function resolveManagerRoot() {
  const nested = path.join(repoRoot, "manager");
  if (fs.existsSync(path.join(nested, ".nogra", "config.json"))) {
    return nested;
  }
  if (fs.existsSync(path.join(repoRoot, ".nogra", "config.json"))) {
    return repoRoot;
  }
  const fallback = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-manager-runtime-smoke-"));
  writeJson(path.join(fallback, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceName: "Manager Runtime Smoke",
    workspaceId: "manager-runtime-smoke",
    installMode: "plugin",
    connectionMode: "local"
  });
  return fallback;
}

function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-local-runtime-smoke-"));
  const managerRoot = resolveManagerRoot();
  const executorFrontmatter = agentFrontmatter("executor.md");
  const verifierFrontmatter = agentFrontmatter("verifier.md");
  const executorPrompt = agentText("executor.md");
  const dispatchSkill = pluginText(path.join("skills", "dispatch", "SKILL.md"));
  const verifySkill = pluginText(path.join("skills", "verify", "SKILL.md"));
  const expectedExecutorRuntime = "anthropic:sonnet";
  const expectedExecutorRuntimeDisplay = displayRuntime(expectedExecutorRuntime);
  const expectedVerifierRuntime = "sonnet";
  assert(!executorFrontmatter.model, "executor role frontmatter should not hardcode model");
  assert(!executorFrontmatter.effort, "executor role frontmatter should not hardcode effort");
  assert(!verifierFrontmatter.model, "verifier role frontmatter should not hardcode model");
  assert(!verifierFrontmatter.effort, "verifier role frontmatter should not hardcode effort");
  assert(executorPrompt.includes("## Pre-flight Blocks"), "executor role contract should define pre-flight block behavior");
  assert(executorPrompt.includes("## Safe Continuation"), "executor report should include a Safe Continuation section");
  assert(executorPrompt.includes("return it explicitly"), "executor should return known safe continuations when blocked");
  assert(executorPrompt.includes("Start the final response exactly with `# Executor Report`"), "executor should front-load the report title");
  assert(dispatchSkill.includes("Executor self-report is never verdict evidence"), "dispatch skill should keep verdicts independent from executor self-report quality");
  assert(verifySkill.includes("Executor self-report is never verdict evidence"), "verify skill should keep verdicts independent from executor self-report quality");

  const managerStatus = run(["status", "--root", managerRoot]);
  assert(managerStatus.workspace.mode === "local", "manager workspace should normalize to local");
  assert(managerStatus.hostedMcpUsed === false, "status should remain local");

  const init = run(["init", "--apply", "--root", temp, "--workspace-name", "Local Smoke"]);
  assert(init.status === "ok", "fresh local init should be ok");
  assert(init.hostedMcpUsed === false, "init should remain local");
  assert(fs.existsSync(path.join(temp, ".nogra", "config.json")), "init should create .nogra/config.json");
  assert(fs.existsSync(path.join(temp, "CLAUDE.md")), "init should create root CLAUDE.md when missing");
  for (const expectedPath of [
    ".nogra/.gitignore",
    ".nogra/README.md",
    ".nogra/state/SESSION-CHECKPOINT.md",
    ".nogra/state/CURRENT-TASKS.md",
    ".nogra/state/DECISIONS.md",
    ".nogra/state/PROJECT-STRUCTURE.md",
    ".nogra/briefs/.gitkeep",
    ".nogra/runs/.gitkeep",
    ".nogra/evidence/.gitkeep",
    ".nogra/receipts/.gitkeep",
    ".nogra/reports/.gitkeep",
    ".nogra/checkpoints/.gitkeep",
    ".nogra/ledger/.gitkeep",
    ".nogra/memory/local/MEMORY.md",
    ".nogra/memory/sync/.gitkeep",
    ".nogra/index/workspaces.jsonl",
    ".nogra/transport/.gitkeep"
  ]) {
    assert(fs.existsSync(path.join(temp, expectedPath)), `init should create ${expectedPath}`);
  }
  for (const legacyPath of [
    ".nogra/SESSION-CHECKPOINT.md",
    ".nogra/CURRENT-TASKS.md",
    ".nogra/DECISIONS.md",
    ".nogra/PROJECT-STRUCTURE.md",
    ".nogra/events/.gitkeep",
  ]) {
    assert(!fs.existsSync(path.join(temp, legacyPath)), `init should not create legacy loose path ${legacyPath}`);
  }
  const freshConfig = JSON.parse(fs.readFileSync(path.join(temp, ".nogra", "config.json"), "utf8"));
  assert(freshConfig.connectionMode === "local", "fresh config should declare local mode");
  assert(freshConfig.releaseVersion === "v1.0.0", "fresh config should declare releaseVersion");
  assert(!Object.hasOwn(freshConfig, "version"), "fresh config should not write root version");
  assert(!Object.hasOwn(freshConfig, ["play", "book", "Version"].join("")), "fresh config should not write legacy workspace field");
  assert(freshConfig.runtimePolicy?.profile === "default", "fresh config should use runtimePolicy profile default");
  assert(Object.keys(freshConfig.runtimePolicy?.roles || {}).length === 0, "fresh default config should not write concrete role runtime choices");
  assert(freshConfig.runtimePolicy?.budget?.mode === "default", "fresh default config should use default budget mode");
  assert(freshConfig.routingPolicy?.defaultLanguage === "en", "fresh config should be English-first");
  assert(Array.isArray(freshConfig.routingPolicy?.dictionary?.createIntent), "fresh config should include dictionary arrays");
  assert(freshConfig.routingPolicy.dictionary.createIntent.length === 0, "fresh routing phrase arrays should be empty");

  const status = run(["status", "--root", temp]);
  assert(status.workspace.mode === "local", "fresh workspace should be local");
  assert(status.workspace.releaseVersion === "v1.0.0", "fresh status should expose workspace releaseVersion");
  assert(status.workspace.contractVersion === "v1.0.0", "fresh status should expose workspace contractVersion");
  assert(status.hostedMcpUsed === false, "fresh status should remain local");
  assert(status.runtimePolicy?.profile === "default", "status should expose normalized runtimePolicy profile default");
  assert(status.routingPolicy?.configured === true, "fresh status should mark routingPolicy configured");
  assert(status.runtimePolicy?.configured === true, "fresh status should mark runtimePolicy configured");
  assert(status.ledger?.watermark === 0, "fresh status should expose empty ledger watermark");
  assert(status.ledger?.checkpointSourceWatermark === 0, "fresh status should expose checkpoint source watermark zero");
  assert(status.ledger?.checkpointStatus === "fresh", "fresh status should report checkpoint fresh against an empty ledger");
  assert(status.continuity?.status === "ready", "fresh status should report continuity layout ready");
  assert(status.continuity?.checkpoint?.hasSourceWatermark === true, "fresh checkpoint should carry SourceWatermark");

  const nestedManagerRoot = path.join(temp, "manager");
  const nestedManagerInit = run(["init", "--apply", "--root", nestedManagerRoot, "--workspace-name", "Nested Manager"]);
  assert(nestedManagerInit.status === "ok", "nested manager fixture should initialize cleanly");
  const rootPreference = runSessionStartHook({
    cwd: nestedManagerRoot,
    workspace_roots: [temp],
    session_id: "session-root-preference-001",
    transcript_path: "/tmp/transcript-root-preference-001.jsonl"
  });
  const rootPreferenceContext = rootPreference.hookSpecificOutput?.additionalContext || "";
  assert(rootPreferenceContext.includes(`workspaceRoot=${temp}`), "SessionStart should prefer workspace root .nogra over nested cwd .nogra");
  assert(!rootPreferenceContext.includes(`workspaceRoot=${nestedManagerRoot}`), "SessionStart should not boot from nested manager .nogra when workspace root has .nogra");
  assert(!fs.existsSync(path.join(nestedManagerRoot, ".nogra", "runtime", "session-anchor.json")), "SessionStart should not write session anchor under nested manager .nogra");
  const rootRoutingScorePath = path.join(temp, ".nogra", "runtime", "last-routing-score.json");
  const nestedRoutingScorePath = path.join(nestedManagerRoot, ".nogra", "runtime", "last-routing-score.json");
  const submitPreference = runHook(userPromptSubmitHook, {
    cwd: nestedManagerRoot,
    workspace_roots: [temp],
    session_id: "session-root-submit-001",
    transcript_path: "/tmp/transcript-root-submit-001.jsonl",
    prompt: "Build and verify a multi-file dashboard with tests and screenshots."
  });
  const submitPreferenceContext = submitPreference.hookSpecificOutput?.additionalContext || "";
  assert(submitPreferenceContext.includes("NOGRA_OFFER_GATE"), "UserPromptSubmit should emit the offer gate for scoped work");
  assert(fs.existsSync(rootRoutingScorePath), "UserPromptSubmit should write routing score under workspace root .nogra");
  assert(!fs.existsSync(nestedRoutingScorePath), "UserPromptSubmit should not write routing score under nested manager .nogra");
  const preToolPreference = runHook(preToolUseHook, {
    cwd: nestedManagerRoot,
    workspace_roots: [temp],
    session_id: "session-root-pretool-001",
    transcript_path: "/tmp/transcript-root-pretool-001.jsonl",
    tool_name: "Bash",
    tool_input: { command: "npm test" }
  });
  assert(preToolPreference.hookSpecificOutput?.permissionDecision === "ask", "PreToolUse should read the root pending routing score and ask");
  const rootRoutingScoreAfterPreTool = JSON.parse(fs.readFileSync(rootRoutingScorePath, "utf8"));
  assert(rootRoutingScoreAfterPreTool.preToolPermissionDecision === "ask", "PreToolUse should update routing score under workspace root .nogra");
  assert(!fs.existsSync(nestedRoutingScorePath), "PreToolUse should not create routing score under nested manager .nogra");

  const capturedAnchor = captureSessionAnchor(temp, {
    session_id: "session-smoke-001",
    transcript_path: "/tmp/transcript-smoke-001.jsonl",
    cwd: temp,
    permission_mode: "default"
  }, "SessionStart");
  assert(capturedAnchor?.sessionId === "session-smoke-001", "session anchor helper should preserve session id");
  assert(!Object.hasOwn(capturedAnchor, "source"), "session anchor helper should omit blank source field");
  assert(!Object.hasOwn(capturedAnchor, "model"), "session anchor helper should omit blank model field");

  const createPlan = run(["create-project", "Smoke Child", "--root", temp]);
  assert(createPlan.status === "ready", "create-project plan should be ready in initialized hub");
  assert(createPlan.project?.relativePath === "projects/smoke-child", "create-project should default under projects/<workspaceId>");
  assert(createPlan.hub?.willSetWorkspaceHubMode === true, "create-project plan should mark workspace hub mode intent");
  const createdProject = run(["create-project", "Smoke Child", "--root", temp, "--apply"]);
  assert(createdProject.status === "ok", "create-project apply should succeed");
  assert(fs.existsSync(path.join(temp, "projects", "smoke-child", ".nogra", "config.json")), "create-project should initialize project-local config");
  assert(fs.existsSync(path.join(temp, ".nogra", "index", "workspaces.jsonl")), "create-project should write hub workspace index");
  assert(fs.existsSync(path.join(temp, "projects", "smoke-child", ".nogra", "index", "workspaces.jsonl")), "create-project should write project self-index");
  const hubConfig = JSON.parse(fs.readFileSync(path.join(temp, ".nogra", "config.json"), "utf8"));
  assert(hubConfig.bootPolicy?.mode === "workspace-hub", "create-project should set workspace hub boot policy");
  assert(hubConfig.bootPolicy?.workspaceHub?.enabled === true, "create-project should enable workspace hub options");
  assert(!Object.hasOwn(hubConfig.bootPolicy, "managerHub"), "create-project should not write legacy managerHub options");

  for (const alias of ["legacy-hosted", "hosted", "hosted-public", "free-local", "free"]) {
    const aliasRoot = path.join(temp, `mode-alias-${alias}`);
    writeJson(path.join(aliasRoot, ".nogra", "config.json"), {
      schema: "nogra.config.v1",
      workspaceId: `mode-alias-${alias}`,
      installMode: "plugin",
      connectionMode: alias
    });
    const aliasStatus = run(["status", "--root", aliasRoot]);
    assert(aliasStatus.workspace.mode === "local", `${alias} should normalize to local`);
    assert(aliasStatus.workspace.source.includes("legacy alias"), `${alias} should report legacy alias source`);
  }

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-plugin-diagnostics-smoke-"));
  const fakeActiveRoot = path.join(fakeHome, ".claude", "plugins", "cache", "nogra-stable", "nogra", "0.2.3");
  const fakeOtherRoot = path.join(fakeHome, ".claude", "plugins", "cache", "nogra-legacy-local", "nogra", "0.2.2");
  writeJson(path.join(fakeActiveRoot, ".claude-plugin", "plugin.json"), {
    name: "nogra",
    version: "0.2.3"
  });
  writeJson(path.join(fakeOtherRoot, ".claude-plugin", "plugin.json"), {
    name: "nogra",
    version: "0.2.2"
  });
  writeJson(path.join(fakeHome, ".claude", "plugins", "marketplaces", "nogra-stable", ".claude-plugin", "marketplace.json"), {
    name: "nogra-stable",
    plugins: [
      {
        name: "nogra",
        version: "0.2.2",
        description: "stale marketplace test fixture"
      }
    ]
  });
  const diagnostics = run(["status", "--root", temp], null, {
    HOME: fakeHome,
    CLAUDE_PLUGIN_ROOT: fakeActiveRoot
  }).plugin.diagnostics;
  const warningCodes = diagnostics.warnings.map((warning) => warning.code);
  assert(warningCodes.includes("multiple-nogra-plugins-installed"), "status should warn on multiple installed Nogra plugin refs");
  assert(warningCodes.includes("marketplace-version-mismatch"), "status should warn on marketplace/plugin version mismatch");
  assert(diagnostics.warnings.every((warning) => warning.blocking === false), "plugin diagnostics warnings should be non-blocking");

  const brief = {
    title: "Local smoke brief",
    intent: "Prove local Nogra brief save works through plugin-local records.",
    contextHandoff: "Smoke workspace created by local runtime.",
    scope: {
      in: ["Create local smoke evidence."],
      out: ["No external control-plane dependency."],
      files: [".nogra/briefs/drafts"]
    },
    successCriteria: ["Brief draft is written locally."],
    stopCriteria: ["If local validation fails, stop."],
    maxOutput: {
      format: "evidence-first state brief",
      limit: "short"
    }
  };

  const validation = run(["brief-validate", "--root", temp], brief);
  assert(validation.valid === true, "brief should validate locally");
  assert(validation.hostedMcpUsed === false, "brief validation should remain local");
  assert(validation.normalized?.owner === "Manager", "brief validation should default owner to Manager");
  assert(validation.normalized?.nextOwner === "nogra:executor", "brief validation should default nextOwner to nogra:executor");

  const saved = run(["brief-save", "--root", temp, "--source", "smoke"], brief);
  assert(saved.valid === true, "brief-save should write a valid draft");
  assert(saved.owner === "Manager", "brief-save should persist Manager as owner");
  assert(saved.nextOwner === "nogra:executor", "brief-save should persist nextOwner as the executor role");
  assert(saved.ledgerWatermark === 1, "brief-save should append ledger watermark 1");
  assert(fs.existsSync(path.join(temp, saved.path)), "brief-save should write draft JSON");
  assert(fs.existsSync(path.join(temp, saved.overviewPath)), "brief-save should write stable overview text");

  const promoted = run(["brief-promote", "--root", temp, "--brief-id", saved.briefId]);
  assert(promoted.status === "ready", "brief-promote should mark the brief ready");
  assert(promoted.ledgerWatermark === 2, "brief-promote should append ledger watermark 2");
  assert(fs.existsSync(path.join(temp, promoted.path)), "brief-promote should write promoted markdown");
  assert(fs.existsSync(path.join(temp, promoted.draft.overviewPath)), "brief-promote should refresh stable overview text");
  const promotedAbsolute = promoted.absolutePath;
  assert(fs.existsSync(promotedAbsolute), "brief-promote should expose an existing absolute path");
  const promotedFileUrl = pathToFileURL(promotedAbsolute).href;
  assert(promoted.fileUrl === promotedFileUrl, "brief-promote should expose a file:// URL for the promoted brief");
  assert(promoted.brief?.fileUrl === promotedFileUrl, "promoted brief payload should expose the same file:// URL");
  assert(promoted.openBriefLink === `[Open brief](${promotedFileUrl})`, "brief-promote should expose a bare Open brief markdown link");
  assert(!promoted.openBriefLink.includes(":1)"), "Open brief file:// link should not include a line-number suffix");

  const receipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  assert(receipt.status === "ready", "dispatch should create a local receipt");
  assert(receipt.hostedMcpUsed === false, "dispatch should remain local");
  assert(receipt.target === "executor", "dispatch should default target to executor");
  assert(receipt.ledgerWatermark === 3, "dispatch should append ledger watermark 3");
  assert(receipt.sessionId === "session-smoke-001", "dispatch should carry current session id anchor");
  assert(receipt.transcriptId === "transcript-smoke-001", "dispatch should carry current transcript id anchor");
  const runFile = path.join(temp, ".nogra", "transport", "runs", `${receipt.runId}.json`);
  assert(fs.existsSync(runFile), "dispatch should write local transport run");
  const receiptRun = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert(receiptRun.ledgerWatermark === receipt.ledgerWatermark, "run state should persist dispatch ledger watermark");
  assert(receiptRun.sessionId === "session-smoke-001", "run state should persist session id anchor");
  assert(receipt.executionRole === "nogra:executor", "dispatch receipt should expose executionRole");
  assert(receipt.executionRuntime === expectedExecutorRuntime, "dispatch receipt should expose executionRuntime beside role");
  assert(receipt.executionEffort === "medium", "dispatch receipt should expose default executor effort");
  assert(Number.isInteger(receipt.executionMaxTurns) && receipt.executionMaxTurns > 0, "dispatch should derive executionMaxTurns from the approved brief");
  assert(receipt.executionSizing?.source === "approved brief dispatch sizing", "dispatch should record brief-derived execution sizing");
  assert(receipt.executionSizing?.requiresManagerDecision === false, "normal dispatch sizing should not require Manager decision");
  assert(String(receipt.executionSizing?.summary || "").startsWith(`maxTurns ${receipt.executionMaxTurns}:`), "dispatch sizing should include a one-line summary");
  assert(receipt.executionRuntimePolicyProfile === "default", "dispatch receipt should expose runtime policy profile");
  assert(receipt.executionLabel === `Executor · ${expectedExecutorRuntimeDisplay} · Queued`, "dispatch receipt should expose role/runtime/status label");
  assert(receipt.owner === "Manager", "dispatch receipt should expose Manager as owner");
  assert(receipt.nextOwner === "nogra:executor", "normal dispatch should route nextOwner to the executor role");
  assert(receipt.run?.executionRole === "nogra:executor", "run state should persist executionRole");
  assert(receipt.run?.owner === "Manager", "run state should persist Manager as owner");
  assert(receipt.run?.nextOwner === "nogra:executor", "run state should persist the executor role as nextOwner");
  assert(receiptRun.executionRuntime === expectedExecutorRuntime, "run state should persist executionRuntime");
  assert(receiptRun.executionEffort === "medium", "run state should persist executionEffort");
  assert(receiptRun.executionMaxTurns === receipt.executionMaxTurns, "run state should persist dispatch-derived maxTurns");
  assert(receiptRun.executionSizing?.source === receipt.executionSizing.source, "run state should persist execution sizing source");
  assert(receiptRun.metadata?.executionRuntime === expectedExecutorRuntime, "run metadata should persist executionRuntime");
  assert(receiptRun.metadata?.executionEffort === "medium", "run metadata should persist executionEffort");
  assert(receiptRun.metadata?.executionMaxTurns === receipt.executionMaxTurns, "run metadata should persist executionMaxTurns");
  assert(receipt.executionCrossing?.runtime === expectedExecutorRuntime, "execution crossing should expose runtime beside role");
  assert(receipt.executionCrossing?.effort === "medium", "execution crossing should expose effort beside runtime");
  assert(receipt.executionCrossing?.maxTurns === receipt.executionMaxTurns, "execution crossing should carry dispatch-derived maxTurns");
  assert(receipt.executionCrossing?.sizingDecisionRequired === false, "normal execution crossing should not require sizing decision");

  const verifierDispatch = run(["dispatch", "--root", temp, "--brief-id", saved.briefId, "--target", "verifier"]);
  assert(verifierDispatch.status === "ready", "verifier dispatch should create a local receipt");
  assert(verifierDispatch.targetRole === "verifier", "verifier dispatch should preserve targetRole");
  assert(verifierDispatch.executionRole === "nogra:verifier", "verifier dispatch should expose verifier executionRole");
  assert(verifierDispatch.nextOwner === "nogra:verifier", "verifier dispatch should route nextOwner to the verifier role");
  assert(verifierDispatch.executionRuntime === expectedVerifierRuntime, "verifier dispatch should use verifier runtime policy");
  assert(verifierDispatch.executionEffort === "medium", "verifier dispatch should use verifier effort policy");
  assert(verifierDispatch.run?.nextOwner === "nogra:verifier", "verifier run state should persist verifier nextOwner");
  assert(verifierDispatch.executionCrossing?.role === "nogra:verifier", "verifier execution crossing should carry verifier role");
  assert(String(verifierDispatch.executionCrossing?.nextStep || "").includes("nogra:verifier"), "verifier execution crossing should instruct verifier spawn");
  const finalizedVerifier = runLedger(["finalize-run", "--root", temp], {
    runId: verifierDispatch.runId,
    status: "ok",
    summary: "Verifier run finalized by smoke."
  });
  assert(finalizedVerifier.status === "ok", "ledger finalize-run should complete verifier run");
  const finalizedVerifierRun = JSON.parse(fs.readFileSync(path.join(temp, ".nogra", "transport", "runs", `${verifierDispatch.runId}.json`), "utf8"));
  assert(finalizedVerifierRun.ledgerWatermark > verifierDispatch.ledgerWatermark, "ledger finalize-run should append a newer ledger watermark");

  const nestedCwd = path.join(temp, "nested", "verification-cwd");
  fs.mkdirSync(nestedCwd, { recursive: true });
  const nestedRunCheck = runLedger(["check-run", "--root", nestedCwd, "--run-id", receipt.runId], null, nestedCwd);
  assert(nestedRunCheck.status === "ok", "ledger helper should resolve nested cwd to nearest Nogra root");
  assert(nestedRunCheck.runId === receipt.runId, "nested ledger check should find the dispatched run");

  const uninitializedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-no-root-fallback-"));
  const uninitializedStatus = run(["status", "--root", uninitializedRoot]);
  assert(uninitializedStatus.workspace?.root === fs.realpathSync(uninitializedRoot), "root resolver should fall back when no .nogra exists");
  assert(uninitializedStatus.workspace?.initialized === false, "fallback root without .nogra should remain not initialized");

  const nestedSetupTarget = path.join(temp, "nested", "setup-target");
  fs.mkdirSync(nestedSetupTarget, { recursive: true });
  const nestedBundle = run(["init-bundle", "--root", nestedSetupTarget]);
  assert(nestedBundle.workspaceName === "setup-target", "init-bundle should target the requested root, not the parent .nogra");
  const nestedConfigFile = nestedBundle.files.find((file) => file.path === ".nogra/config.json");
  assert(nestedConfigFile, "nested init-bundle should include config");
  const nestedConfig = JSON.parse(nestedConfigFile.content);
  assert(nestedConfig.workspaceName === "setup-target", "nested init-bundle config should use requested root name");
  const nestedInit = run(["init", "--apply", "--root", nestedSetupTarget]);
  assert(nestedInit.bundle?.workspaceName === "setup-target", "init --apply should target the requested root, not the parent .nogra");
  assert(fs.existsSync(path.join(nestedSetupTarget, ".nogra", "config.json")), "nested init should create .nogra in requested root");

  const genericHandoff = run(["handoff-contract", "--root", temp, "--kind", "executor"]);
  assert(genericHandoff.targetSubagent?.maxTurnsHint === Number(executorFrontmatter.maxTurns), "generic executor handoff should retain role frontmatter maxTurns fallback");
  assert(genericHandoff.targetSubagent?.maxTurnsHintSource === "role frontmatter fallback", "generic executor handoff should label role frontmatter as fallback");

  const handoff = run(["handoff-contract", "--root", temp, "--kind", "executor", "--run-id", receipt.runId]);
  assert(handoff.status === "ready", "executor handoff should be ready");
  assert(handoff.hostedMcpUsed === false, "handoff should remain local");
  assert(handoff.targetSubagent?.scopedRole === "nogra:executor", "executor handoff should target scoped nogra:executor role");
  assert(handoff.roleRuntime?.executionRole === "nogra:executor", "executor handoff should expose role/runtime pair");
  assert(handoff.roleRuntime?.executionRuntime === expectedExecutorRuntime, "executor handoff runtime should come from release default");
  assert(handoff.roleRuntime?.executionRuntimeSource === "release default", "executor handoff runtime source should be release default");
  assert(handoff.targetSubagent?.modelHint === expectedExecutorRuntime, "executor handoff should derive model hint from release default");
  assert(handoff.targetSubagent?.effortHint === "medium", "executor handoff should derive effort hint from release default");
  assert(handoff.targetSubagent?.maxTurnsHint === receipt.executionMaxTurns, "executor handoff should carry dispatch-derived maxTurns when run id is supplied");
  assert(handoff.targetSubagent?.maxTurnsHintSource === "dispatch receipt", "executor handoff should prefer dispatch receipt maxTurns when run id is supplied");
  assert(handoff.dispatchContext?.runId === receipt.runId, "executor handoff should expose run dispatch context");
  assert(handoff.prompt?.includes("## Pre-flight Blocks"), "delivered executor handoff prompt should include pre-flight block behavior");
  assert(handoff.prompt?.includes("## Safe Continuation"), "delivered executor handoff prompt should include Safe Continuation report section");
  assert(handoff.prompt?.includes("return it explicitly"), "delivered executor handoff prompt should require known safe continuations");
  assert(handoff.prompt?.includes("Start the final response exactly with `# Executor Report`"), "delivered executor handoff prompt should front-load the report title");
  assert(
    handoff.managerInstructions?.some((line) => line.includes("plugin-provided nogra:executor role")),
    "executor handoff should instruct Manager to spawn the plugin-scoped role"
  );

  const largerBrief = {
    title: "Larger verified dispatch brief",
    intent: "Implement a larger verified change across coupled plugin runtime files.",
    contextHandoff: "Regression fixture for brief-derived dispatch sizing.",
    scope: {
      in: ["Update runtime dispatch, handoff metadata, skill docs and tests."],
      out: ["No marketplace publish or installed plugin cache edits."],
      files: [
        "manager/nogra-claude-plugin/scripts/nogra-local.mjs",
        "manager/nogra-claude-plugin/scripts/smoke-local-runtime.mjs",
        "manager/nogra-claude-plugin/skills/dispatch/SKILL.md",
        "manager/nogra-claude-plugin/skills/dispatch/references/dispatch-contract.md",
        "manager/nogra-claude-plugin/agents/executor.md",
        "manager/nogra-claude-plugin/contracts/schemas/run-v1.schema.json"
      ]
    },
    successCriteria: ["Dispatch sizing is carried to handoff.", "Smoke evidence proves the larger brief gets a larger turn budget."],
    stopCriteria: ["If dispatch sizing cannot be derived from the approved brief, stop."],
    evidenceRequired: "verified"
  };
  const largerSizingPreview = run(["brief-sizing-preview", "--root", temp], largerBrief);
  assert(largerSizingPreview.sizingPreview?.risk === "coupled_scope", "coupled preview should classify coupled scope risk");
  assert(largerSizingPreview.sizingPreview?.userSurface === "inform", "coupled preview should inform instead of asking");
  assert(largerSizingPreview.sizingPreview?.requiresPreApprovalDecision === false, "inform preview should not block approval");
  assert(largerSizingPreview.sizingPreview?.managerAction === "decide_split_record_and_inform_one_line", "inform preview should name Manager-owned split action");
  assert(Array.isArray(largerSizingPreview.sizingPreview?.escalateToUserIf), "preview should include user escalation criteria");
  assert(String(largerSizingPreview.sizingPreview?.splitShapeHint || "").includes("linked sequential"), "preview should include linked-vs-parallel guidance");
  const decomposedLargerSizingPreview = run(["brief-sizing-preview", "--root", temp], {
    ...largerBrief,
    operatorDecomposed: true
  });
  assert(decomposedLargerSizingPreview.sizingPreview?.userSurface === "silent", "operator-decomposed coupled preview should dedupe user-facing prompt");
  assert(decomposedLargerSizingPreview.sizingPreview?.requiresPreApprovalDecision === false, "operator-decomposed preview should not block approval");
  const largerSaved = run(["brief-save", "--root", temp, "--source", "smoke"], largerBrief);
  run(["brief-promote", "--root", temp, "--brief-id", largerSaved.briefId]);
  const largerReceipt = run(["dispatch", "--root", temp, "--brief-id", largerSaved.briefId]);
  assert(largerReceipt.executionMaxTurns > Number(executorFrontmatter.maxTurns), "larger verified dispatch should size above generic role frontmatter fallback");
  const largerHandoff = run(["handoff-contract", "--root", temp, "--kind", "executor", "--run-id", largerReceipt.runId]);
  assert(largerHandoff.targetSubagent?.maxTurnsHint === largerReceipt.executionMaxTurns, "larger executor handoff should carry the larger dispatch-derived maxTurns");

  const nearDefaultBrief = {
    title: "Near ceiling sizing preview",
    intent: "Create a medium app surface across a few files.",
    contextHandoff: "Regression fixture for near-ceiling preview without coupled scope.",
    scope: {
      in: [
        "Create the main view.",
        "Create local filter controls.",
        "Create a compact data module.",
        "Connect the view to the controls.",
        "Add basic empty-state behavior.",
        "Keep the result self-contained."
      ],
      out: ["No publish step."],
      files: [
        "app/page.tsx",
        "app/filter.tsx",
        "app/data.ts"
      ]
    },
    successCriteria: [
      "Main view renders.",
      "Filter controls render.",
      "Data module is used.",
      "Empty state renders.",
      "Files stay self-contained."
    ],
    stopCriteria: [
      "Stop if the file list changes.",
      "Stop if external services are needed.",
      "Stop if the app surface expands.",
      "Stop if tests cannot run.",
      "Stop if acceptance is unclear."
    ],
    evidenceRequired: "verified",
    executionShape: {
      phases: ["build", "review", "finish"],
      toolNeeds: ["filesystem", "shell"]
    }
  };
  const nearDefaultSizingPreview = run(["brief-sizing-preview", "--root", temp], nearDefaultBrief);
  assert(nearDefaultSizingPreview.sizingPreview?.risk === "near_default_ceiling", "near-default preview should classify near-ceiling risk");
  assert(nearDefaultSizingPreview.sizingPreview?.userSurface === "silent", "near-default preview should stay silent");
  assert(nearDefaultSizingPreview.sizingPreview?.requiresPreApprovalDecision === false, "near-default preview should not block approval");
  assert(nearDefaultSizingPreview.sizingPreview?.managerAction === "decide_and_continue_silently", "near-default preview should remain Manager-owned");

  const oversizedBrief = {
    title: "Oversized dispatch brief",
    intent: "Implement a verified workflow and schema change across many coupled files.",
    contextHandoff: "Regression fixture for executor turn ceiling behavior.",
    scope: {
      in: [
        "Update runtime dispatch sizing.",
        "Update workflow docs.",
        "Update schema-facing records.",
        "Update hook behavior.",
        "Update test coverage.",
        "Verify all evidence."
      ],
      out: ["No publish step."],
      files: [
        "manager/nogra-claude-plugin/scripts/nogra-local.mjs",
        "manager/nogra-claude-plugin/scripts/smoke-local-runtime.mjs",
        "manager/nogra-claude-plugin/skills/dispatch/SKILL.md",
        "manager/nogra-claude-plugin/skills/help/references/usage.md",
        "manager/nogra-claude-plugin/contracts/schemas/run-v1.schema.json",
        "manager/nogra-claude-plugin/hooks/session-start.mjs",
        "manager/nogra-claude-plugin/hooks/pre-tool-use.mjs",
        "manager/nogra-claude-plugin/agents/executor.md",
        "manager/nogra-claude-plugin/agents/verifier.md",
        "active/example/app/schema.prisma",
        "active/example/app/src/workflow.ts",
        "active/example/app/src/payment.ts"
      ]
    },
    successCriteria: [
      "Dispatch sizing records a ceiling.",
      "Handoff carries dispatch sizing.",
      "Runtime docs match behavior.",
      "Smoke test covers custom config.",
      "Verification evidence exists."
    ],
    stopCriteria: [
      "Stop if schema behavior is unclear.",
      "Stop if workflow ownership is unclear.",
      "Stop if hook scope is unclear.",
      "Stop if tests cannot run.",
      "Stop if dispatch sizing is unavailable."
    ],
    evidenceRequired: "verified",
    executionShape: {
      phases: ["runtime", "docs", "tests", "verification", "handoff"],
      toolNeeds: ["filesystem", "shell", "schema", "workflow"]
    }
  };
  const oversizedSizingPreview = run(["brief-sizing-preview", "--root", temp], oversizedBrief);
  assert(oversizedSizingPreview.sizingPreview?.risk === "ceiling_clamped", "oversized preview should classify ceiling clamp risk");
  assert(oversizedSizingPreview.sizingPreview?.userSurface === "ask", "clamped preview should ask before approval");
  assert(oversizedSizingPreview.sizingPreview?.requiresPreApprovalDecision === true, "clamped preview should block approval");
  assert(oversizedSizingPreview.sizingPreview?.managerAction === "decide_split_then_confirm_with_user_before_approval", "clamped preview should name confirm-before-approval action");
  const decomposedOversizedSizingPreview = run(["brief-sizing-preview", "--root", temp], {
    ...oversizedBrief,
    operatorDecomposed: true
  });
  assert(decomposedOversizedSizingPreview.sizingPreview?.userSurface === "ask", "operator-decomposed clamped preview should still ask");
  const oversizedSaved = run(["brief-save", "--root", temp, "--source", "smoke"], oversizedBrief);
  run(["brief-promote", "--root", temp, "--brief-id", oversizedSaved.briefId]);
  const oversizedDefaultReceipt = run(["dispatch", "--root", temp, "--brief-id", oversizedSaved.briefId]);
  assert(oversizedDefaultReceipt.executionMaxTurns === 96, "oversized default dispatch should clamp at the default executor ceiling");
  assert(oversizedDefaultReceipt.executionSizing?.factors?.clamped === true, "oversized default dispatch should record clamping");
  assert(oversizedDefaultReceipt.executionSizing?.requiresManagerDecision === true, "clamped dispatch should require Manager decision before spawn");
  assert(oversizedDefaultReceipt.executionSizing?.managerAction === "split_or_confirm_single_run", "clamped dispatch should name the Manager action");
  assert(String(oversizedDefaultReceipt.executionSizing?.summary || "").includes("clamped from"), "clamped dispatch should include an observable summary");
  assert(oversizedDefaultReceipt.nextOwner === "Manager", "clamped dispatch should route nextOwner back to Manager");
  assert(oversizedDefaultReceipt.executionCrossing?.sizingDecisionRequired === true, "clamped execution crossing should require sizing decision");
  assert(String(oversizedDefaultReceipt.executionCrossing?.nextStep || "").includes("Review dispatch sizing"), "clamped execution crossing should not instruct blind spawn");
  const oversizedHandoff = run(["handoff-contract", "--root", temp, "--kind", "executor", "--run-id", oversizedDefaultReceipt.runId]);
  assert(oversizedHandoff.dispatchContext?.requiresManagerDecision === true, "handoff should carry clamped sizing decision requirement");
  assert(String(oversizedHandoff.dispatchContext?.maxTurnsSummary || "").includes("clamped from"), "handoff should carry clamped sizing summary");
  assert(
    oversizedHandoff.managerInstructions?.some((line) => line.includes("requiresManagerDecision")),
    "handoff should instruct Manager not to spawn blindly when sizing requires a decision"
  );

  const verifierHandoff = run(["handoff-contract", "--root", temp, "--kind", "verifier"]);
  assert(verifierHandoff.status === "ready", "verifier handoff should be ready");
  assert(verifierHandoff.hostedMcpUsed === false, "verifier handoff should remain local");
  assert(verifierHandoff.targetSubagent?.scopedRole === "nogra:verifier", "verifier handoff should target scoped nogra:verifier role");
  assert(verifierHandoff.roleRuntime?.executionRole === "nogra:verifier", "verifier handoff should expose role/runtime pair");
  assert(verifierHandoff.roleRuntime?.executionRuntime === expectedVerifierRuntime, "verifier handoff runtime should come from release default");
  assert(verifierHandoff.roleRuntime?.executionRuntimeSource === "release default", "verifier handoff runtime source should be release default");
  assert(verifierHandoff.targetSubagent?.modelHint === expectedVerifierRuntime, "verifier handoff should derive model hint from release default");
  assert(verifierHandoff.targetSubagent?.effortHint === "medium", "verifier handoff should derive effort hint from release default");
  assert(verifierHandoff.targetSubagent?.maxTurnsHint === Number(verifierFrontmatter.maxTurns), "verifier handoff should derive maxTurns hint from role frontmatter");

  const legacyWorkspace = path.join(temp, "legacy-workspace");
  fs.mkdirSync(path.join(legacyWorkspace, ".nogra", "state"), { recursive: true });
  writeJson(path.join(legacyWorkspace, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    releaseVersion: "v1.0.0",
    workspaceName: "Legacy Workspace",
    workspaceId: "legacy-workspace",
    connectionMode: "local",
    paths: {
      currentCheckpoint: ".nogra/state/SESSION-CHECKPOINT.md"
    }
  });
  fs.writeFileSync(path.join(legacyWorkspace, ".nogra", "state", "SESSION-CHECKPOINT.md"), [
    "# Session Checkpoint",
    "",
    "Workspace: Legacy Workspace",
    "Created: 2026-05-29",
    "Updated: 2026-05-29",
    "",
    "## Current State",
    "",
    "Legacy local workspace."
  ].join("\n"), "utf8");
  const legacyBefore = run(["status", "--root", legacyWorkspace]);
  assert(legacyBefore.routingPolicy?.configured === false, "legacy status should resolve missing routingPolicy from defaults");
  assert(legacyBefore.routingPolicy?.source === "release default", "legacy routingPolicy source should be release default");
  assert(legacyBefore.runtimePolicy?.configured === false, "legacy status should resolve missing runtimePolicy from defaults");
  assert(legacyBefore.runtimePolicy?.profile === "default", "legacy runtimePolicy should resolve default profile");
  assert(legacyBefore.continuity?.status === "migration-needed", "legacy status should flag missing 0.5.8 continuity layout");
  const legacyMigration = run(["init", "--root", legacyWorkspace, "--apply"]);
  assert(legacyMigration.status === "ok", "legacy init migration should apply cleanly");
  const legacyConfigAfter = JSON.parse(fs.readFileSync(path.join(legacyWorkspace, ".nogra", "config.json"), "utf8"));
  assert(legacyConfigAfter.workspaceId === "legacy-workspace", "legacy migration should preserve workspaceId");
  assert(legacyConfigAfter.routingPolicy?.defaultLanguage === "en", "legacy migration should merge routingPolicy defaults");
  assert(legacyConfigAfter.runtimePolicy?.profile === "default", "legacy migration should merge runtimePolicy defaults");
  const legacyCheckpointAfter = fs.readFileSync(path.join(legacyWorkspace, ".nogra", "state", "SESSION-CHECKPOINT.md"), "utf8");
  assert(/^SourceWatermark: 0$/m.test(legacyCheckpointAfter), "legacy migration should add checkpoint SourceWatermark");
  assert(fs.existsSync(path.join(legacyWorkspace, ".nogra", "ledger", ".gitkeep")), "legacy migration should create ledger lane");
  const legacyAfter = run(["status", "--root", legacyWorkspace]);
  assert(legacyAfter.continuity?.status === "ready", "legacy status should report ready after migration");

  const ledgerSmokeWorkspace = path.join(temp, "ledger-smoke-workspace");
  run(["init", "--root", ledgerSmokeWorkspace, "--apply"]);
  captureSessionAnchor(ledgerSmokeWorkspace, {
    session_id: "session-ledger-smoke-001",
    transcript_path: "/tmp/transcript-ledger-smoke-001.jsonl",
    cwd: ledgerSmokeWorkspace
  }, "PreToolUse");
  const ledgerSmoke = run(["ledger-smoke", "--root", ledgerSmokeWorkspace, "--label", "smoke diagnostic"]);
  assert(ledgerSmoke.status === "ok", "ledger-smoke should return ok");
  assert(ledgerSmoke.event?.type === "diagnostic_ledger_smoke", "ledger-smoke should write diagnostic event type");
  assert(ledgerSmoke.ledgerWatermark === 1, "ledger-smoke should append watermark 1 in a fresh workspace");
  assert(ledgerSmoke.sessionId === "session-ledger-smoke-001", "ledger-smoke should stamp sessionId from anchor");
  assert(ledgerSmoke.transcriptId === "transcript-ledger-smoke-001", "ledger-smoke should stamp transcriptId from anchor");
  assert(!fs.existsSync(path.join(ledgerSmokeWorkspace, ".nogra", "briefs", "drafts")), "ledger-smoke should not create brief drafts");
  const ledgerSmokeStatus = run(["status", "--root", ledgerSmokeWorkspace]);
  assert(ledgerSmokeStatus.ledger?.checkpointStatus === "stale", "ledger-smoke should make checkpoint stale when source watermark is behind");

  const legacyBalancedConfig = JSON.parse(fs.readFileSync(path.join(temp, ".nogra", "config.json"), "utf8"));
  legacyBalancedConfig.defaultTargetModel = "anthropic:sonnet";
  legacyBalancedConfig.runtimePolicy = {
    profile: "balanced",
    roles: {
      manager: { model: "inherit", effort: "auto", context: "session", enforcement: "advisory-main-session" },
      agent: { model: "sonnet", effort: "high", context: "default", maxTurns: null },
      verifier: { model: "sonnet", effort: "medium", context: "default", maxTurns: null }
    },
    budget: { mode: "balanced" }
  };
  writeJson(path.join(temp, ".nogra", "config.json"), legacyBalancedConfig);
  const legacyStatus = run(["status", "--root", temp]);
  assert(legacyStatus.runtimePolicy?.profile === "default", "stock legacy balanced runtimePolicy should normalize to default");

  const customConfig = JSON.parse(fs.readFileSync(path.join(temp, ".nogra", "config.json"), "utf8"));
  customConfig.runtimePolicy = {
    ...customConfig.runtimePolicy,
    profile: "custom",
    roles: {
      executor: { model: "opus", effort: "high", context: "default", maxTurns: 40 },
      verifier: { model: "sonnet", effort: "low", context: "tight", maxTurns: 25 }
    },
    budget: { mode: "custom" }
  };
  writeJson(path.join(temp, ".nogra", "config.json"), customConfig);
  const customStatus = run(["status", "--root", temp]);
  assert(customStatus.runtimePolicy?.profile === "custom", "status should expose runtimePolicy profile custom");
  const customReceipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  assert(customReceipt.targetModel === "opus", "custom dispatch should prefer roles.executor.model over brief default targetModel");
  assert(customReceipt.executionEffort === "high", "custom dispatch should carry roles.executor.effort");
  assert(customReceipt.executionRuntimePolicyProfile === "custom", "custom dispatch should carry custom profile");
  assert(customReceipt.executionRuntimeSource === "runtimePolicy.roles.executor", "custom dispatch should record executor runtime source");
  const customVerifierReceipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId, "--target", "verifier"]);
  assert(customVerifierReceipt.targetModel === "sonnet", "custom verifier dispatch should prefer roles.verifier.model");
  assert(customVerifierReceipt.executionRole === "nogra:verifier", "custom verifier dispatch should expose verifier executionRole");
  assert(customVerifierReceipt.executionEffort === "low", "custom verifier dispatch should carry roles.verifier.effort");
  assert(customVerifierReceipt.executionContext === "tight", "custom verifier dispatch should carry roles.verifier.context");
  assert(customVerifierReceipt.executionRuntimeSource === "runtimePolicy.roles.verifier", "custom verifier dispatch should record verifier runtime source");
  assert(customVerifierReceipt.executionCrossing?.effort === "low", "custom verifier execution crossing should carry roles.verifier.effort");
  assert(customVerifierReceipt.executionCrossing?.context === "tight", "custom verifier execution crossing should carry roles.verifier.context");
  const customLargerReceipt = run(["dispatch", "--root", temp, "--brief-id", largerSaved.briefId]);
  assert(customLargerReceipt.executionMaxTurns === largerReceipt.executionMaxTurns, "custom executor maxTurns below brief-derived sizing should not clamp down");
  assert(customLargerReceipt.executionSizing?.factors?.configuredCeiling === 40, "custom lower maxTurns should be recorded as configured ceiling");
  assert(customLargerReceipt.executionSizing?.factors?.cap === 96, "custom lower maxTurns should not reduce the default ceiling");
  const customHandoff = run(["handoff-contract", "--root", temp, "--kind", "executor"]);
  assert(customHandoff.targetSubagent?.modelHint === "opus", "custom handoff should expose configured executor model hint");
  assert(customHandoff.targetSubagent?.effortHint === "high", "custom handoff should expose configured executor effort hint");

  customConfig.runtimePolicy.roles.executor.maxTurns = 128;
  writeJson(path.join(temp, ".nogra", "config.json"), customConfig);
  const customRaisedReceipt = run(["dispatch", "--root", temp, "--brief-id", oversizedSaved.briefId]);
  assert(customRaisedReceipt.executionMaxTurns === 128, "custom executor maxTurns above default should raise the dispatch ceiling");
  assert(customRaisedReceipt.executionSizing?.factors?.cap === 128, "custom raised maxTurns should become the recorded ceiling below the absolute cap");
  assert(customRaisedReceipt.executionSizing?.requiresManagerDecision === true, "custom raised but still clamped dispatch should still require Manager decision");
  assertRunFails(["dispatch", "--root", temp, "--brief-id", saved.briefId, "--max-turns", "5000"], "dispatch override above safety ceiling should fail");

  const verified = run(
    ["verify", "--root", temp, "--run-id", receipt.runId],
    {
      status: "ok",
      summary: "Local smoke evidence recorded.",
      acceptance: [
        {
          criterion: "Brief draft is written locally.",
          status: "met",
          evidence: "Draft and promoted files exist."
        }
      ]
    }
  );
  assert(verified.status === "ok", "verify support should record ok status");
  assert(verified.hostedMcpUsed === false, "verify support should remain local");
  assert(verified.verdict === "ship", "verify support should preserve fine-grained ship verdict");
  assert(verified.validation?.verdict === "ship", "validation should record ship verdict");
  assert(verified.validation?.ledgerWatermark > receipt.ledgerWatermark, "verify should append a newer ledger watermark");
  assert(verified.run?.executionLabel === `Executor · ${expectedExecutorRuntimeDisplay} · Ok`, "verify support should update role/runtime/status label");
  assert(fs.existsSync(path.join(temp, ".nogra", "transport", "artifacts", receipt.runId, "validation.json")), "verify should write validation artifact");
  const staleStatus = run(["status", "--root", temp]);
  assert(staleStatus.ledger?.watermark > staleStatus.ledger?.checkpointSourceWatermark, "status should detect ledger ahead of checkpoint");
  assert(staleStatus.ledger?.checkpointStatus === "stale", "status should report stale checkpoint when ledger is ahead");

  const reasonlessReceipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  const reasonlessVerification = run(
    ["verify", "--root", temp, "--run-id", reasonlessReceipt.runId],
    {
      verification: "unverified",
      summary: "Unable to verify from the available evidence."
    }
  );
  assert(reasonlessVerification.status === "blocked", "reasonless non-ship verify should return blocked support status");
  assert(reasonlessVerification.verdict === "unverified", "reasonless non-ship verify should preserve unverified verdict");
  assert(reasonlessVerification.validation === null, "reasonless non-ship verify should not write validation payload");
  assert(String(reasonlessVerification.error || "").includes("reason"), "reasonless non-ship verify should name missing reason");
  assert(
    !fs.existsSync(path.join(temp, ".nogra", "transport", "artifacts", reasonlessReceipt.runId, "validation.json")),
    "reasonless non-ship verify should not write validation artifact"
  );

  const reasonedReceipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  const reasonedVerification = run(
    ["verify", "--root", temp, "--run-id", reasonedReceipt.runId],
    {
      verification: "unverified",
      summary: "Unable to verify from the available evidence.",
      reason: "The requested command evidence is missing; run the requested check and provide its output to move this to ship."
    }
  );
  assert(reasonedVerification.status === "blocked", "reasoned unverified verify should keep coarse blocked status");
  assert(reasonedVerification.verdict === "unverified", "reasoned unverified verify should preserve unverified verdict");
  assert(reasonedVerification.validation?.verdict === "unverified", "validation should record unverified verdict");
  assert(reasonedVerification.validation?.reason.includes("requested command evidence"), "validation should record non-ship reason");
  assert(
    fs.existsSync(path.join(temp, ".nogra", "transport", "artifacts", reasonedReceipt.runId, "validation.json")),
    "reasoned non-ship verify should write validation artifact"
  );

  const inferredReceipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  const inferredVerified = run(
    ["verify", "--root", temp, "--run-id", inferredReceipt.runId],
    {
      summary: "Local smoke evidence inferred from acceptance rows.",
      acceptance: [
        {
          criterion: "Brief draft is written locally.",
          status: "met",
          evidence: "Draft and promoted files exist."
        }
      ]
    }
  );
  assert(inferredVerified.status === "ok", "verify support should infer ok when all acceptance rows are met");
  assert(inferredVerified.verdict === "ship", "verify support should infer ship verdict when all acceptance rows are met");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tempWorkspace: temp,
        checks: [
          "manager workspace normalizes to local",
          "fresh init creates local workspace",
          "legacy mode aliases normalize to local",
          "fresh init writes releaseVersion without legacy root version fields",
          "fresh init writes runtimePolicy default without concrete role choices",
          "fresh init is English-first with empty routing phrase arrays",
          "fresh init and status expose ledger/checkpoint freshness",
          "hooks prefer workspace root .nogra over nested cwd .nogra",
          "legacy workspaces resolve defaults and migrate continuity layout",
          "diagnostic ledger-smoke writes a ledger event without brief artifacts",
          "create-project initializes project-local state from a workspace hub",
          "plugin diagnostics warn but do not block on multi-install or version drift",
          "brief validate/save/promote local",
          "dispatch receipt local with default/custom runtime policy mapping",
          "ledger events and finalize-run carry monotonic watermarks and session anchors",
          "dispatch and handoff expose explicit role/runtime/effort facts",
          "nested cwd resolves to nearest Nogra root with no-.nogra fallback",
          "nested setup targets requested root instead of parent Nogra root",
          "stock legacy balanced runtimePolicy normalizes to default",
          "verify support local",
          "verify support requires reason for non-ship verdicts",
          "hostedMcpUsed false across runtime path"
        ]
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(`smoke-local-runtime: ${error.message}`);
  process.exitCode = 1;
}
