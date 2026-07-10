#!/usr/bin/env node

// Evidence smoke for the shipped statusline's gate-mode + active-run/executor
// segments (product statusline visibility doctrine). Isolated fixtures for
// the run-segment cases; read-only, direct-invocation checks against the
// live workspace for the gate-segment case. Cleans up every fixture it
// creates and leaves the real .nogra tree untouched.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const statuslinePath = path.join(pluginRoot, "scripts", "statusline.mjs");

// Byte-stable pre-change baseline for an uninitialized directory, captured
// against this statusline before the gate-mode + active-run segments were
// added. Must stay identical after the change (fail-open, no .nogra found).
// Version is derived from plugin.json, not hardcoded — a version bump is the one
// field expected to vary; every other segment must still match byte-for-byte.
const pluginVersion = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
).version;
const EXPECTED_UNINIT_BASELINE =
  `Nogra:local ${pluginVersion} hook:none checkpoint:fresh continuity:migration-needed bridge:unknown dirty:unknown promo:unknown`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runStatusline(inputText, cwd) {
  return execFileSync(process.execPath, [statuslinePath], {
    cwd,
    input: inputText,
    encoding: "utf8"
  });
}

function assertNoNograAncestor(dir) {
  let current = path.resolve(dir);
  while (true) {
    assert(
      !fs.existsSync(path.join(current, ".nogra")),
      `fixture dir ${dir} must not have a .nogra ancestor at ${current} (test would be invalid)`
    );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function snapshotDir(dir) {
  const out = {};
  function walk(rel) {
    const full = path.join(dir, rel);
    let entries;
    try {
      entries = fs.readdirSync(full, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(relPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(full, entry.name));
        out[relPath] = `${stat.size}:${stat.mtimeMs}`;
      }
    }
  }
  walk("");
  return out;
}

function assertSameSnapshot(before, after, label) {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  assert(JSON.stringify(beforeKeys) === JSON.stringify(afterKeys), `${label}: file set under .nogra changed`);
  for (const key of beforeKeys) {
    assert(before[key] === after[key], `${label}: file changed under .nogra: ${key}`);
  }
}

function main() {
  const tempDirs = [];

  // (a) gate segment renders from a FIXTURE workspace's gate config — fully
  // self-contained, like case (b). No dependency on the surrounding repo's
  // live .nogra state, so the smoke passes identically in any fresh clone.
  const gateOnDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-statusline-smoke-gate-on-"));
  tempDirs.push(gateOnDir);
  assertNoNograAncestor(gateOnDir);
  writeJson(path.join(gateOnDir, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceId: "statusline-smoke-gate-on",
    gate: { mode: "advisory", autoApprove: true }
  });
  const gateOnBefore = snapshotDir(path.join(gateOnDir, ".nogra"));
  const workspaceOutput = runStatusline("{}", gateOnDir);
  const gateOnAfter = snapshotDir(path.join(gateOnDir, ".nogra"));
  assertSameSnapshot(gateOnBefore, gateOnAfter, "gate-segment invocation (auto ON fixture)");

  assert(
    workspaceOutput.includes("Nogra ⛩ auto ON"),
    `expected gate segment 'Nogra ⛩ auto ON' in fixture statusline, got: ${workspaceOutput.trim()}`
  );
  assert(workspaceOutput.trim().startsWith("Nogra:"), "workspace statusline should still start with the base Nogra segment");

  // (a2) and the auto-off variant renders the off label.
  const gateOffDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-statusline-smoke-gate-off-"));
  tempDirs.push(gateOffDir);
  assertNoNograAncestor(gateOffDir);
  writeJson(path.join(gateOffDir, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceId: "statusline-smoke-gate-off",
    gate: { mode: "advisory", autoApprove: false }
  });
  const gateOffOutput = runStatusline("{}", gateOffDir);
  assert(
    gateOffOutput.includes("Nogra ⛩ auto off"),
    `expected gate segment 'Nogra ⛩ auto off' in fixture statusline, got: ${gateOffOutput.trim()}`
  );

  // (c) uninitialized dir output is byte-identical to the pre-change baseline.
  const uninitDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-statusline-smoke-uninit-"));
  tempDirs.push(uninitDir);
  assertNoNograAncestor(uninitDir);
  const uninitOutput = runStatusline("{}", uninitDir).trim();
  assert(
    uninitOutput === EXPECTED_UNINIT_BASELINE,
    `uninitialized dir output should stay byte-identical to the pre-change baseline; got: ${uninitOutput}`
  );

  // (d) broken / empty stdin still prints a statusline (fail-open).
  const emptyStdinOutput = runStatusline("", repoRoot).trim();
  assert(emptyStdinOutput.length > 0 && emptyStdinOutput.startsWith("Nogra:"), "empty stdin should still fail open to a printed Nogra statusline");
  const brokenStdinOutput = runStatusline("{not-json::::", repoRoot).trim();
  assert(brokenStdinOutput.length > 0 && brokenStdinOutput.startsWith("Nogra:"), "malformed stdin should still fail open to a printed Nogra statusline");

  // (b) run segment appears with a fixture active run and is absent when none / only terminal.
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-statusline-smoke-run-"));
  tempDirs.push(fixtureDir);
  assertNoNograAncestor(fixtureDir);
  writeJson(path.join(fixtureDir, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceId: "statusline-smoke-fixture",
    gate: { mode: "advisory", autoApprove: false }
  });

  const now = Date.now();
  const runId1 = "transport-smoketest0001-aaaa1111";
  const runFile1 = path.join(fixtureDir, ".nogra", "transport", "runs", `${runId1}.json`);
  writeJson(runFile1, {
    runId: runId1,
    status: "running",
    briefId: "brief-statusline-smoke-fixture",
    nextOwner: "nogra:manager",
    executionRuntime: "anthropic:sonnet",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });

  const activeRunOutput = runStatusline("{}", fixtureDir);
  assert(
    activeRunOutput.includes("▶ executor: Sonnet · Run aaaa1111"),
    `expected active-run/executor segment in fixture statusline, got: ${activeRunOutput.trim()}`
  );
  assert(activeRunOutput.includes("running"), "active-run segment should include the run status");

  // Second active run -> " +1" suffix.
  const runId2 = "transport-smoketest0002-bbbb2222";
  const runFile2 = path.join(fixtureDir, ".nogra", "transport", "runs", `${runId2}.json`);
  writeJson(runFile2, {
    runId: runId2,
    status: "queued",
    briefId: "brief-statusline-smoke-fixture-2",
    nextOwner: "nogra:manager",
    executionRuntime: "anthropic:sonnet",
    createdAt: new Date(now - 1000).toISOString(),
    updatedAt: new Date(now - 1000).toISOString()
  });
  const twoActiveRunOutput = runStatusline("{}", fixtureDir);
  assert(twoActiveRunOutput.includes(" +1"), `expected +1 suffix with two active runs, got: ${twoActiveRunOutput.trim()}`);

  // Remove both fixture runs -> segment absent.
  fs.rmSync(runFile1);
  fs.rmSync(runFile2);
  const noRunOutput = runStatusline("{}", fixtureDir);
  assert(!noRunOutput.includes("▶ executor:"), `expected no active-run segment with no runs present, got: ${noRunOutput.trim()}`);

  // Only a terminal run present -> segment absent.
  writeJson(runFile1, {
    runId: runId1,
    status: "returned",
    briefId: "brief-statusline-smoke-fixture",
    nextOwner: "nogra:manager",
    executionRuntime: "anthropic:sonnet",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
  const terminalOnlyOutput = runStatusline("{}", fixtureDir);
  assert(!terminalOnlyOutput.includes("▶ executor:"), `expected no active-run segment with only a terminal run present, got: ${terminalOnlyOutput.trim()}`);

  // (e) read-only: fixture invocation writes nothing under its own .nogra tree either.
  const fixtureNograBefore = snapshotDir(path.join(fixtureDir, ".nogra"));
  runStatusline("{}", fixtureDir);
  const fixtureNograAfter = snapshotDir(path.join(fixtureDir, ".nogra"));
  assertSameSnapshot(fixtureNograBefore, fixtureNograAfter, "fixture run-segment invocation");

  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("smoke-statusline: ok");
}

try {
  main();
} catch (error) {
  console.error(`smoke-statusline: FAIL - ${error.message}`);
  process.exitCode = 1;
}
