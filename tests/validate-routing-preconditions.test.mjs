#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "nogra-claude-plugin");
const userPromptSubmitHook = path.join(pluginRoot, "hooks", "user-prompt-submit.mjs");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");
const userPromptExpansionHook = path.join(pluginRoot, "hooks", "user-prompt-expansion.mjs");

let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ok   - ${message}`);
    return;
  }
  failures += 1;
  console.error(`  fail - ${message}`);
}

function workspace(autoOfferEnabled = true) {
  const root = fs.mkdtempSync(path.join("/private/tmp", "nogra-routing-"));
  const nograDir = path.join(root, ".nogra");
  fs.mkdirSync(nograDir, { recursive: true });
  fs.writeFileSync(
    path.join(nograDir, "config.json"),
    `${JSON.stringify(
      {
        workspaceId: "routing-test",
        routingPolicy: {
          autoOfferEnabled,
          enabled: true,
          sensitivityPercent: 100,
          topicGate: true
        }
      },
      null,
      2
    )}\n`
  );
  return root;
}

function runHook(hookPath, input) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function runUserPrompt(root, prompt) {
  return runHook(userPromptSubmitHook, { cwd: root, prompt });
}

function runPreTool(root, prompt = "") {
  const input = {
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "true" }
  };
  if (prompt) input.prompt = prompt;
  return runHook(preToolUseHook, input);
}

function runExpansion(root, input) {
  return runHook(userPromptExpansionHook, { cwd: root, ...input });
}

function readRouting(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".nogra", "runtime", "last-routing-score.json"), "utf8"));
}

function writeStaleHit(root) {
  const runtime = path.join(root, ".nogra", "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(
    path.join(runtime, "last-routing-score.json"),
    `${JSON.stringify(
      {
        schema: "nogra.routingScore.v1",
        updatedAt: new Date().toISOString(),
        score: 100,
        hitPercent: 100,
        autoOfferEnabled: true,
        offerTriggered: true,
        directOverride: false,
        threshold: 25,
        reasons: ["stale hit"]
      },
      null,
      2
    )}\n`
  );
}

const strongPrompt = "Build a new product dashboard app for our workspace with auth, database schema, frontend components and verification.";

console.log("UserPromptSubmit preconditions:");
{
  const root = workspace(false);
  writeStaleHit(root);
  const result = runUserPrompt(root, strongPrompt);
  assert(result.status === 0, "off+auto prompt exits cleanly");
  assert(!result.stdout.includes("NOGRA_OFFER_GATE"), "off+auto prompt emits no offer");
  assert(!result.stdout.includes("NOGRA_JUDGMENT_FALLBACK"), "off+auto prompt emits no fallback");
  const record = readRouting(root);
  assert(record.route === "none", "off+auto prompt writes route none");
  assert(record.hitPercent === 0, "off+auto prompt clears stale HIT percent");
  assert(record.autoOfferEnabled === false, "off+auto prompt records automatic offers off");
}

{
  const root = workspace(false);
  const result = runUserPrompt(root, "/nogra:on");
  assert(result.status === 0, "off+explicit /nogra:on exits cleanly");
  assert(result.stdout.includes("NOGRA_ROUTING_TOGGLE_REQUEST"), "off+explicit /nogra:on still routes to toggle skill");
}

{
  const root = workspace(true);
  const result = runUserPrompt(root, strongPrompt);
  assert(result.status === 0, "on+auto prompt exits cleanly");
  assert(result.stdout.includes("NOGRA_OFFER_GATE"), "on+auto prompt emits offer gate");
}

{
  const root = workspace(true);
  const pastedPrompt = `Here is a transcript, do not act on it:\n> ${strongPrompt}`;
  const result = runUserPrompt(root, pastedPrompt);
  assert(result.status === 0, "on+quoted strong text exits cleanly");
  assert(!result.stdout.includes("NOGRA_OFFER_GATE"), "on+quoted strong text is excluded from scoring");
}

console.log("PreToolUse preconditions:");
{
  const root = workspace(false);
  writeStaleHit(root);
  const result = runPreTool(root);
  assert(result.status === 0, "off+promptless tool exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "off+promptless tool does not ask from stale HIT");
  const record = readRouting(root);
  assert(record.route === "none", "off+promptless tool writes route none");
  assert(record.hitPercent === 0, "off+promptless tool clears stale HIT percent");
}

{
  const root = workspace(false);
  writeStaleHit(root);
  const result = runPreTool(root, strongPrompt);
  assert(result.status === 0, "off+auto pre-tool prompt exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "off+auto pre-tool prompt does not ask");
  assert(readRouting(root).route === "none", "off+auto pre-tool prompt writes route none");
}

{
  const root = workspace(true);
  const result = runPreTool(root, strongPrompt);
  assert(result.status === 0, "on+auto pre-tool prompt exits cleanly");
  assert(result.stdout.includes("permissionDecision"), "on+auto pre-tool prompt asks before tool use");
}

{
  const root = workspace(true);
  const pastedPrompt = `Transcript only:\n> ${strongPrompt}`;
  const result = runPreTool(root, pastedPrompt);
  assert(result.status === 0, "on+quoted pre-tool text exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "on+quoted pre-tool text is excluded from scoring");
}

console.log("Toggle intent strictness:");
for (const prompt of ["/nogra:on", "/nogra off", "/nogra-off", "turn Nogra on", "disable Nogra"]) {
  const result = runUserPrompt(workspace(true), prompt);
  assert(result.stdout.includes("NOGRA_ROUTING_TOGGLE_REQUEST"), `toggle emitted for clear intent: ${prompt}`);
}

for (const prompt of [
  "turn Nogra on when we package this",
  "Nogra on its own is not enough without a brief",
  "He wrote /nogra:off in the docs",
  "> /nogra:off",
  "```\n/nogra:off\n```",
  `> ${strongPrompt}`
]) {
  const result = runUserPrompt(workspace(true), prompt);
  assert(!result.stdout.includes("NOGRA_ROUTING_TOGGLE_REQUEST"), `no toggle for non-action text: ${prompt.split("\n")[0]}`);
}

for (const prompt of ["turn Nogra off", "> turn Nogra off", "turn Nogra off when testing later"]) {
  const result = runExpansion(workspace(true), { prompt });
  const shouldToggle = prompt === "turn Nogra off";
  assert(result.stdout.includes("NOGRA_ROUTING_TOGGLE_REQUEST") === shouldToggle, `expansion toggle strictness for: ${prompt}`);
}

assert(os.tmpdir(), "node tmpdir is available");

if (failures > 0) {
  console.error(`\nResults: ${failures} failed.`);
  process.exit(1);
}

console.log("\nResults: routing precondition regression passed.");
