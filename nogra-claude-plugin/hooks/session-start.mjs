#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveBootContext } from "../runtime/local/boot-context.mjs";
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

function roleValue(role, key) {
  return cleanLabel(role && typeof role === "object" ? role[key] : "", "").toLowerCase();
}

function isStockLegacyBalancedRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return false;
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const budget = runtime.budget && typeof runtime.budget === "object" ? runtime.budget : {};
  const manager = roles.manager && typeof roles.manager === "object" ? roles.manager : {};
  const agent = roles.agent && typeof roles.agent === "object" ? roles.agent : {};
  const verifier = roles.verifier && typeof roles.verifier === "object" ? roles.verifier : {};
  return cleanLabel(runtime.profile, "").toLowerCase() === "balanced" &&
    roleValue(manager, "model") === "inherit" &&
    roleValue(manager, "effort") === "auto" &&
    roleValue(agent, "model") === "sonnet" &&
    roleValue(agent, "effort") === "high" &&
    roleValue(verifier, "model") === "sonnet" &&
    roleValue(verifier, "effort") === "medium" &&
    ["", "balanced"].includes(cleanLabel(budget.mode, "").toLowerCase());
}

function runtimeSummary(config) {
  const runtime = config.runtimePolicy && typeof config.runtimePolicy === "object" ? config.runtimePolicy : {};
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const rawProfile = cleanLabel(runtime.profile, "default").toLowerCase();
  const profile = rawProfile === "custom" || (rawProfile && rawProfile !== "default" && !isStockLegacyBalancedRuntime(runtime))
    ? "custom"
    : "default";
  const roleLine = (name, fallbackModel, fallbackEffort, legacy = "") => {
    const role = roles[name] && typeof roles[name] === "object"
      ? roles[name]
      : legacy && roles[legacy] && typeof roles[legacy] === "object"
        ? roles[legacy]
        : {};
    const model = cleanLabel(role.model, fallbackModel);
    const effort = cleanLabel(role.effort, fallbackEffort);
    const context = cleanLabel(role.context, "");
    return `${name}=${model}/${effort}${context ? `/${context}` : ""}`;
  };

  return {
    profile,
    rawProfile: rawProfile || "default",
    manager: roleLine("manager", "inherit", "auto"),
    executor: profile === "custom" ? roleLine("executor", "sonnet", "medium", "agent") : "executor=default",
    verifier: profile === "custom" ? roleLine("verifier", "sonnet", "medium") : "verifier=default"
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

function bootContextBlock(root) {
  const boot = resolveBootContext({ cwd: root });
  const lines = [
    "<NOGRA_BOOT_CONTEXT>",
    boot.message,
    "",
    `status=${boot.status}`,
    `workspaceId=${boot.workspaceId || ""}`,
    `workspaceRoot=${boot.workspaceRoot || ""}`,
    `ledgerWatermark=${boot.ledgerWatermark ?? 0}`,
    `checkpointSourceWatermark=${boot.checkpointSourceWatermark ?? 0}`,
    `checkpointStatus=${boot.checkpointStatus || "fresh"}`,
    "writes=[]",
    "autoLoaded=false",
    "</NOGRA_BOOT_CONTEXT>"
  ];
  return `<!-- nogra-plugin:boot-context status=${boot.status} -->\n${lines.join("\n")}`;
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

When the user asks for Nogra status or version, include this plugin ref and say the folder is not initialized. If the user asks what to do next, suggest /nogra:setup.
</NOGRA_PLUGIN_STATUS>`);
  process.exit(0);
}

const policy = config.routingPolicy || {};
captureSessionAnchor(root, input, "SessionStart");
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
- When automatic routing is on, judge the user's task first. If the request has scope, risk, ambiguity, verification needs, multiple files, browser/screenshot/build/test evidence, deploy, auth, data, or production impact, offer the Nogra brief flow before implementation skills.
- When automatic routing is off, do not proactively offer Nogra. Explicit /nogra:* commands still work.
- If the user chooses direct work after the Nogra offer, proceed directly for that task while Nogra stays on. If "direct", skip/no brief, no Nogra, without Nogra, Claude native, or local-language no-Nogra equivalents appear inside the initial task, do not let that bypass heat scoring; judge the task normally and offer brief/direct when scope warrants it.
- Use /nogra:off only when the user wants workspace-level automatic routing disabled.
- Simple low-risk edits and pure Q&A stay direct.
- Nogra extension plugins own their own /nogra-* commands and hooks. If a prompt is for an installed /nogra-* extension, let that extension append its behavior; do not turn it into Nogra ceremony.
- If the user asks which Nogra projects/workspaces exist, use the boot context workspace index/candidates to show a compact project list and ask what they want to do next. Do not load every project checkpoint unless they choose one.

Current local routingPolicy: autoOfferEnabled=${autoOfferEnabled}, sensitivityPercent=${sensitivityPercent}, sensitivityStepPercent=${sensitivityStepPercent}, effectiveAutoOfferThreshold=${autoOfferThreshold}, effectiveStrongOfferThreshold=${strongOfferThreshold}, topicGate=${topicGate}.

Language routing is English-first. defaultLanguage=${defaultLanguage}, translationFallback=${translationFallback}. translationFallback=claude-current-prompt is Claude's own current-prompt understanding, not an external translation call or transcript/history read.

Current local runtimePolicy: profile=${runtime.profile}, rawProfile=${runtime.rawProfile}, ${runtime.manager}, ${runtime.executor}, ${runtime.verifier}. Default runtime uses the release default executor/verifier preferences without writing those concrete choices into default config.

Current installed Nogra plugin: ${plugin.id} ref=${plugin.ref}. When the user asks for Nogra status, include this plugin ref and workspace releaseVersion from .nogra/config.json. Use the local runtime for status.

runtimePolicy is a user-facing Nogra preference. Default/custom is the Nogra-level state. Concrete executor/verifier model and effort belong in config only when profile=custom, and should be included in dispatch handoffs and run-agent instructions when the client/runtime can honor them. Claude Code's native /model, /effort and subagent UI remain the source of truth for the actual running model/effort shown by Claude Code.

Hooks are routing guardrails when Nogra automatic routing is on. They read local .nogra/config.json and may write only bounded local routing telemetry under .nogra/runtime/last-routing-score.json plus the current local session anchor under .nogra/runtime/session-anchor.json. They do not write config, dispatch, verify, spawn agents, run extension plugins, draft briefs, read full transcripts, or promote checkpoints. Nogra actions use the local runtime and local .nogra/ records. If Nogra is offered, stop and wait for the user to choose Nogra brief flow or direct work for this task. /nogra:off is only for workspace-level disable.

Session continuity rule: ledger state is the truth source and checkpoint state is a human-readable projection. If checkpointStatus=stale, the ledger has newer facts than .nogra/state/SESSION-CHECKPOINT.md. Treat the checkpoint as stale; when the user asks to continue, wrap up, or save progress, refresh/propose the checkpoint from ledger facts rather than inventing memory from chat.
</NOGRA_ROUTING_POLICY>

${bootContextBlock(root)}`);
