#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_TIMEOUT_MS = Number(process.env.NOGRA_CODEX_TIMEOUT_MS || 10 * 60 * 1000);
const DEFAULT_MAX_OUTPUT_CHARS = 6000;
const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function usage() {
  console.log([
    "Usage:",
    "  node scripts/nogra-codex.mjs setup [--json]",
    "  node scripts/nogra-codex.mjs consult [--cwd <dir>] [--model <model>] [--effort <low|medium|high|xhigh>] [--max-output <chars>] [question]",
    "  node scripts/nogra-codex.mjs status [--json]",
    "  node scripts/nogra-codex.mjs result [run-id|latest] [--json]"
  ].join("\n"));
}

function readStdinIfPiped() {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "json") {
      options.json = true;
      continue;
    }
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    options[name] = next;
    index += 1;
  }
  return { options, positionals };
}

function splitSingleRawArg(argv) {
  if (argv.length !== 1) {
    return argv;
  }
  const raw = argv[0] || "";
  if (!raw.trim()) {
    return [];
  }
  const out = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    out.push(current);
  }
  return out;
}

function codexBinary() {
  return process.env.CODEX_BIN || "codex";
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    text: true,
    encoding: "utf8",
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024
  });
}

function commandAvailable(command, cwd = process.cwd()) {
  const proc = run(command, ["--version"], { cwd, timeoutMs: 15000 });
  return {
    available: proc.status === 0,
    status: proc.status,
    stdout: String(proc.stdout || "").trim(),
    stderr: String(proc.stderr || "").trim(),
    error: proc.error?.message || null
  };
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function safeRunId() {
  return `codex-consult-${nowStamp()}-${Math.random().toString(16).slice(2, 10)}`;
}

function resolveCwd(options) {
  return path.resolve(options.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function runsRoot(cwd) {
  return path.join(cwd, ".nogra", "providers", "codex", "runs");
}

function nograConfigFile(cwd) {
  return path.join(cwd, ".nogra", "config.json");
}

function ensureNograWorkspace(cwd, schema, options = {}) {
  if (fs.existsSync(nograConfigFile(cwd))) {
    return true;
  }
  const payload = {
    schema,
    status: "not_initialized",
    provider: "codex",
    cwd,
    error: "Nogra is not initialized in this folder. Run /nogra:init first."
  };
  process.stdout.write(
    options.json
      ? `${JSON.stringify(payload, null, 2)}\n`
      : "Nogra is not initialized in this folder. Run /nogra:init first, then rerun the Nogra Codex command.\n"
  );
  process.exitCode = 78;
  return false;
}

function ensureRunDir(cwd, runId) {
  const dir = path.join(runsRoot(cwd), runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rel(cwd, filePath) {
  return path.relative(cwd, filePath) || ".";
}

function loadPromptTemplate() {
  const templatePath = path.join(ROOT_DIR, "prompts", "consult.md");
  return fs.readFileSync(templatePath, "utf8");
}

function buildConsultPrompt(question, cwd) {
  return loadPromptTemplate()
    .replaceAll("{{QUESTION}}", question.trim())
    .replaceAll("{{CWD}}", cwd);
}

function readReceipt(receiptFile) {
  return JSON.parse(fs.readFileSync(receiptFile, "utf8"));
}

function listReceipts(cwd) {
  const root = runsRoot(cwd);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "receipt.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      try {
        return readReceipt(file);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n\n[Output truncated in chat. Full raw output is stored in the run artifact.]`,
    truncated: true
  };
}

function renderSetup(payload) {
  const lines = ["Nogra Codex setup", ""];
  lines.push(`Codex CLI: ${payload.codex.available ? "available" : "missing"}`);
  if (payload.codex.stdout) {
    lines.push(`Version: ${payload.codex.stdout}`);
  }
  if (payload.codex.stderr) {
    lines.push(`Note: ${payload.codex.stderr}`);
  }
  lines.push(`Runs path: ${payload.runsPath}`);
  lines.push("");
  if (payload.ready) {
    lines.push("Ready: yes");
    lines.push("Use /nogra-codex:consult <question> to ask Codex.");
  } else {
    lines.push("Ready: no");
    lines.push("Install/authenticate Codex locally, then rerun /nogra-codex:setup.");
  }
  return `${lines.join("\n")}\n`;
}

function handleSetup(argv) {
  const { options } = parseArgs(splitSingleRawArg(argv));
  const cwd = resolveCwd(options);
  if (!ensureNograWorkspace(cwd, "nogra.codex_setup.v0", options)) {
    return;
  }
  const codex = commandAvailable(codexBinary(), cwd);
  const payload = {
    schema: "nogra.codex_setup.v0",
    ready: codex.available,
    cwd,
    codex,
    runsPath: rel(cwd, runsRoot(cwd))
  };
  process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : renderSetup(payload));
}

function renderConsult(receipt, output) {
  const lines = ["Codex", "", output.trim() || "(Codex returned no final output.)", ""];
  lines.push("---");
  lines.push(`Nogra Codex run: ${receipt.runId}`);
  lines.push(`Raw output: ${receipt.rawOutputRef}`);
  if (receipt.truncated) {
    lines.push("Chat output: truncated; see raw output artifact.");
  }
  return `${lines.join("\n")}\n`;
}

function handleConsult(argv) {
  const { options, positionals } = parseArgs(splitSingleRawArg(argv));
  const cwd = resolveCwd(options);
  if (!ensureNograWorkspace(cwd, "nogra.codex_consult.v0", options)) {
    return;
  }
  const question = (positionals.join(" ") || readStdinIfPiped()).trim();
  if (!question) {
    throw new Error("Provide a question for Codex.");
  }

  const maxOutputChars = Math.max(1000, Number(options["max-output"] || DEFAULT_MAX_OUTPUT_CHARS));
  const effort = options.effort ? String(options.effort).trim().toLowerCase() : "";
  if (effort && !VALID_EFFORTS.has(effort)) {
    throw new Error(`Unsupported effort "${options.effort}". Use low, medium, high, or xhigh.`);
  }

  const codex = commandAvailable(codexBinary(), cwd);
  if (!codex.available) {
    const payload = {
      schema: "nogra.codex_consult.v0",
      status: "unavailable",
      provider: "codex",
      cwd,
      error: codex.error || codex.stderr || "Codex CLI is not available"
    };
    process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : `Codex is not available. Run /nogra-codex:setup.\n${payload.error}\n`);
    process.exitCode = 69;
    return;
  }

  const runId = safeRunId();
  const runDir = ensureRunDir(cwd, runId);
  const prompt = buildConsultPrompt(question, cwd);
  const promptFile = path.join(runDir, "prompt.md");
  const rawOutputFile = path.join(runDir, "raw-output.md");
  const stdoutFile = path.join(runDir, "stdout.log");
  const stderrFile = path.join(runDir, "stderr.log");
  const receiptFile = path.join(runDir, "receipt.json");

  fs.writeFileSync(promptFile, prompt, "utf8");

  const args = [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-C",
    cwd,
    "-o",
    rawOutputFile
  ];
  if (options.model) {
    args.push("-m", String(options.model));
  }
  if (effort) {
    args.push("-c", `model_reasoning_effort="${effort}"`);
  }
  args.push(prompt);

  const startedAt = new Date().toISOString();
  const proc = run(codexBinary(), args, { cwd, timeoutMs: DEFAULT_TIMEOUT_MS });
  const completedAt = new Date().toISOString();
  fs.writeFileSync(stdoutFile, String(proc.stdout || ""), "utf8");
  fs.writeFileSync(stderrFile, String(proc.stderr || proc.error?.message || ""), "utf8");

  let status = proc.status === 0 ? "ok" : "failed";
  if (proc.error?.code === "ETIMEDOUT") {
    status = "timeout";
  }
  if (!fs.existsSync(rawOutputFile)) {
    fs.writeFileSync(rawOutputFile, "", "utf8");
  }
  const rawOutput = fs.readFileSync(rawOutputFile, "utf8").trim();
  const rendered = truncate(rawOutput, maxOutputChars);
  const receipt = {
    schema: "nogra.codex_consult.v0",
    runId,
    provider: "codex",
    mode: "consult",
    status,
    createdAt: startedAt,
    completedAt,
    cwd,
    question,
    model: options.model || null,
    effort: effort || null,
    promptRef: rel(cwd, promptFile),
    rawOutputRef: rel(cwd, rawOutputFile),
    stdoutRef: rel(cwd, stdoutFile),
    stderrRef: rel(cwd, stderrFile),
    receiptRef: rel(cwd, receiptFile),
    exitCode: proc.status,
    signal: proc.signal || null,
    truncated: rendered.truncated
  };
  fs.writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  if (status !== "ok") {
    process.exitCode = proc.status || 1;
  }
  process.stdout.write(options.json ? `${JSON.stringify({ ...receipt, answer: rawOutput }, null, 2)}\n` : renderConsult(receipt, rendered.text));
}

function renderStatus(receipts) {
  if (!receipts.length) {
    return "No Nogra Codex consult runs found.\n";
  }
  const lines = ["Nogra Codex recent runs", ""];
  for (const receipt of receipts.slice(0, 10)) {
    lines.push(`${receipt.runId}  ${receipt.status}  ${receipt.createdAt}`);
    lines.push(`  ${receipt.question ? receipt.question.slice(0, 120) : "(no question)"}`);
    lines.push(`  raw: ${receipt.rawOutputRef}`);
  }
  return `${lines.join("\n")}\n`;
}

function handleStatus(argv) {
  const { options } = parseArgs(splitSingleRawArg(argv));
  const cwd = resolveCwd(options);
  if (!ensureNograWorkspace(cwd, "nogra.codex_status.v0", options)) {
    return;
  }
  const receipts = listReceipts(cwd);
  process.stdout.write(options.json ? `${JSON.stringify({ schema: "nogra.codex_status.v0", cwd, runs: receipts }, null, 2)}\n` : renderStatus(receipts));
}

function handleResult(argv) {
  const { options, positionals } = parseArgs(splitSingleRawArg(argv));
  const cwd = resolveCwd(options);
  if (!ensureNograWorkspace(cwd, "nogra.codex_result.v0", options)) {
    return;
  }
  const reference = positionals[0] || "latest";
  const receipts = listReceipts(cwd);
  const receipt = reference === "latest"
    ? receipts[0]
    : receipts.find((candidate) => candidate.runId === reference || candidate.runId.endsWith(reference));
  if (!receipt) {
    throw new Error(`No Nogra Codex run found for "${reference}".`);
  }
  const rawPath = path.resolve(cwd, receipt.rawOutputRef);
  const rawOutput = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8").trim() : "";
  process.stdout.write(options.json ? `${JSON.stringify({ ...receipt, answer: rawOutput }, null, 2)}\n` : renderConsult(receipt, rawOutput));
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  switch (command) {
    case "setup":
      handleSetup(argv);
      break;
    case "consult":
      handleConsult(argv);
      break;
    case "status":
      handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
