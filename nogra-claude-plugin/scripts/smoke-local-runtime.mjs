#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
  const expectedExecutorRuntime = "anthropic:sonnet";
  const expectedExecutorRuntimeDisplay = displayRuntime(expectedExecutorRuntime);
  const expectedVerifierRuntime = "sonnet";
  assert(!executorFrontmatter.model, "executor role frontmatter should not hardcode model");
  assert(!executorFrontmatter.effort, "executor role frontmatter should not hardcode effort");
  assert(!verifierFrontmatter.model, "verifier role frontmatter should not hardcode model");
  assert(!verifierFrontmatter.effort, "verifier role frontmatter should not hardcode effort");

  const managerStatus = run(["status", "--root", managerRoot]);
  assert(managerStatus.workspace.mode === "local", "manager workspace should normalize to local");
  assert(managerStatus.hostedMcpUsed === false, "status should remain local");

  const init = run(["init", "--apply", "--root", temp, "--workspace-name", "Local Smoke"]);
  assert(init.status === "ok", "fresh local init should be ok");
  assert(init.hostedMcpUsed === false, "init should remain local");
  assert(fs.existsSync(path.join(temp, ".nogra", "config.json")), "init should create .nogra/config.json");
  assert(fs.existsSync(path.join(temp, "CLAUDE.md")), "init should create root CLAUDE.md when missing");
  for (const legacyPath of [
    ".nogra/.gitignore",
    ".nogra/SESSION-CHECKPOINT.md",
    ".nogra/CURRENT-TASKS.md",
    ".nogra/DECISIONS.md",
    ".nogra/PROJECT-STRUCTURE.md",
    ".nogra/briefs/.gitkeep",
    ".nogra/events/.gitkeep",
    ".nogra/runs/.gitkeep",
    ".nogra/receipts/.gitkeep",
    ".nogra/transport/.gitkeep"
  ]) {
    assert(!fs.existsSync(path.join(temp, legacyPath)), `init should not create ${legacyPath}`);
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
  assert(status.hostedMcpUsed === false, "fresh status should remain local");
  assert(status.runtimePolicy?.profile === "default", "status should expose normalized runtimePolicy profile default");

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

  const saved = run(["brief-save", "--root", temp, "--source", "smoke"], brief);
  assert(saved.valid === true, "brief-save should write a valid draft");
  assert(fs.existsSync(path.join(temp, saved.path)), "brief-save should write draft JSON");
  assert(fs.existsSync(path.join(temp, saved.overviewPath)), "brief-save should write stable overview text");

  const promoted = run(["brief-promote", "--root", temp, "--brief-id", saved.briefId]);
  assert(promoted.status === "ready", "brief-promote should mark the brief ready");
  assert(fs.existsSync(path.join(temp, promoted.path)), "brief-promote should write promoted markdown");
  assert(fs.existsSync(path.join(temp, promoted.draft.overviewPath)), "brief-promote should refresh stable overview text");

  const receipt = run(["dispatch", "--root", temp, "--brief-id", saved.briefId]);
  assert(receipt.status === "ready", "dispatch should create a local receipt");
  assert(receipt.hostedMcpUsed === false, "dispatch should remain local");
  assert(receipt.target === "executor", "dispatch should default target to executor");
  const runFile = path.join(temp, ".nogra", "transport", "runs", `${receipt.runId}.json`);
  assert(fs.existsSync(runFile), "dispatch should write local transport run");
  const receiptRun = JSON.parse(fs.readFileSync(runFile, "utf8"));
  assert(receipt.executionRole === "nogra:executor", "dispatch receipt should expose executionRole");
  assert(receipt.executionRuntime === expectedExecutorRuntime, "dispatch receipt should expose executionRuntime beside role");
  assert(receipt.executionEffort === "medium", "dispatch receipt should expose default executor effort");
  assert(receipt.executionRuntimePolicyProfile === "default", "dispatch receipt should expose runtime policy profile");
  assert(receipt.executionLabel === `Executor · ${expectedExecutorRuntimeDisplay} · Queued`, "dispatch receipt should expose role/runtime/status label");
  assert(receipt.run?.executionRole === "nogra:executor", "run state should persist executionRole");
  assert(receiptRun.executionRuntime === expectedExecutorRuntime, "run state should persist executionRuntime");
  assert(receiptRun.executionEffort === "medium", "run state should persist executionEffort");
  assert(receiptRun.metadata?.executionRuntime === expectedExecutorRuntime, "run metadata should persist executionRuntime");
  assert(receiptRun.metadata?.executionEffort === "medium", "run metadata should persist executionEffort");
  assert(receipt.executionCrossing?.runtime === expectedExecutorRuntime, "execution crossing should expose runtime beside role");
  assert(receipt.executionCrossing?.effort === "medium", "execution crossing should expose effort beside runtime");

  const handoff = run(["handoff-contract", "--root", temp, "--kind", "executor"]);
  assert(handoff.status === "ready", "executor handoff should be ready");
  assert(handoff.hostedMcpUsed === false, "handoff should remain local");
  assert(handoff.targetSubagent?.scopedRole === "nogra:executor", "executor handoff should target scoped nogra:executor role");
  assert(handoff.roleRuntime?.executionRole === "nogra:executor", "executor handoff should expose role/runtime pair");
  assert(handoff.roleRuntime?.executionRuntime === expectedExecutorRuntime, "executor handoff runtime should come from release default");
  assert(handoff.roleRuntime?.executionRuntimeSource === "release default", "executor handoff runtime source should be release default");
  assert(handoff.targetSubagent?.modelHint === expectedExecutorRuntime, "executor handoff should derive model hint from release default");
  assert(handoff.targetSubagent?.effortHint === "medium", "executor handoff should derive effort hint from release default");
  assert(handoff.targetSubagent?.maxTurnsHint === Number(executorFrontmatter.maxTurns), "executor handoff should derive maxTurns hint from role frontmatter");
  assert(
    handoff.managerInstructions?.some((line) => line.includes("plugin-provided nogra:executor role")),
    "executor handoff should instruct Manager to spawn the plugin-scoped role"
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
      verifier: { model: "sonnet", effort: "medium", context: "default", maxTurns: 25 }
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
  const customHandoff = run(["handoff-contract", "--root", temp, "--kind", "executor"]);
  assert(customHandoff.targetSubagent?.modelHint === "opus", "custom handoff should expose configured executor model hint");
  assert(customHandoff.targetSubagent?.effortHint === "high", "custom handoff should expose configured executor effort hint");

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
  assert(verified.run?.executionLabel === `Executor · ${expectedExecutorRuntimeDisplay} · Ok`, "verify support should update role/runtime/status label");
  assert(fs.existsSync(path.join(temp, ".nogra", "transport", "artifacts", receipt.runId, "validation.json")), "verify should write validation artifact");

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
          "plugin diagnostics warn but do not block on multi-install or version drift",
          "brief validate/save/promote local",
          "dispatch receipt local with default/custom runtime policy mapping",
          "dispatch and handoff expose explicit role/runtime/effort facts",
          "stock legacy balanced runtimePolicy normalizes to default",
          "verify support local",
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
