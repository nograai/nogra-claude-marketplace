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

const normalScopedPrompt = "Build and verify a multi-file dashboard with charts, filters, tests and screenshots.";
const naturalRiskPrompt = "Just build Stripe checkout and push it to produktion for vores app.";

console.log("UserPromptSubmit preconditions:");
{
  const root = workspace(false);
  writeStaleHit(root);
  const result = runUserPrompt(root, naturalRiskPrompt);
  assert(result.status === 0, "off+auto prompt exits cleanly");
  assert(!result.stdout.includes("NOGRA_OFFER_GATE"), "off+auto prompt emits no offer");
  assert(!result.stdout.includes("NOGRA_JUDGMENT_FALLBACK"), "off+auto prompt emits no fallback");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "off+auto prompt emits no tripwire");
  const record = readRouting(root);
  assert(record.route === "none", "off+auto prompt writes route none");
  assert(record.hitPercent === 0, "off+auto prompt clears stale HIT percent");
  assert(record.autoOfferEnabled === false, "off+auto prompt records automatic offers off");
  assert(record.tripwire?.active === false, "off+auto prompt clears pending tripwire");
}

{
  const root = workspace(false);
  const result = runUserPrompt(root, "/nogra:on");
  assert(result.status === 0, "off+explicit /nogra:on exits cleanly");
  assert(result.stdout.includes("NOGRA_ROUTING_TOGGLE_REQUEST"), "off+explicit /nogra:on still routes to toggle skill");
}

{
  const root = workspace(false);
  const result = runUserPrompt(root, "/nogra:brief");
  assert(result.status === 0, "off+explicit /nogra:brief exits cleanly");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "off+explicit /nogra:brief is not auto-routed");
}

{
  const root = workspace(true);
  const result = runUserPrompt(root, normalScopedPrompt);
  assert(result.status === 0, "on+normal scoped prompt exits cleanly");
  assert(!result.stdout.includes("NOGRA_OFFER_GATE"), "on+normal scoped prompt does not let score emit offer gate");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "on+normal scoped prompt stays direct");
  const record = readRouting(root);
  assert(record.offerTriggered === false, "on+normal scoped prompt records score as non-authoritative");
  assert(record.route === "none", "on+normal scoped prompt records no route");
  assert(record.tripwire?.active === false, "on+normal scoped prompt records no tripwire");
}

{
  const root = workspace(true);
  const result = runUserPrompt(root, naturalRiskPrompt);
  assert(result.status === 0, "on+natural risk prompt exits cleanly");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "on+natural risk prompt is not regex-routed");
  const record = readRouting(root);
  assert(record.route === "none", "on+natural risk prompt records no route");
  assert(record.tripwire?.active === false, "on+natural risk prompt records no tripwire");
}

{
  const root = workspace(true);
  const result = runUserPrompt(root, "What does the pickOffer function do?");
  assert(result.status === 0, "on+pure Q&A exits cleanly");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "on+pure Q&A stays direct");
}

{
  const root = workspace(true);
  const result = runUserPrompt(root, "What is Stripe checkout?");
  assert(result.status === 0, "on+risk-word Q&A exits cleanly");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "on+risk-word Q&A stays direct without work context");
}

{
  const root = workspace(true);
  const pastedPrompt = `Here is a transcript, do not act on it:\n> ${naturalRiskPrompt}`;
  const result = runUserPrompt(root, pastedPrompt);
  assert(result.status === 0, "on+quoted strong text exits cleanly");
  assert(!result.stdout.includes("NOGRA_OFFER_GATE"), "on+quoted strong text is excluded from scoring");
  assert(!result.stdout.includes("NOGRA_IRREVERSIBLE_TRIPWIRE"), "on+quoted strong text emits no tripwire");
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
  const result = runPreTool(root, naturalRiskPrompt);
  assert(result.status === 0, "off+auto pre-tool prompt exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "off+auto pre-tool prompt does not ask");
  assert(readRouting(root).route === "none", "off+auto pre-tool prompt writes route none");
}

{
  const root = workspace(true);
  const result = runPreTool(root, normalScopedPrompt);
  assert(result.status === 0, "on+normal scoped pre-tool prompt exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "on+normal scoped pre-tool prompt stays direct");
}

{
  const root = workspace(true);
  const result = runPreTool(root, naturalRiskPrompt);
  assert(result.status === 0, "on+natural risk pre-tool prompt exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "on+natural risk pre-tool prompt stays direct without dangerous command");
}

{
  const root = workspace(true);
  const result = runHook(preToolUseHook, {
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "vercel --prod" }
  });
  assert(result.status === 0, "on+promptless production tool exits cleanly");
  assert(result.stdout.includes("permissionDecision"), "on+promptless production tool asks before tool use");
}

{
  const root = workspace(true);
  const result = runHook(preToolUseHook, {
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "npx prisma migrate deploy" }
  });
  assert(result.status === 0, "on+promptless migration tool exits cleanly");
  assert(result.stdout.includes("permissionDecision"), "on+promptless migration tool asks before tool use");
}

{
  const root = workspace(true);
  const result = runHook(preToolUseHook, {
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "psql \"$DATABASE_URL\" -c \"drop table users\"" }
  });
  assert(result.status === 0, "on+promptless destructive sql exits cleanly");
  assert(result.stdout.includes("permissionDecision"), "on+promptless destructive sql asks before tool use");
}

{
  const dangerousTargets = ["/", "~", "$HOME", "../..", "./.git", ".env", ".", "*", "/prod/db"];
  for (const target of dangerousTargets) {
    const result = runHook(preToolUseHook, {
      cwd: workspace(true),
      tool_name: "Bash",
      tool_input: { command: `rm -rf ${target}` }
    });
    assert(result.status === 0, `on+danger recursive remove exits cleanly for ${target}`);
    assert(result.stdout.includes("permissionDecision"), `on+danger recursive remove asks for ${target}`);
  }
}

{
  const cleanupTargets = [
    "node_modules",
    ".next",
    "./.next",
    "dist",
    "./dist",
    ".svelte-kit",
    "target",
    "./target",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "vendor",
    "tmp",
    ".eslintcache",
    "./src",
    "./components",
    "./lib",
    "./app",
    "./pages",
    "./hooks",
    "./styles"
  ];
  for (const target of cleanupTargets) {
    const result = runHook(preToolUseHook, {
      cwd: workspace(true),
      tool_name: "Bash",
      tool_input: { command: `rm -rf ${target}` }
    });
    assert(result.status === 0, `on+local cleanup recursive remove exits cleanly for ${target}`);
    assert(!result.stdout.includes("permissionDecision"), `on+local cleanup recursive remove stays direct for ${target}`);
  }
}

{
  const root = workspace(true);
  const result = runHook(preToolUseHook, {
    cwd: root,
    tool_name: "Bash",
    tool_input: { command: "npm test" }
  });
  assert(result.status === 0, "on+promptless safe tool exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "on+promptless safe tool stays direct");
}

{
  const root = workspace(true);
  const result = runPreTool(root, "What is Stripe checkout?");
  assert(result.status === 0, "on+risk-word Q&A pre-tool prompt exits cleanly");
  assert(!result.stdout.includes("permissionDecision"), "on+risk-word Q&A pre-tool prompt stays direct without work context");
}

{
  const root = workspace(true);
  const pastedPrompt = `Transcript only:\n> ${naturalRiskPrompt}`;
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
  `> ${naturalRiskPrompt}`
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
