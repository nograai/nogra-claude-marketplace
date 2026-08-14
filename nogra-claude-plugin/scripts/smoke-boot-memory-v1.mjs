#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBootContext } from "../runtime/local/boot-context.mjs";
import { resolveNativeMemory } from "../runtime/local/native-memory.mjs";
import { memoryContext } from "../hooks/memory-load.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bootHook = path.join(pluginRoot, "hooks", "boot-order.mjs");
const orderedMemoryHook = path.join(pluginRoot, "hooks", "sync-pull.mjs");
let checks = 0;

function ok(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function workspace(root, id, bootPolicy = {}) {
  writeJson(path.join(root, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceName: id,
    workspaceId: id,
    paths: {
      stateRoot: ".nogra/state",
      currentCheckpoint: ".nogra/state/SESSION-CHECKPOINT.md",
      workspaceIndex: ".nogra/index/workspaces.jsonl"
    },
    bootPolicy
  });
}

function hookContext(script, root, input, env = {}) {
  const output = execFileSync(process.execPath, [script], {
    cwd: pluginRoot,
    env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  return JSON.parse(output).hookSpecificOutput.additionalContext;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-boot-memory-v1-"));
try {
  const freshRoot = path.join(temp, "fresh");
  fs.mkdirSync(freshRoot, { recursive: true });
  const fresh = resolveBootContext({ cwd: freshRoot, sessionSource: "startup", index: path.join(temp, "missing-index") });
  ok(fresh.schema === "nogra.boot.context.v2" && fresh.state === "fresh", "missing Nogra state is fresh");
  ok(fresh.autoLoaded === false && fresh.authorization === "none", "fresh boot is read-only and non-authorizing");

  const projectRoot = path.join(temp, "project");
  workspace(projectRoot, "project-one");
  let boot = resolveBootContext({ cwd: projectRoot, sessionSource: "startup" });
  ok(boot.state === "focused" && boot.checkpointAvailable === false, "runtime root explicitly focuses a new workspace");

  fs.mkdirSync(path.join(projectRoot, ".nogra", "state"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".nogra", "state", "SESSION-CHECKPOINT.md"), "SECRET CHECKPOINT CONTENT\n");
  boot = resolveBootContext({ cwd: projectRoot, sessionSource: "startup" });
  ok(boot.state === "focused" && boot.checkpointAvailable === true, "checkpoint presence remains focused on startup");
  ok(boot.checkpointLoaded === false && !boot.message.includes("SECRET CHECKPOINT CONTENT"), "boot detects checkpoint existence without loading content");
  ok(resolveBootContext({ cwd: projectRoot, sessionSource: "resume" }).state === "resumed", "only native resume produces resumed");
  ok(resolveBootContext({ cwd: projectRoot, sessionSource: "compact" }).state === "recovering", "compact produces recovering");
  ok(resolveBootContext({ cwd: projectRoot, sessionSource: "clear" }).state === "focused", "clear is not resume");

  const startupHook = hookContext(bootHook, projectRoot, { source: "startup", cwd: projectRoot });
  ok(startupHook.includes("state=focused") && !startupHook.includes("RESUMING work"), "boot hook never infers resume from checkpoint");
  const resumeHook = hookContext(bootHook, projectRoot, { source: "resume", cwd: projectRoot });
  ok(resumeHook.includes("state=resumed") && resumeHook.includes("explicit native resume"), "boot hook names explicit native resume");
  ok(resumeHook.includes("authorization=none") && resumeHook.includes("not Nogra GO"), "resume hook cannot authorize work");

  const hubRoot = path.join(temp, "hub");
  workspace(hubRoot, "hub", { mode: "workspace-hub", workspaceHub: { enabled: true } });
  const childRoot = path.join(hubRoot, "projects", "child");
  workspace(childRoot, "child");
  fs.mkdirSync(path.join(hubRoot, ".nogra", "index"), { recursive: true });
  fs.writeFileSync(
    path.join(hubRoot, ".nogra", "index", "workspaces.jsonl"),
    `${JSON.stringify({ workspaceId: "child", workspaceName: "Child", path: childRoot, lastCheckpointSummary: "pointer only" })}\n`
  );
  const hub = resolveBootContext({ cwd: hubRoot, sessionSource: "startup" });
  ok(hub.state === "detected" && hub.status === "hub", "hub detects candidates without focusing a child");
  ok(hub.candidates.length === 1 && hub.checkpointLoaded === false, "hub emits bounded index candidates only");

  const home = path.join(temp, "home");
  const configRoot = path.join(home, ".claude");
  const customMemory = path.join(home, "custom-memory");
  fs.mkdirSync(customMemory, { recursive: true });
  fs.writeFileSync(path.join(customMemory, "USER.md"), "Custom native profile.");
  writeJson(path.join(configRoot, "settings.json"), { autoMemoryDirectory: customMemory });
  const baseOptions = {
    projectDir: projectRoot,
    home,
    configRoot,
    env: { HOME: home }
  };
  let memory = resolveNativeMemory(baseOptions);
  ok(memory.status === "resolved" && memory.source === "user-settings", "user autoMemoryDirectory is honored");
  ok(memory.resolvedDirectory === fs.realpathSync.native(customMemory), "custom native memory destination is exact");
  ok(memoryContext({ cwd: projectRoot }, { HOME: home, CLAUDE_PROJECT_DIR: projectRoot }).includes("Custom native profile."), "USER pin reads the shared resolved identity");

  const localMemory = path.join(home, "local-memory");
  fs.mkdirSync(path.join(projectRoot, ".claude"), { recursive: true });
  writeJson(path.join(projectRoot, ".claude", "settings.local.json"), { autoMemoryDirectory: localMemory });
  memory = resolveNativeMemory(baseOptions);
  ok(memory.source === "local-settings" && memory.directory === localMemory, "local settings override user settings");

  const runtimeMemory = path.join(home, "runtime-memory");
  memory = resolveNativeMemory({
    ...baseOptions,
    env: { HOME: home, NOGRA_NATIVE_MEMORY_DIR: runtimeMemory }
  });
  ok(memory.source === "runtime-override" && memory.directory === runtimeMemory, "runtime bridge overrides observable non-managed settings");

  fs.rmSync(path.join(projectRoot, ".claude", "settings.local.json"));
  fs.rmSync(path.join(configRoot, "settings.json"));
  const transcript = path.join(configRoot, "projects", "-runtime-project", "session.jsonl");
  memory = resolveNativeMemory({ ...baseOptions, transcriptPath: transcript });
  ok(memory.source === "transcript-project" && memory.confidence === "exact", "hook transcript provides exact default project identity");
  ok(memory.directory === path.join(path.dirname(transcript), "memory"), "transcript identity resolves its sibling memory directory");

  memory = resolveNativeMemory({
    ...baseOptions,
    env: { HOME: home, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }
  });
  ok(memory.status === "disabled" && memory.autoMemoryEnabled === false, "disabled Auto Memory stays disabled");

  writeJson(path.join(configRoot, "settings.json"), { autoMemoryDirectory: "relative/not-allowed" });
  memory = resolveNativeMemory(baseOptions);
  ok(memory.status === "unresolved" && memory.source === "invalid-settings", "relative configured memory fails closed");

  fs.rmSync(path.join(configRoot, "settings.json"));
  const defaultMemory = resolveNativeMemory({ ...baseOptions, identityRoot: projectRoot });
  fs.mkdirSync(path.dirname(defaultMemory.directory), { recursive: true });
  const escaped = path.join(temp, "escaped-memory");
  fs.mkdirSync(escaped, { recursive: true });
  fs.symlinkSync(escaped, defaultMemory.directory, "dir");
  memory = resolveNativeMemory({ ...baseOptions, identityRoot: projectRoot });
  ok(memory.status === "unresolved" && memory.source === "unsafe-symlink", "default memory symlink escape fails closed");

  fs.rmSync(defaultMemory.directory);
  writeJson(path.join(configRoot, "settings.json"), { autoMemoryDirectory: customMemory });
  const ordered = hookContext(
    orderedMemoryHook,
    projectRoot,
    { source: "startup", cwd: projectRoot, transcript_path: transcript },
    { HOME: home, CLAUDE_CONFIG_DIR: configRoot, NOGRA_SYNC_TOKEN: "" }
  );
  ok(ordered.includes("Custom native profile."), "ordered SessionStart adapter renders memory after the sync leg");

  console.log(`boot-memory-v1 smoke passed: ${checks} checks`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
