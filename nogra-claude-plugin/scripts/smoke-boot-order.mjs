#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function run(root, source = "startup") {
  const output = execFileSync("node", ["hooks/boot-order.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    input: JSON.stringify({ cwd: root, source }),
    encoding: "utf8"
  });
  return JSON.parse(output).hookSpecificOutput.additionalContext;
}

function initialize(root) {
  mkdirSync(join(root, ".nogra", "state"), { recursive: true });
  writeFileSync(
    join(root, ".nogra", "config.json"),
    `${JSON.stringify({ schema: "nogra.workspace.config.v1", workspaceName: "Boot Smoke", workspaceId: "boot-smoke" })}\n`
  );
}

let checks = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
};

const withState = mkdtempSync(join(tmpdir(), "boot-order-"));
initialize(withState);
writeFileSync(join(withState, ".nogra", "state", "SESSION-CHECKPOINT.md"), "# checkpoint\n");
const startup = run(withState, "startup");
ok("startup is focused, not resumed", startup.includes("state=focused") && !startup.includes("RESUMING work"));
ok("checkpoint is detected but not loaded", startup.includes("checkpointAvailable=true") && startup.includes("checkpointLoaded=false"));
ok("boot never authorizes continuation", startup.includes("authorization=none") && startup.includes("no boot state authorizes"));

const resumed = run(withState, "resume");
ok("explicit native resume is named", resumed.includes("state=resumed") && resumed.includes("explicit native resume"));
ok("native resume is not Nogra GO", resumed.includes("not Nogra GO"));

const withoutCheckpoint = mkdtempSync(join(tmpdir(), "boot-order-empty-"));
initialize(withoutCheckpoint);
const focused = run(withoutCheckpoint, "startup");
ok("initialized workspace without checkpoint is focused", focused.includes("state=focused") && focused.includes("checkpointAvailable=false"));

const fresh = mkdtempSync(join(tmpdir(), "boot-order-fresh-"));
ok("folder without Nogra stays silent", run(fresh, "startup") === "");

console.log(`\n${checks} checks passed — boot state is explicit. EXIT=0`);
