#!/usr/bin/env node
// Smoke: sync-cli.mjs — the human handle must be honest offline.
// No network: these checks cover config handling, refusals, receipts and the
// token-silence contract. The network paths are covered by smoke-sync-client.mjs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "sync-cli.mjs");
let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

function run(root, args, env = {}) {
  try {
    const out = execFileSync("node", [cli, ...args], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, NOGRA_SYNC_TOKEN: "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const root = mkdtempSync(join(tmpdir(), "nogra-sync-cli-"));

// 1) uninitialized workspace: status reports, bind refuses
let r = run(root, ["status"]);
check("status on uninitialized workspace reports, exit 0", r.code === 0 && /not initialized/.test(r.out));
r = run(root, ["bind", "https://example.com"]);
check("bind on uninitialized workspace refuses, exit 1", r.code === 1 && /not initialized/.test(r.out));

// 2) initialized workspace
mkdirSync(join(root, ".nogra"), { recursive: true });
writeFileSync(join(root, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke", other: { keep: true } }, null, 2));

r = run(root, ["status"]);
check("status shows off-by-default", r.code === 0 && /no \(off by default\)/.test(r.out));
check("status shows token MISSING", /MISSING/.test(r.out));

// 3) bind refusals: plain http (non-loopback), garbage
r = run(root, ["bind", "http://example.com"]);
check("bind refuses plain http, exit 1", r.code === 1 && /Refused/.test(r.out));
r = run(root, ["bind"]);
check("bind refuses empty endpoint, exit 1", r.code === 1);

// 4) bind accepts https, preserves foreign config keys, writes receipt
r = run(root, ["bind", "https://sync.example.com/"]);
check("bind https ok, trailing slash stripped", r.code === 0 && /sync enabled → https:\/\/sync\.example\.com$/m.test(r.out));
check("bind warns token MISSING with own-hand instructions", /YOUR OWN hand/.test(r.out));
let cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
check("config sync block written", cfg.sync && cfg.sync.enabled === true && cfg.sync.endpoint === "https://sync.example.com");
check("foreign config keys preserved", cfg.other && cfg.other.keep === true && cfg.workspaceId === "smoke");
const logPath = join(root, ".nogra", "memory", "sync", "log.jsonl");
check("bind left a receipt", existsSync(logPath) && /"op":"bind"/.test(readFileSync(logPath, "utf8")));

// 5) status after bind: enabled + endpoint + receipt visible
r = run(root, ["status"]);
check("status shows enabled + endpoint", /enabled: {2}yes/.test(r.out) && /sync\.example\.com/.test(r.out));
check("status lists the bind receipt", /receipts \(last/.test(r.out) && /bind/.test(r.out));

// 6) token presence reported, value NEVER echoed
writeFileSync(join(root, ".nogra", "memory", "sync", "token"), "smoke-secret-value-9911\n");
r = run(root, ["status"]);
check("status reports token file presence", /file \.nogra\/memory\/sync\/token/.test(r.out));
check("token value never appears in output", !/smoke-secret-value-9911/.test(r.out));
r = run(root, ["status"], { NOGRA_SYNC_TOKEN: "env-secret-value-7733" });
check("env token presence wins, value silent", /env NOGRA_SYNC_TOKEN/.test(r.out) && !/env-secret-value-7733/.test(r.out));

// 7) off keeps endpoint, writes receipt; unknown verb refuses
r = run(root, ["off"]);
check("off ok", r.code === 0 && /disabled/.test(r.out));
cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
check("off keeps endpoint, disables flag", cfg.sync.enabled === false && cfg.sync.endpoint === "https://sync.example.com");
check("off left a receipt", /"op":"off"/.test(readFileSync(logPath, "utf8")));
r = run(root, ["dance"]);
check("unknown verb refuses with usage, exit 1", r.code === 1 && /unknown verb/.test(r.out));

// 8) pull/push honest while disabled (no network, no crash)
r = run(root, ["pull"]);
check("pull while disabled reports, exit 0", r.code === 0 && /disabled|no changes/.test(r.out));
r = run(root, ["push"]);
check("push while disabled reports skipped", r.code === 0 && /skipped \(disabled\)/.test(r.out));

rmSync(root, { recursive: true, force: true });
console.log(`\nsmoke-sync-cli: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
