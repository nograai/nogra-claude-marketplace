#!/usr/bin/env node

// Gate authorize ladder smoke: proves /nogra:authorize opens exactly the
// running intent's boundary CLASS — not one tool, not the whole gate — and is
// fail-closed on every other path. Drives the real pre-tool-use.mjs hook
// against temp fixture workspaces with SIMULATED tool calls; no command is
// ever executed. Never touches real workspace .nogra state.
//
// The ladder (each rung is one more degree of freedom the gate must survive):
//   ①  no running intent          -> ASK    (fail-closed baseline)
//   ②  class authorized, opt-in off -> skip  (Nogra silent, native prompt governs, no allow)
//   ③  class + scope + autoApprove  -> ALLOW (the one door that opens)
//   ④  a neighbouring class         -> ASK    (no cross-leak)
//   ⑤  scope-miss                   -> ASK    (scope must cover the target)
// ③ is the only green door; ①②④⑤ prove every other path stays closed.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function runHook(input) {
  const raw = execFileSync(process.execPath, [preToolUseHook], {
    cwd: os.tmpdir(),
    input: JSON.stringify(input),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: hookEnv()
  });
  return raw.trim() ? JSON.parse(raw) : {};
}

// A boundary class is authorized on the intent; scope bounds where it applies.
function makeWorkspace(name, { gate, intent } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nogra-authz-${name}-`));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `authz-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) config.gate = gate;
  writeJson(path.join(root, ".nogra", "config.json"), config);
  if (intent) writeJson(path.join(root, ".nogra", "runtime", "active-intent.json"), intent);
  return root;
}

const intentWith = (authorize, scope) => ({
  schema: "nogra.activeIntent.v1",
  status: "active",
  objective: "the overlying work this run is about",
  gate: { authorize, scope }
});

// The command is only ever DATA handed to the gate — never executed.
function bashInput(root, command, seq) {
  return {
    cwd: root,
    workspace_roots: [root],
    tool_name: "Bash",
    tool_input: { command },
    session_id: `authz-ladder-${seq}`,
    transcript_path: `/tmp/transcript-authz-${seq}.jsonl`
  };
}

function decisionOf(output) {
  const d = output?.hookSpecificOutput?.permissionDecision;
  if (d === "allow" || d === "deny" || d === "ask") return d;
  return "skip"; // gate emitted no decision -> stayed silent, native system governs
}

// Three DISTINCT boundary classes — the whole point: authorize is about the
// class of the overlying work, not one tool.
const CLASSES = [
  { key: "production-deploy", cmd: "vercel --prod" },
  { key: "git-history", cmd: "git push origin main" },
  { key: "destructive-write", cmd: "rm -rf ./build" }
];

const roots = [];
const rows = [];
let seq = 0;
let failures = 0;

function check(rung, label, root, cmd, want) {
  roots.push(root);
  const got = decisionOf(runHook(bashInput(root, cmd, ++seq)));
  const pass = got === want;
  if (!pass) failures += 1;
  rows.push({ rung, label, got, want, pass });
}

// ① No running intent -> every class ASKS (fail-closed). autoApprove is ON to
//    prove it is the missing intent, not a missing opt-in, that keeps it closed.
for (const c of CLASSES) {
  check("①", `no intent · ${c.key}`, makeWorkspace(`no-intent-${c.key}`, { gate: { mode: "advisory", autoApprove: true } }), c.cmd, "ask");
}

// ② Class authorized, autoApprove OFF -> Nogra skips its nudge but emits no allow.
for (const c of CLASSES) {
  check("②", `authorized · opt-in off · ${c.key}`, makeWorkspace(`optin-off-${c.key}`, { gate: { mode: "advisory", autoApprove: false }, intent: intentWith([c.key], ["**"]) }), c.cmd, "skip");
}

// ③ Class + scope + autoApprove ON -> ALLOW (the flip).
for (const c of CLASSES) {
  check("③", `authorized · scope · opt-in on · ${c.key}`, makeWorkspace(`allow-${c.key}`, { gate: { mode: "advisory", autoApprove: true }, intent: intentWith([c.key], ["**"]) }), c.cmd, "allow");
}

// ④ Authorize ONE class -> the others still ASK (no cross-leak).
{
  const only = intentWith(["production-deploy"], ["**"]);
  check("④", "only prod-deploy · vercel --prod", makeWorkspace("leak-deploy", { gate: { mode: "advisory", autoApprove: true }, intent: only }), "vercel --prod", "allow");
  check("④", "only prod-deploy · git push", makeWorkspace("leak-git", { gate: { mode: "advisory", autoApprove: true }, intent: intentWith(["production-deploy"], ["**"]) }), "git push origin main", "ask");
  check("④", "only prod-deploy · rm -rf", makeWorkspace("leak-rm", { gate: { mode: "advisory", autoApprove: true }, intent: intentWith(["production-deploy"], ["**"]) }), "rm -rf ./build", "ask");
}

// ⑤ Scope-miss -> ASK even with the class authorized.
check("⑤", "prod-deploy · scope 'wrangler *' vs vercel", makeWorkspace("scope-miss", { gate: { mode: "advisory", autoApprove: true }, intent: intentWith(["production-deploy"], ["wrangler *"]) }), "vercel --prod", "ask");

// --- Report: the gold table ---
const glyph = { allow: "ALLOW", ask: "ASK", skip: "skip", deny: "DENY" };
console.log("\nGate authorize ladder — /nogra:authorize opens the intent's CLASS, fail-closed elsewhere\n");
console.log("  rung  scenario                                          decision   want    ");
console.log("  ----  ------------------------------------------------  ---------  ------  ");
for (const r of rows) {
  console.log(`  ${r.rung}    ${r.label.padEnd(48)}  ${glyph[r.got].padEnd(9)}  ${glyph[r.want].padEnd(6)}  ${r.pass ? "✓" : "✗ FAIL"}`);
}

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });

if (failures) {
  console.error(`\nauthorize-ladder smoke FAILED: ${failures} rung(s) off — a gate door moved.`);
  process.exit(1);
}
console.log("\nauthorize-ladder smoke OK — the only green door is ③ (class + scope + opt-in); every other path stays closed.");
