#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function pluginInstallInfo() {
  const root = resolve(process.env.CLAUDE_PLUGIN_ROOT || join(new URL(".", import.meta.url).pathname, ".."));
  const parts = root.split(/[\\/]+/u).filter(Boolean);
  const cacheIndex = parts.lastIndexOf("cache");
  let source = "source";
  let name = "nogra";
  let ref = "";

  if (cacheIndex >= 0 && parts.length > cacheIndex + 3) {
    source = parts[cacheIndex + 1] || source;
    name = parts[cacheIndex + 2] || name;
    ref = parts[cacheIndex + 3] || "";
  }

  const pluginJson = readConfigJson(join(root, ".claude-plugin", "plugin.json"));
  const declaredName = cleanLabel(pluginJson?.name, name);
  const declaredVersion = cleanLabel(pluginJson?.version, "");
  return {
    id: source === "source" ? declaredName : `${declaredName}@${source}`,
    ref: ref || declaredVersion || "source",
    root,
  };
}

function readConfigJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

const DEFAULT_SENSITIVITY_PERCENT = 50;
const DEFAULT_SENSITIVITY_STEP_PERCENT = 5;

function numericSetting(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedPercent(value, fallback = DEFAULT_SENSITIVITY_PERCENT, step = 1) {
  const number = numericSetting(value, fallback);
  const bounded = Math.max(0, Math.min(100, number));
  const safeStep = Math.max(1, Math.min(100, Math.round(numericSetting(step, 1))));
  return Math.max(0, Math.min(100, Math.round(bounded / safeStep) * safeStep));
}

function sensitivityStep(policy) {
  return Math.max(1, Math.min(100, Math.round(numericSetting(policy.sensitivityStepPercent, DEFAULT_SENSITIVITY_STEP_PERCENT))));
}

function thresholdsFromSensitivity(value, step = DEFAULT_SENSITIVITY_STEP_PERCENT) {
  const sensitivityPercent = boundedPercent(value, DEFAULT_SENSITIVITY_PERCENT, step);
  const autoOfferThreshold = Math.round(95 - sensitivityPercent * 0.7);
  return {
    sensitivityPercent,
    autoOfferThreshold,
    strongOfferThreshold: Math.min(100, autoOfferThreshold + 20)
  };
}

function sensitivityFromAutoThreshold(value, step = DEFAULT_SENSITIVITY_STEP_PERCENT) {
  return boundedPercent((95 - numericSetting(value, 60)) / 0.7, DEFAULT_SENSITIVITY_PERCENT, step);
}

function routingThresholds(policy) {
  const step = sensitivityStep(policy);
  if (Number.isFinite(policy.sensitivityPercent)) {
    return { ...thresholdsFromSensitivity(policy.sensitivityPercent, step), sensitivityStepPercent: step };
  }

  const autoOfferThreshold = numericSetting(policy.autoOfferThreshold, 60);
  const strongOfferThreshold = Math.max(
    autoOfferThreshold,
    numericSetting(policy.strongOfferThreshold, 80)
  );

  return {
    sensitivityPercent: sensitivityFromAutoThreshold(autoOfferThreshold, step),
    sensitivityStepPercent: step,
    autoOfferThreshold,
    strongOfferThreshold
  };
}

function cleanLabel(value, fallback = "") {
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\s+/g, " ") : fallback;
}

function runtimeSummary(config) {
  const runtime = config.runtimePolicy && typeof config.runtimePolicy === "object" ? config.runtimePolicy : {};
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const budget = runtime.budget && typeof runtime.budget === "object" ? runtime.budget : {};
  const roleLine = (name, fallbackModel, fallbackEffort) => {
    const role = roles[name] && typeof roles[name] === "object" ? roles[name] : {};
    const model = cleanLabel(role.model, fallbackModel);
    const effort = cleanLabel(role.effort, fallbackEffort);
    const context = cleanLabel(role.context, "");
    return `${name}=${model}/${effort}${context ? `/${context}` : ""}`;
  };

  return {
    profile: cleanLabel(runtime.profile, "balanced"),
    manager: roleLine("manager", "inherit", "auto"),
    agent: roleLine("agent", "sonnet", "high"),
    verifier: roleLine("verifier", "sonnet", "medium"),
    budgetMode: cleanLabel(budget.mode, "balanced"),
    maxUsdPerRun: typeof budget.maxUsdPerRun === "number" && Number.isFinite(budget.maxUsdPerRun) ? String(budget.maxUsdPerRun) : "none"
  };
}

function emitContext(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    })
  );
}

const input = parseInput(readStdin());
const root = projectRoot(input);
const config = readConfig(root);

if (!config) {
  const plugin = pluginInstallInfo();
  emitContext(`<!-- nogra-plugin:installed-status -->
<NOGRA_PLUGIN_STATUS>
Current installed Nogra plugin: ${plugin.id} ref=${plugin.ref}.
This folder is not Nogra-initialized yet because .nogra/config.json was not found.

When the user asks for Nogra status or version, include this plugin ref. If hosted MCP is available, also call registry for hosted MCP version/status and initBundleVersion. If the user asks what to do next, suggest /nogra:init.
</NOGRA_PLUGIN_STATUS>`);
  process.exit(0);
}

const policy = config.routingPolicy || {};
const autoOfferEnabled = policy.autoOfferEnabled !== false && policy.enabled !== false;
const { sensitivityPercent, sensitivityStepPercent, autoOfferThreshold, strongOfferThreshold } = routingThresholds(policy);
const topicGate = policy.topicGate !== false;
const defaultLanguage = nonEmptyString(policy.defaultLanguage) || "en";
const translationFallback = nonEmptyString(policy.translationFallback) || "claude-current-prompt";
const runtime = runtimeSummary(config);
const plugin = pluginInstallInfo();

emitContext(`<!-- nogra-plugin:session-policy -->
<NOGRA_ROUTING_POLICY>
This workspace has .nogra/config.json. Nogra automatic routing is ${autoOfferEnabled ? "on" : "off"}.

Use Nogra skills as the first move for Nogra decisions:
- For explicit /nogra:* commands or direct Nogra requests, use the matching Nogra skill.
- When automatic routing is on, consider nogra:offer before implementation skills when the request has scope, risk, ambiguity, verification needs, multiple files, browser/screenshot/build/test evidence, deploy, auth, data, or production impact.
- When automatic routing is off, do not proactively offer Nogra. Explicit /nogra:* commands still work.
- When the user explicitly asks for direct work, skip/no brief, or "uden Nogra", respect that and stay direct.
- Simple low-risk edits and pure Q&A stay direct.
- Nogra extension plugins own their own /nogra-* commands and hooks. If a prompt is for an installed /nogra-* extension, let that extension append its behavior; do not turn it into Nogra ceremony.

Current local routingPolicy: autoOfferEnabled=${autoOfferEnabled}, sensitivityPercent=${sensitivityPercent}, sensitivityStepPercent=${sensitivityStepPercent}, effectiveAutoOfferThreshold=${autoOfferThreshold}, effectiveStrongOfferThreshold=${strongOfferThreshold}, topicGate=${topicGate}.

Language routing is English-first plus local dictionary. defaultLanguage=${defaultLanguage}, translationFallback=${translationFallback}. translationFallback=claude-current-prompt is Claude's own current-prompt understanding, not an external translation call or transcript/history read.

Current local runtimePolicy: profile=${runtime.profile}, ${runtime.manager}, ${runtime.agent}, ${runtime.verifier}, budget=${runtime.budgetMode}, maxUsdPerRun=${runtime.maxUsdPerRun}.

Current installed Nogra plugin: ${plugin.id} ref=${plugin.ref}. When the user asks for Nogra status, include this plugin ref plus hosted MCP version from registry and workspace playbookVersion from .nogra/config.json when available.

runtimePolicy is a user-facing Nogra preference. Manager/main-session model is advisory unless the user also changes native Claude Code /model and /effort. Agent/verifier model and effort should be included in Nogra briefs, dispatch handoffs and run-agent instructions when the client/runtime can honor them. Interactive plugin budget is advisory; hard budget limits require a headless runtime that supports max-budget flags.

Hooks are soft timing guardrails only. They read local .nogra/config.json and do not call MCP, write files, dispatch, verify, spawn agents, run extension plugins, or draft briefs. MCP calls belong to explicit Nogra actions such as init, update, brief validation/save/promote, dispatch and verify. If Nogra is offered, stop and wait for the user to choose brief flow or direct work.
</NOGRA_ROUTING_POLICY>`);
