#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DICTIONARY = {
  providerTarget: ["codex"],
  consultVerb: [
    "ask",
    "consult",
    "query",
    "hear",
    "request",
    "send",
    "spørg",
    "spørge",
    "spoerg",
    "spoerge",
    "få",
    "faa",
    "bed",
    "bede",
    "get",
    "have",
    "make",
    "hør",
    "høre",
    "hoer",
    "hoere"
  ],
  consultQuestionCue: [
    "what",
    "why",
    "how",
    "could",
    "should",
    "recommend",
    "think",
    "hvad",
    "hvorfor",
    "hvordan",
    "kan du",
    "bør",
    "boer",
    "tænker",
    "taenker"
  ],
  consultNegative: [
    "do not ask",
    "don't ask",
    "dont ask",
    "do not consult",
    "don't consult",
    "dont consult",
    "no codex",
    "not codex",
    "uden codex",
    "ingen codex",
    "ikke spørge",
    "ikke spoerge",
    "spørg ikke",
    "spoerg ikke"
  ]
};

function readInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getPrompt(input) {
  return String(input.prompt ?? input.user_prompt ?? input.message ?? "").trim();
}

function readWorkspaceDictionary() {
  return DEFAULT_DICTIONARY;
}

function hasNograWorkspace(input) {
  const cwd = input.cwd || input.project_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return fs.existsSync(path.join(cwd, ".nogra", "config.json"));
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function isGeneratedWrapperPrompt(prompt) {
  const trimmed = prompt.trimStart();
  return /^<task-notification\b/iu.test(trimmed)
    || /^<command-message\b/iu.test(trimmed)
    || /^<tool-(?:result|use)\b/iu.test(trimmed);
}

function isCodexConsult(prompt, input = {}) {
  const text = prompt.toLowerCase();
  const dictionary = readWorkspaceDictionary(input);
  if (!includesAny(text, dictionary.providerTarget)) {
    return false;
  }
  if (includesAny(text, dictionary.consultNegative)) {
    return false;
  }
  if (/^\s*\/?nogra-codex\b/.test(text)) {
    return true;
  }
  if (/^\s*@?codex\s*[,:\-]/.test(text)) {
    return true;
  }
  const codexIndex = text.indexOf("codex");
  const beforeCodex = text.slice(Math.max(0, codexIndex - 100), codexIndex);
  const afterCodex = text.slice(codexIndex, codexIndex + 120);
  return includesAny(beforeCodex, dictionary.consultVerb)
    || includesAny(afterCodex, dictionary.consultQuestionCue);
}

const input = readInput();
const prompt = getPrompt(input);

if (isGeneratedWrapperPrompt(prompt)) {
  process.exit(0);
}

if (!hasNograWorkspace(input)) {
  process.exit(0);
}

if (!isCodexConsult(prompt, input)) {
  process.exit(0);
}

process.stdout.write(`NOGRA_CODEX_PROVIDER_AVAILABLE
The optional nogra-codex provider plugin is installed. The user appears to be asking for Codex consult-on-demand.

Routing rules:
1. Treat this as a Codex consult, not a Nogra brief offer.
2. Use /nogra-codex:consult for the user's exact question when possible.
3. Keep Codex output clearly labeled as Codex.
4. Do not apply Codex advice or mutate files unless the user separately approves that follow-up.
5. If Codex setup is missing, run /nogra-codex:setup or explain the missing local Codex CLI/auth.
`);
