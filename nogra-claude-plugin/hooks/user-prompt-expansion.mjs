#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT_DICTIONARY = {
  toggleOn: [],
  toggleOff: []
};

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value : "";
}

function projectRoot(input) {
  const workspaceRoot = Array.isArray(input.workspace_roots)
    ? input.workspace_roots.find((entry) => typeof entry === "string" && entry.trim() !== "")
    : "";
  return resolve(
    process.env.CLAUDE_PROJECT_ROOT ||
      process.env.CURSOR_PROJECT_DIR ||
      nonEmptyString(input.cwd) ||
      workspaceRoot ||
      process.cwd()
  );
}

function readConfig(root) {
  const configPath = join(root, ".nogra", "config.json");
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return { config, configPath };
  } catch {
    return { config: {}, configPath };
  }
}

function normalizeCommandText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function userAuthoredText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/gu, "\n")
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trimStart();
      if (!trimmed) return true;
      return !/^(?:>|["'“”]|⏺|❯|│|┃|\[Image #|\[Pasted Content\b|Ran\b|Read\b|Searched\b|Listed\b)/u.test(trimmed);
    })
    .join("\n")
    .trim();
}

function dictionaryPolicy(policy) {
  const candidate = policy.dictionary && typeof policy.dictionary === "object" ? policy.dictionary : {};
  const out = {};
  for (const [key, values] of Object.entries(DEFAULT_DICTIONARY)) {
    const configured = Array.isArray(candidate[key]) ? candidate[key] : [];
    out[key] = [...values, ...configured]
      .map((value) => normalizeCommandText(value))
      .filter(Boolean);
  }
  return out;
}

function dictionaryHasExact(dictionary, key, text) {
  const normalized = normalizeCommandText(text);
  const terms = Array.isArray(dictionary[key]) ? dictionary[key] : [];
  return terms.some((term) => normalizeCommandText(term) === normalized);
}

function detectToggle(input, dictionary = DEFAULT_DICTIONARY) {
  const prompt = normalizeCommandText(userAuthoredText(input.prompt));
  const commandName = normalizeCommandText(input.command_name).replace(/^\//u, "");
  const commandArgs = normalizeCommandText(input.command_args);
  const commandText = [commandName, commandArgs].filter(Boolean).join(" ");

  if (/^\/nogra[:\s-]?off$/u.test(prompt) || (/^(?:nogra[:\s-]?off|off)$/u.test(commandName) && !commandArgs)) {
    return "off";
  }
  if (/^\/nogra[:\s-]?on$/u.test(prompt) || (/^(?:nogra[:\s-]?on|on)$/u.test(commandName) && !commandArgs)) {
    return "on";
  }
  if (commandName === "nogra" && commandArgs === "off") {
    return "off";
  }
  if (commandName === "nogra" && commandArgs === "on") {
    return "on";
  }
  if (
    /^(?:nogra off|disable nogra|turn off nogra|turn nogra off|switch nogra off|set nogra off)$/u.test(prompt) ||
    dictionaryHasExact(dictionary, "toggleOff", prompt)
  ) {
    return "off";
  }
  if (
    /^(?:nogra on|enable nogra|turn on nogra|turn nogra on|switch nogra on|set nogra on)$/u.test(prompt) ||
    dictionaryHasExact(dictionary, "toggleOn", prompt)
  ) {
    return "on";
  }
  if (
    /^(?:nogra off|disable nogra|turn off nogra|turn nogra off|switch nogra off|set nogra off)$/u.test(commandText) ||
    dictionaryHasExact(dictionary, "toggleOff", commandText)
  ) {
    return "off";
  }
  if (
    /^(?:nogra on|enable nogra|turn on nogra|turn nogra on|switch nogra on|set nogra on)$/u.test(commandText) ||
    dictionaryHasExact(dictionary, "toggleOn", commandText)
  ) {
    return "on";
  }

  return "";
}

function emitContext(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptExpansion",
        additionalContext: context
      }
    })
  );
}

const input = parseInput(readStdin());
const root = projectRoot(input);
const configInfo = readConfig(root);
const policy = configInfo?.config?.routingPolicy || {};
const dictionary = dictionaryPolicy(policy);
const toggle = detectToggle(input, dictionary);

if (!toggle) {
  process.exit(0);
}

emitContext(`<!-- nogra-plugin:routing-toggle intent=${toggle} initialized=${configInfo ? "true" : "false"} -->
<NOGRA_ROUTING_TOGGLE_REQUEST>
The user asked to turn Nogra automatic offers ${toggle} for this workspace.

Hooks are soft guardrails only. Do not treat this hook as the actor, and do not say the hook already changed config.

Use the nogra:${toggle} skill now. The skill owns reading and updating local .nogra/config.json, then reporting the result visibly to the user.

If the workspace is not initialized, tell the user visibly and do not write config.
</NOGRA_ROUTING_TOGGLE_REQUEST>`);
