#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  const prompt = normalizeCommandText(input.prompt);
  const commandName = normalizeCommandText(input.command_name).replace(/^\//u, "");
  const commandArgs = normalizeCommandText(input.command_args);
  const commandText = [commandName, commandArgs].filter(Boolean).join(" ");

  if (/^\/nogra[:\s-]?off$/u.test(prompt) || /^(?:nogra[:\s-]?off|off)$/u.test(commandName) && !commandArgs) {
    return "off";
  }
  if (/^\/nogra[:\s-]?on$/u.test(prompt) || /^(?:nogra[:\s-]?on|on)$/u.test(commandName) && !commandArgs) {
    return "on";
  }
  if (commandName === "nogra" && commandArgs === "off") {
    return "off";
  }
  if (commandName === "nogra" && commandArgs === "on") {
    return "on";
  }
  if (/^(nogra off|disable nogra|turn off nogra)$/u.test(prompt) || dictionaryHasExact(dictionary, "toggleOff", prompt)) {
    return "off";
  }
  if (/^(nogra on|enable nogra|turn on nogra|use nogra(?: here| for this)?)$/u.test(prompt) || dictionaryHasExact(dictionary, "toggleOn", prompt)) {
    return "on";
  }
  if (/^(nogra off|disable nogra|turn off nogra)$/u.test(commandText) || dictionaryHasExact(dictionary, "toggleOff", commandText)) {
    return "off";
  }
  if (/^(nogra on|enable nogra|turn on nogra|use nogra(?: here| for this)?)$/u.test(commandText) || dictionaryHasExact(dictionary, "toggleOn", commandText)) {
    return "on";
  }

  return "";
}

function applyToggle(configInfo, enabled) {
  const nextConfig = configInfo.config && typeof configInfo.config === "object" ? configInfo.config : {};
  const routingPolicy =
    nextConfig.routingPolicy && typeof nextConfig.routingPolicy === "object"
      ? nextConfig.routingPolicy
      : {};

  nextConfig.routingPolicy = {
    ...routingPolicy,
    autoOfferEnabled: enabled
  };

  writeFileSync(configInfo.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}

function emitBlock(reason) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason
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

if (!configInfo) {
  emitBlock("Nogra is not initialized in this folder.");
  process.exit(0);
}

const enabled = toggle === "on";
applyToggle(configInfo, enabled);
emitBlock(
  enabled
    ? "Nogra automatic offers are on."
    : "Nogra automatic offers are off. Explicit /nogra:* commands still work."
);
