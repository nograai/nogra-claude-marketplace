#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readActiveIntent, renderActiveIntentContext } from "../runtime/local/active-intent.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";
import { resolveProjectFocus } from "../runtime/local/project-focus.mjs";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

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

function firstWorkspaceRoot(input) {
  if (!Array.isArray(input.workspace_roots)) return "";
  return input.workspace_roots.find((entry) => typeof entry === "string" && entry.trim() !== "") || "";
}

function hasNograConfig(root) {
  return Boolean(root) && existsSync(join(resolve(root), ".nogra", "config.json"));
}

function nearestNograRoot(start) {
  if (!start) return "";
  let current = resolve(start);
  while (true) {
    if (hasNograConfig(current)) return current;
    const next = resolve(current, "..");
    if (next === current) return "";
    current = next;
  }
}

function projectRoot(input) {
  const explicitRoot = process.env.CLAUDE_PROJECT_ROOT || process.env.CURSOR_PROJECT_DIR || "";
  if (explicitRoot) return resolve(explicitRoot);

  const workspaceRoot = firstWorkspaceRoot(input);
  if (hasNograConfig(workspaceRoot)) return resolve(workspaceRoot);

  const cwdRoot = nearestNograRoot(nonEmptyString(input.cwd));
  if (cwdRoot) return cwdRoot;

  return resolve(
    workspaceRoot ||
      nonEmptyString(input.cwd) ||
      process.cwd()
  );
}

function promptText(input) {
  return nonEmptyString(input.prompt) || nonEmptyString(input.message);
}

function userAuthoredText(prompt) {
  return String(prompt || "")
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

function isNograExtensionCommand(prompt) {
  return /^\s*\/nogra-[a-z0-9-]+(?::|\s|$)/iu.test(prompt);
}

function isGeneratedWrapperPrompt(prompt) {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith("<command-message>")) return false;
  return !/(^|\n)\s*(?:\/nogra(?:[:\s-]|$)|handle this nogra request:\s*(?:on|off)\b)/iu.test(prompt);
}

function emitContext(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context
      }
    })
  );
}

const input = parseInput(readStdin());
const root = projectRoot(input);

if (!hasNograConfig(root)) {
  process.exit(0);
}

captureSessionAnchor(root, input, "UserPromptSubmit");

const prompt = promptText(input);
if (!prompt || isGeneratedWrapperPrompt(prompt)) {
  captureLiveHookEvent(root, input, { eventName: "UserPromptSubmit", decision: "silent" });
  process.exit(0);
}

const userPrompt = userAuthoredText(prompt);
if (!userPrompt || /^\s*\/nogra[:\s]/u.test(userPrompt) || isNograExtensionCommand(userPrompt)) {
  captureLiveHookEvent(root, input, { eventName: "UserPromptSubmit", decision: "silent" });
  process.exit(0);
}

const focus = resolveProjectFocus({ cwd: root, prompt: userPrompt });
const activeIntent = readActiveIntent(root);
const contexts = [];
const reasons = [];
if (focus.additionalContext) {
  contexts.push(focus.additionalContext);
  reasons.push("project-focus");
}
if (activeIntent.active) {
  contexts.push(renderActiveIntentContext(activeIntent.intent));
  reasons.push("active-intent");
}

captureLiveHookEvent(root, input, {
  eventName: "UserPromptSubmit",
  decision: contexts.length ? "context" : "silent",
  reason: reasons.join("+")
});
if (contexts.length) {
  emitContext(contexts.join("\n\n"));
}
