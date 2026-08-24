#!/usr/bin/env node

// Delivery-gate + pace smoke: the known facits (21/08/2026). Temp fixture workspace only;
// never touches a real workspace; zero live model calls.
//   1. loopback link                         -> blocked
//   2. house link without receipt            -> blocked
//   3. homework x2 without board reference   -> blocked
//   4. homework with a board reference       -> silent
//   5. plain message                         -> silent
//   6. house link WITH fresh receipt         -> silent (receipt written by the CLI with a fresh screenshot)
//   7. stop_hook_active                      -> systemMessage only (never a loop)
//   8. gate disabled in config               -> silent
//   9. pace: "slow down" -> SLOW + context; "full speed" -> normal; workspace phrases honored
//  10. receipt CLI refuses a stale screenshot and a loopback url

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const GATE = path.join(pluginRoot, "hooks", "delivery-gate.mjs");
const PACE = path.join(pluginRoot, "hooks", "pace-context.mjs");
const RECEIPT = path.join(pluginRoot, "scripts", "nogra-delivery-receipt.mjs");
const PACE_CLI = path.join(pluginRoot, "scripts", "nogra-pace.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeWorkspace(extraConfig = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-delivery-gate-"));
  writeJson(path.join(root, ".nogra", "config.json"), {
    schema: "nogra.workspace.config.v1",
    workspaceId: "delivery-gate-smoke",
    installMode: "plugin",
    connectionMode: "local",
    ...extraConfig
  });
  fs.mkdirSync(path.join(root, ".nogra", "ledger"), { recursive: true });
  fs.writeFileSync(path.join(root, ".nogra", "ledger", "events.jsonl"), "", "utf8");
  return root;
}

function runHook(script, root, input) {
  const res = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ cwd: root, ...input }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_ROOT: root }
  });
  assert(res.status === 0, `${path.basename(script)} exited ${res.status}: ${res.stderr}`);
  const out = res.stdout.trim();
  return out ? JSON.parse(out) : null;
}

function gate(root, text, extra = {}) {
  return runHook(GATE, root, { last_assistant_message: text, ...extra });
}

function tinyPng(file) {
  // 1x1 transparent PNG (valid header; content irrelevant for the smoke)
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  fs.writeFileSync(file, png);
}

const root = makeWorkspace({ deliveryGate: { hostPatterns: ["my-dev-host(?:\\.local)?"], homeworkPhrases: ["dit greb", "ceo-dom", "sig til når"], boardRefPatterns: ["tavlen\\.y26\\.dev"] } });

// 1
let r = gate(root, "TAKT is up: http://localhost:3001 — click.");
assert(r?.decision === "block" && /loopback/u.test(r.reason), "1: loopback must block");
// 2
r = gate(root, "See http://my-dev-host.local:3001 in your browser.");
assert(r?.decision === "block" && /without a delivery-receipt/u.test(r.reason), "2: house link without receipt must block");
// 3 (workspace phrases, Danish, + default English)
r = gate(root, "Dit greb: read the drawing. CEO-dom on 4b. Your call.");
assert(r?.decision === "block" && /homework/u.test(r.reason), "3: homework without board ref must block");
// 4
r = gate(root, "Dit greb stands on card_88b6c6942418 — CEO-dom there.");
assert(r === null, "4: homework with a card reference must be silent");
// 5
r = gate(root, "lbm floor 0->80, fence exit 0.");
assert(r === null, "5: plain message must be silent");
// 6: receipt via CLI with fresh screenshot
const shot = path.join(root, "shot.png");
tinyPng(shot);
const out = execFileSync(process.execPath, [RECEIPT, "http://my-dev-host.local:3099", shot, "smoke", "--root", root], { encoding: "utf8" });
assert(/RECEIPT:/u.test(out), `6: receipt CLI should write a receipt: ${out}`);
r = gate(root, "See http://my-dev-host.local:3099 in your browser.");
assert(r === null, "6: house link with fresh receipt must be silent");
// 7
r = gate(root, "http://localhost:3001", { stop_hook_active: true });
assert(r && !r.decision && /loopback/u.test(r.systemMessage || ""), "7: stop_hook_active must only warn");
// 8
const off = makeWorkspace({ deliveryGate: { enabled: false } });
r = gate(off, "http://localhost:3001");
assert(r === null, "8: disabled gate must be silent");
// 9: pace
const p1 = runHook(PACE, root, { prompt: "Super -> Sloooooow down champ" });
assert(p1?.hookSpecificOutput?.additionalContext?.includes("PACE: SLOW"), "9a: 'slow down' must set SLOW and inject");
assert(JSON.parse(fs.readFileSync(path.join(root, ".nogra", "state", "PACE.json"), "utf8")).pace === "slow", "9a: PACE.json must be slow");
const p2 = runHook(PACE, root, { prompt: "what is the status?" });
assert(p2?.hookSpecificOutput?.additionalContext?.includes("PACE: SLOW"), "9b: SLOW must persist across turns");
const p3 = runHook(PACE, root, { prompt: "full speed again" });
assert(p3 === null, "9c: 'full speed' must lift and be silent");
const wsRoot = makeWorkspace({ pace: { slowPhrases: ["rolig nu"], normalPhrases: ["fuld fart"] } });
const p4 = runHook(PACE, wsRoot, { prompt: "rolig nu champ" });
assert(p4?.hookSpecificOutput?.additionalContext?.includes("PACE: SLOW"), "9d: workspace slow phrase must work");
const p5 = runHook(PACE, wsRoot, { prompt: "fuld fart" });
assert(p5 === null, "9e: workspace normal phrase must lift");
const cli = execFileSync(process.execPath, [PACE_CLI, "status", "--root", wsRoot], { encoding: "utf8" });
assert(/"pace":"normal"/u.test(cli), `9f: pace CLI status: ${cli}`);
// 10: stale screenshot + loopback refused
const old = path.join(root, "old.png");
tinyPng(old);
const past = new Date(Date.now() - 60 * 60 * 1000);
fs.utimesSync(old, past, past);
let stale = spawnSync(process.execPath, [RECEIPT, "http://my-dev-host.local:3100", old, "--root", root], { encoding: "utf8" });
assert(stale.status === 66, `10a: stale screenshot must be refused (got ${stale.status})`);
stale = spawnSync(process.execPath, [RECEIPT, "http://localhost:3100", shot, "--root", root], { encoding: "utf8" });
assert(stale.status === 67, `10b: loopback url must be refused (got ${stale.status})`);
// audit lines exist
const ledger = fs.readFileSync(path.join(root, ".nogra", "ledger", "events.jsonl"), "utf8");
assert((ledger.match(/"eventType":"delivery-gate"/gu) || []).length >= 4, "audit: delivery-gate events must be written on block/warn");
assert(/"eventType":"delivery-receipt"/u.test(ledger), "audit: delivery-receipt event must be written");
assert(/"eventType":"pace-slow"/u.test(ledger), "audit: pace-slow event must be written");

console.log("smoke-delivery-gate: 10/10 facits green (block x3, silent x4, warn x1, disabled x1, pace x6, receipt CLI x2)");
