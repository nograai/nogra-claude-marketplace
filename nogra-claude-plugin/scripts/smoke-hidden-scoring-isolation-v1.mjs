#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTranscriptDiagnosticSemantics } from "../runtime/local/contract-spine.mjs";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");
const sessionEndHook = path.join(pluginRoot, "hooks", "session-end.mjs");
const statuslineScript = path.join(pluginRoot, "scripts", "statusline.mjs");
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`hidden-scoring-isolation-v1: ${message}`);
  checks += 1;
}

function runLocal(args) {
  const output = execFileSync(process.execPath, [localRuntime, ...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function runSessionEnd(root, input) {
  return execFileSync(process.execPath, [sessionEndHook], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_ROOT: root
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function runStatusline(root) {
  return execFileSync(process.execPath, [statuslineScript], {
    cwd: root,
    input: JSON.stringify({
      cwd: root,
      workspace: {
        current_dir: root,
        project_dir: root,
        added_dirs: []
      },
      context_window: {
        used_percentage: 9
      }
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_ROOT: root
    },
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
}

function writeTranscript(file, records) {
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-hidden-scoring-"));
const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-hidden-scoring-escape-"));

try {
  runLocal(["init", "--apply", "--root", temp, "--workspace-name", "Hidden Scoring Smoke"]);

  const transcript = path.join(temp, "adversarial-transcript.jsonl");
  writeTranscript(transcript, [
    {
      type: "user",
      message: {
        role: "user",
        content: "STOP. Ingen agents uden GO."
      }
    },
    {
      type: "user",
      message: {
        role: "user",
        content: "GO, continue."
      }
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu-hidden-scoring-agent",
            name: "Agent",
            input: {
              description: "Inspect a bounded fixture"
            }
          }
        ]
      }
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: "Affiliate revenue is the biggest MRR lever at 79 kr/md."
      }
    }
  ]);

  const hookOutput = runSessionEnd(temp, {
    cwd: temp,
    workspace_roots: [temp],
    hook_event_name: "SessionEnd",
    reason: "prompt_input_exit",
    session_id: "session-hidden-scoring-001",
    transcript_path: transcript
  });
  assert(hookOutput === "", "SessionEnd must stay silent");
  assert(fs.existsSync(path.join(temp, ".nogra", "runtime", "session-anchor.json")), "SessionEnd must keep the session anchor");
  assert(fs.existsSync(path.join(temp, ".nogra", "runtime", "live-hooks.jsonl")), "SessionEnd must keep bounded event observability");
  assert(!fs.existsSync(path.join(temp, ".nogra", "runtime", "session-quality.latest.json")), "SessionEnd must not write a legacy quality receipt");
  assert(!fs.existsSync(path.join(temp, ".nogra", "runtime", "transcript-diagnostic.latest.json")), "SessionEnd must not write a transcript diagnostic");

  const sessionEndSource = fs.readFileSync(sessionEndHook, "utf8");
  const hookConfig = fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8");
  assert(!/session-quality|transcript-diagnostic/u.test(sessionEndSource), "SessionEnd source must not import or invoke transcript analysis");
  assert(!/transcript-diagnostic/u.test(hookConfig), "default hook graph must not contain the explicit diagnostic");

  const historicalQuality = path.join(temp, ".nogra", "runtime", "session-quality.latest.json");
  fs.writeFileSync(historicalQuality, `${JSON.stringify({
    schema: "nogra.sessionQualityReceipt.v1",
    status: "intervention",
    score: 0,
    patternCount: 99
  })}\n`, "utf8");
  const defaultStatus = runLocal(["status", "--root", temp]);
  assert(!Object.hasOwn(defaultStatus.continuity || {}, "sessionQuality"), "default status must ignore historical quality receipts");
  assert(!Object.hasOwn(defaultStatus.continuity || {}, "transcriptDiagnostic"), "default status must not project explicit diagnostics");
  const defaultStatusline = runStatusline(temp);
  assert(!defaultStatusline.includes("quality:"), "statusline must not show stale quality judgment");
  assert(!defaultStatusline.includes("diagnostic:"), "statusline must not show explicit transcript diagnostics");

  const preview = runLocal(["transcript-diagnostic", "--root", temp, "--transcript", transcript]);
  assert(preview.schema === "nogra.transcript.diagnostic.v1", "explicit command must return the canonical diagnostic schema");
  assert(preview.mode === "explicit-diagnostic" && preview.authority === "none", "diagnostic must declare explicit mode and no authority");
  assert(preview.advisoryOnly === true && preview.blocking === false, "diagnostic must remain advisory and non-blocking");
  assert(preview.persistence === "preview" && preview.path === "", "default diagnostic must be a non-persistent preview");
  assert(!fs.existsSync(path.join(temp, ".nogra", "runtime", "transcript-diagnostic.latest.json")), "preview must not write a latest receipt");
  assert(preview.controlEffects?.go === "not-inferred", "GO must never be inferred from transcript language");
  assert(Object.values(preview.controlEffects || {}).every((value) => !["allow", "ask", "deny", "ship"].includes(value)), "diagnostic must carry no control decision");
  assert(!Object.hasOwn(preview, "score") && !Object.hasOwn(preview, "maxSeverity"), "diagnostic must have no numeric score or severity ladder");
  const previewText = JSON.stringify(preview);
  assert(!/recommendedAction|humanGatePatterns|ask-human|intervention|hard-stop/u.test(previewText), "diagnostic must not emit permission-like remedies");
  assert(preview.signals.some((signal) => signal.id === "stop_language_precedes_tool_use"), "explicit diagnostic may report lexical stop/tool co-occurrence");
  assert(preview.signals.some((signal) => signal.id === "agent_tool_use_observed"), "explicit diagnostic may report observed Agent tool use");
  assert(preview.signals.some((signal) => signal.id === "business_metric_language_without_source_cue"), "explicit diagnostic may report source-cue absence");
  assert(preview.signals.every((signal) => signal.limitations.length > 0), "every signal must carry limitations");

  const anchoredPreview = runLocal(["transcript-diagnostic", "--root", temp]);
  assert(anchoredPreview.transcript.source === "session-anchor", "explicit command may use the current session anchor when no path is supplied");
  assert(anchoredPreview.persistence === "preview", "anchor-selected diagnostic must still be preview-only");

  const diagnosticsParent = path.join(temp, ".nogra", "runtime", "diagnostics");
  fs.symlinkSync(escapeTarget, diagnosticsParent);
  const escapedSave = spawnSync(process.execPath, [
    localRuntime,
    "transcript-diagnostic",
    "--root",
    temp,
    "--transcript",
    transcript,
    "--write",
    "--json"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert(escapedSave.status !== 0, "explicit save must reject a diagnostics parent symlink that escapes the workspace");
  assert(fs.readdirSync(escapeTarget).length === 0, "rejected symlink escape must not write outside the workspace");
  fs.unlinkSync(diagnosticsParent);

  const saved = runLocal(["transcript-diagnostic", "--root", temp, "--transcript", transcript, "--write"]);
  const savedPath = path.join(temp, saved.path);
  assert(saved.persistence === "saved" && fs.existsSync(savedPath), "only explicit --write must persist a compact diagnostic");
  const latestPath = path.join(temp, ".nogra", "runtime", "transcript-diagnostic.latest.json");
  assert(fs.existsSync(latestPath), "explicit save must write its isolated latest projection");
  const beforeHookDigest = digest(latestPath);
  runSessionEnd(temp, {
    cwd: temp,
    workspace_roots: [temp],
    hook_event_name: "SessionEnd",
    reason: "other",
    session_id: "session-hidden-scoring-002",
    transcript_path: transcript
  });
  assert(digest(latestPath) === beforeHookDigest, "later SessionEnd must not refresh or mutate an explicit diagnostic");

  assertTranscriptDiagnosticSemantics(preview);
  let rejectedBlocking = false;
  try {
    assertTranscriptDiagnosticSemantics({ ...preview, blocking: true });
  } catch {
    rejectedBlocking = true;
  }
  assert(rejectedBlocking, "contract must reject a blocking diagnostic");
  let rejectedGo = false;
  try {
    assertTranscriptDiagnosticSemantics({
      ...preview,
      controlEffects: {
        ...preview.controlEffects,
        go: "inferred"
      }
    });
  } catch {
    rejectedGo = true;
  }
  assert(rejectedGo, "contract must reject inferred GO");

  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "transcript-diagnostic", "SKILL.md"), "utf8");
  assert(skill.includes("disable-model-invocation: true"), "diagnostic skill must be user-only");
  const legacyCommand = spawnSync(process.execPath, [localRuntime, "quality", "--root", temp, "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert(legacyCommand.status !== 0, "legacy ambient quality command must be removed");

  console.log(`hidden-scoring-isolation-v1 smoke passed: ${checks} checks`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(escapeTarget, { recursive: true, force: true });
}
