#!/usr/bin/env node
// Smoke: the bound boot order (hooks/boot-order.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function run(root) {
  const out = execFileSync("node", ["hooks/boot-order.mjs"], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

let n = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log(`ok ${++n} - ${name}`); };

// 1. workspace WITH state → the order is injected
const withState = mkdtempSync(join(tmpdir(), "boot-order-"));
mkdirSync(join(withState, ".nogra", "state"), { recursive: true });
writeFileSync(join(withState, ".nogra", "state", "SESSION-CHECKPOINT.md"), "# checkpoint\n");
const ctx = run(withState);
ok("existing state injects <nogra-boot-order>", ctx.includes("<nogra-boot-order>"));
ok("the order names the four reads in order",
  ctx.indexOf("SESSION-CHECKPOINT.md") < ctx.indexOf("ledger") &&
  ctx.indexOf("ledger") < ctx.indexOf("pinned user profile") &&
  ctx.indexOf("pinned user profile") < ctx.indexOf("STANDING AGREEMENT"));
ok("yesterday's agreement is law, GO inherits the plan",
  ctx.includes("Yesterday's agreement is law") && ctx.includes("NEVER authorizes shortcuts"));
ok("one green box never auto-approves the rest", ctx.includes("never auto-approves"));
ok("regardless of which model answers", ctx.includes("regardless of which model"));

// 2. fresh workspace (no state) → silent
const fresh = mkdtempSync(join(tmpdir(), "boot-order-fresh-"));
ok("fresh workspace stays silent", run(fresh) === "");

console.log(`\n${n} checks passed — the boot order is bound. EXIT=0`);
