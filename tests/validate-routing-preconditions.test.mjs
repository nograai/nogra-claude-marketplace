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
const hooksConfigPath = path.join(pluginRoot, "hooks", "hooks.json");
const sessionStartHook = path.join(pluginRoot, "hooks", "session-start.mjs");
const postCompactHook = path.join(pluginRoot, "hooks", "post-compact.mjs");
const sessionEndHook = path.join(pluginRoot, "hooks", "session-end.mjs");
const userPromptSubmitHook = path.join(pluginRoot, "hooks", "user-prompt-submit.mjs");

let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ok   - ${message}`);
    return;
  }
  failures += 1;
  console.error(`  fail - ${message}`);
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-lifecycle-"));
  fs.mkdirSync(path.join(root, ".nogra"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".nogra", "config.json"),
    `${JSON.stringify(
      {
        schema: "nogra.workspace.config.v1",
        workspaceId: "lifecycle-test",
        workspaceName: "Lifecycle Test",
        connectionMode: "local",
        routingPolicy: {
          defaultLanguage: "en",
          translationFallback: "claude-current-prompt"
        },
        paths: {
          currentCheckpoint: ".nogra/state/SESSION-CHECKPOINT.md"
        }
      },
      null,
      2
    )}\n`
  );
  fs.mkdirSync(path.join(root, ".nogra", "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".nogra", "state", "SESSION-CHECKPOINT.md"),
    [
      "# Session Checkpoint",
      "",
      "Workspace: Lifecycle Test",
      "SourceWatermark: 0",
      "",
      "## Current State",
      "",
      "Lifecycle smoke workspace."
    ].join("\n"),
    "utf8"
  );
  return root;
}

function runHook(hookPath, input) {
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: repoRoot,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot }
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function parseHookOutput(result) {
  if (!result.stdout) return {};
  return JSON.parse(result.stdout);
}

function additionalContext(result) {
  return parseHookOutput(result).hookSpecificOutput?.additionalContext || "";
}

console.log("Lifecycle hook wiring:");
{
  const hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, "utf8"));
  assert(hooksConfig.hooks?.SessionStart?.[0]?.matcher === "startup|resume|clear", "SessionStart excludes compact");
  assert(hooksConfig.hooks?.PostCompact?.[0]?.matcher === "manual|auto", "PostCompact handles compaction");
  assert(Boolean(hooksConfig.hooks?.SessionEnd?.[0]), "SessionEnd is wired");
  assert(Boolean(hooksConfig.hooks?.UserPromptSubmit?.[0]), "UserPromptSubmit remains wired");
  assert(!Object.hasOwn(hooksConfig.hooks || {}, "PreToolUse"), "core PreToolUse is not wired");
}

console.log("SessionStart lifecycle:");
{
  const root = workspace();
  const startup = runHook(sessionStartHook, {
    cwd: root,
    workspace_roots: [root],
    source: "startup",
    session_id: "session-startup-001",
    transcript_path: "/tmp/transcript-startup-001.jsonl"
  });
  const startupContext = additionalContext(startup);
  assert(startup.status === 0, "startup exits cleanly");
  assert(startupContext.includes("NOGRA_SESSION_BOOT"), "startup emits boot context");
  assert(startupContext.includes("workspaceRoot="), "startup includes workspace root");
  assert(!startupContext.includes("NOGRA_ROUTING_POLICY"), "startup does not emit old routing policy block");

  const resume = runHook(sessionStartHook, {
    cwd: root,
    workspace_roots: [root],
    source: "resume",
    session_id: "session-resume-001",
    transcript_path: "/tmp/transcript-resume-001.jsonl"
  });
  const resumeContext = additionalContext(resume);
  assert(resume.status === 0, "resume exits cleanly");
  assert(resumeContext.includes("NOGRA_SESSION_RESUME"), "resume emits a continuity pointer");
  assert(!resumeContext.includes("NOGRA_ROUTING_POLICY"), "resume does not emit full routing policy");
}

console.log("PostCompact lifecycle:");
{
  const root = workspace();
  const compact = runHook(postCompactHook, {
    cwd: root,
    workspace_roots: [root],
    source: "auto",
    session_id: "session-compact-001",
    transcript_path: "/tmp/transcript-compact-001.jsonl"
  });
  const compactContext = additionalContext(compact);
  assert(compact.status === 0, "PostCompact exits cleanly");
  assert(parseHookOutput(compact).hookSpecificOutput?.hookEventName === "PostCompact", "PostCompact reports its hook event");
  assert(compactContext.includes("NOGRA_COMPACT_POINTER"), "PostCompact emits compact pointer");
  assert(compactContext.includes("ledgerWatermark="), "PostCompact includes ledger watermark");
  assert(!compactContext.includes("NOGRA_ROUTING_POLICY"), "PostCompact does not emit full routing policy");
}

console.log("SessionEnd lifecycle:");
{
  const root = workspace();
  const ended = runHook(sessionEndHook, {
    cwd: root,
    workspace_roots: [root],
    source: "prompt_input_exit",
    session_id: "session-end-001",
    transcript_path: "/tmp/transcript-end-001.jsonl"
  });
  assert(ended.status === 0, "SessionEnd exits cleanly");
  assert(!ended.stdout, "SessionEnd emits no chat context");
  const anchor = JSON.parse(fs.readFileSync(path.join(root, ".nogra", "runtime", "session-anchor.json"), "utf8"));
  assert(anchor.hookEventName === "SessionEnd", "SessionEnd writes only session anchor state");
  assert(anchor.sessionId === "session-end-001", "SessionEnd preserves session id");
}

console.log("UserPromptSubmit lifecycle:");
{
  const root = workspace();
  const result = runHook(userPromptSubmitHook, {
    cwd: root,
    workspace_roots: [root],
    session_id: "session-submit-001",
    transcript_path: "/tmp/transcript-submit-001.jsonl",
    prompt: "Build and verify a multi-file dashboard with tests and screenshots."
  });
  const context = additionalContext(result);
  assert(result.status === 0, "normal scoped prompt exits cleanly");
  assert(!context, "normal scoped prompt emits no proactive Nogra context");
  assert(!fs.existsSync(path.join(root, ".nogra", "runtime", "last-routing-score.json")), "normal scoped prompt writes no routing score");

  const routerReference = fs.readFileSync(path.join(pluginRoot, "skills", "help", "references", "router.md"), "utf8");
  const initClaude = fs.readFileSync(path.join(pluginRoot, "contracts", "init-bundle", "files", "CLAUDE.md"), "utf8");
  const readme = fs.readFileSync(path.join(pluginRoot, "README.md"), "utf8");
  assert(routerReference.includes("If no route matches, stay direct."), "router reference defaults unmatched prompts to direct");
  assert(routerReference.includes("Never turn it into prompt scoring"), "router reference forbids prompt scoring");
  assert(initClaude.includes("## Nogra Intent Router"), "init bundle includes intent router");
  assert(readme.includes("### Build directly"), "README documents direct scoped work as default");
  assert(!readme.includes("Nogra treats this as scoped work, shapes a brief first"), "README no longer promises automatic brief shaping");
}

if (failures > 0) {
  console.error(`\n${failures} routing lifecycle checks failed.`);
  process.exit(1);
}

console.log("\nRouting lifecycle checks passed.");
