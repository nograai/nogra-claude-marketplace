#!/usr/bin/env node
// Exercise actual hook processes with isolated operator data and no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-context-"));
const root = path.join(temp, "workspace");
const memory = path.join(temp, "memory");
const profile = "Fixture operator: Danish conversation, concrete evidence, private work stays private.";
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

try {
  fs.mkdirSync(memory, { recursive: true });
  writeJson(path.join(root, ".nogra/config.json"), {
    schema: "nogra.workspace.config.v1", workspaceId: "context-fixture", sync: { enabled: false }
  });
  fs.writeFileSync(path.join(memory, "USER.md"), profile);
  fs.writeFileSync(path.join(memory, "MEMORY.md"), "- [Operator](USER.md)\n");
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(memory, `reference-${i}.md`), "Detailed topic.\n".repeat(200));
  const probe = path.join(temp, "probe.cjs");
  fs.writeFileSync(probe, `
    const fs = require("node:fs");
    const path = require("node:path");
    const { syncBuiltinESMExports } = require("node:module");
    const reads = [];
    const original = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (typeof file === "string" && path.dirname(file) === process.env.NOGRA_TEST_MEMORY_DIR) reads.push(path.basename(file));
      return original.call(this, file, ...args);
    };
    syncBuiltinESMExports();
    global.fetch = async () => { throw new Error("network is forbidden in this fixture"); };
    process.on("exit", () => process.stderr.write(JSON.stringify(reads)));
  `);
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: path.join(temp, "config"), CLAUDE_PROJECT_DIR: root,
    CLAUDE_PROJECT_ROOT: root, NOGRA_NATIVE_MEMORY_DIR: memory,
    NOGRA_TEST_MEMORY_DIR: fs.realpathSync(memory), NOGRA_SYNC_TOKEN: "", CLAUDE_CODE_DISABLE_AUTO_MEMORY: ""
  };
  function invoke(hook, extraEnv = {}, selectedPlugin = plugin) {
    const result = spawnSync(process.execPath, ["--require", probe, path.join(selectedPlugin, "hooks", hook)], {
      cwd: root, env: { ...env, ...extraEnv },
      input: JSON.stringify({ cwd: root, source: hook === "post-compact.mjs" ? "compact" : "startup", session_id: "context-fixture" }),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    return { context: JSON.parse(result.stdout).hookSpecificOutput.additionalContext, reads: JSON.parse(result.stderr) };
  }

  const startup = invoke("sync-pull.mjs");
  check(startup.context.includes(profile), "startup pins the local operator profile");
  check(!startup.context.includes("<nogra-memory>"), "large topic files do not trigger a loaded-index warning");
  check(startup.reads.filter((name) => name.startsWith("reference-")).length === 0, "startup does not read topic bodies just to measure the index");
  check(startup.reads.filter((name) => name === "USER.md").length === 1, `startup reads the profile once when sync is disabled: ${JSON.stringify(startup.reads)}`);

  const compact = invoke("post-compact.mjs");
  check(compact.context.includes(profile), "compaction repins the local profile");
  check(compact.context.includes("NOGRA_COMPACT_POINTER"), "compaction keeps its existing state pointer");
  check(compact.context.includes('authority="advisory_projection_only"'), "repinned memory remains advisory");
  check(compact.reads.length === 1 && compact.reads[0] === "USER.md", "compaction reads only the profile, without a memory scan");
  const disabled = invoke("post-compact.mjs", { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  check(!disabled.context.includes(profile) && disabled.reads.length === 0, "disabled native memory stays disabled after compaction");

  // Fault injection is restricted to a disposable copy of the dependency.
  const brokenPlugin = path.join(temp, "broken-plugin");
  fs.cpSync(plugin, brokenPlugin, { recursive: true });
  fs.writeFileSync(path.join(brokenPlugin, "runtime/local/sync-client.mjs"),
    'export function syncNudge() { return ""; }\nexport async function syncPull() { throw new Error("unexpected adapter failure"); }\n');
  const failure = invoke("sync-pull.mjs", {}, brokenPlugin);
  check(failure.context.includes(profile), "unexpected sync adapter failure cannot suppress the local profile");
  check(failure.context.includes("local memory"), "sync fallback is visible without exposing raw error content");
  check(!failure.context.includes("unexpected adapter failure"), "raw adapter errors are not inserted into profile context");

  fs.writeFileSync(path.join(memory, "MEMORY.md"), "i".repeat(25_001));
  const overflow = invoke("memory-load.mjs");
  check(overflow.context.includes("25001 bytes") && overflow.context.includes("25000 bytes"), "memory load uses the shared 25,000-byte boundary");
  fs.writeFileSync(path.join(memory, "MEMORY.md"), "i".repeat(25_000));
  check(!invoke("memory-load.mjs").context.includes("<nogra-memory>"), "exactly 25,000 bytes stays within the hard window");
  fs.writeFileSync(path.join(memory, "MEMORY.md"), "å".repeat(12_501));
  check(invoke("memory-load.mjs").context.includes("25002 bytes"), "the byte window counts UTF-8 bytes, not characters");

  console.log(`context-continuity smoke passed: ${checks} checks`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
