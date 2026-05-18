#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

function promptText(input) {
  return nonEmptyString(input.prompt) || nonEmptyString(input.message);
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

function has(pattern, text) {
  return pattern.test(text);
}

const DEFAULT_SCORING = {
  createIntent: 25,
  productSurface: 20,
  evidenceNeed: 20,
  completionClaim: 20,
  qualityCritical: 15,
  riskyDomain: 15,
  ambiguity: 10,
  lowRiskEdit: -30,
  singleFileLowScope: -15,
  directOverride: -40,
  pureQuestion: -50
};

const DEFAULT_SENSITIVITY_PERCENT = 50;
const DEFAULT_SENSITIVITY_STEP_PERCENT = 5;
const DEFAULT_DICTIONARY = {
  createIntent: ["byg", "bygge", "lav", "lave", "skab", "ret", "aendr", "ændr", "implementer", "verificer", "tjek"],
  productSurface: ["side", "flere filer", "fuld viewport"],
  evidenceNeed: ["verificer", "tjek", "bevis"],
  completionClaim: ["faerdig", "færdig"],
  qualityCritical: ["flot", "fed", "laekkert", "lækkert"],
  riskyDomain: [],
  ambiguity: ["tvetydig", "usikker", "svaer at fortryde", "svær at fortryde"],
  lowRiskEdit: ["en saetning", "en sætning", "én sætning"],
  singleFileLowScope: ["en fil", "én fil"],
  directOverride: ["direkte", "uden nogra", "skip nogra", "no nogra", "without nogra", "bare byg"],
  toggleOn: [],
  toggleOff: []
};

function numericSetting(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dictionaryPolicy(policy) {
  const candidate = policy.dictionary && typeof policy.dictionary === "object" ? policy.dictionary : {};
  const out = {};
  for (const [key, values] of Object.entries(DEFAULT_DICTIONARY)) {
    const configured = Array.isArray(candidate[key]) ? candidate[key] : [];
    out[key] = [...values, ...configured]
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter(Boolean);
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dictionaryHas(dictionary, key, text) {
  const terms = Array.isArray(dictionary[key]) ? dictionary[key] : [];
  return terms.some((term) => {
    return termMatches(term, text);
  });
}

function termMatches(term, text) {
  if (/^[a-z0-9_.-]+$/u.test(term)) {
    return new RegExp(`(?<![a-z0-9_])${escapeRegExp(term)}(?![a-z0-9_])`, "u").test(text);
  }
  return text.includes(term);
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

function scoringPolicy(policy) {
  const candidate = policy.scoring && typeof policy.scoring === "object" ? policy.scoring : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SCORING).map(([key, fallback]) => [
      key,
      numericSetting(candidate[key], fallback)
    ])
  );
}

function promptSignals(prompt, dictionary = DEFAULT_DICTIONARY) {
  const text = prompt.toLowerCase();
  const createIntent = has(
    /\b(build|create|make|scaffold|implement|write|edit|change|design|fix|debug|refactor|deploy|verify|test|check)\b/u,
    text
  ) || dictionaryHas(dictionary, "createIntent", text);
  const productSurface = has(
    /\b(app|site|website|page|landing\s*-?\s*page|landingpage|dashboard|ui|ux|frontend|component|view|screen|hero|full\s*viewport|viewport|next\.?js|react|tailwind|html|css|browser|screenshot|dribbble|inspiration)\b/u,
    text
  ) || dictionaryHas(dictionary, "productSurface", text);
  const evidenceNeed = has(/\b(test|build check|screenshot|browser|evidence|verify|verification|check|qa)\b/u, text) || dictionaryHas(dictionary, "evidenceNeed", text);
  const riskyDomain = has(/\b(auth|database|db|schema|migration|payment|security|deploy|production|prod|api|backend|permissions?)\b/u, text);
  const visualQuality = has(/\b(visual|polished|beautiful|design|brand|animation|motion|dribbble|inspiration)\b/u, text) || dictionaryHas(dictionary, "qualityCritical", text);
  const multiFileHint = has(/\b(project|workspace|repo|app|site|next\.?js|react|tailwind|scaffold|multiple files|multi[- ]?file|full\s*viewport|landing\s*-?\s*page|landingpage)\b/u, text) || dictionaryHas(dictionary, "productSurface", text);
  const completionClaim = has(/\b(done|finished|complete|actually done|claim checked)\b/u, text) || dictionaryHas(dictionary, "completionClaim", text);
  const ambiguity = has(/\b(unclear|risky|hard to revert)\b/u, text) || dictionaryHas(dictionary, "ambiguity", text);
  const lowRiskEdit = has(/\b(readme|one sentence|single sentence|hello nogra)\b/u, text) || dictionaryHas(dictionary, "lowRiskEdit", text);
  const singleFileLowScope = (has(/\b(single[- ]?file|one[- ]?file)\b/u, text) || dictionaryHas(dictionary, "singleFileLowScope", text)) && !riskyDomain;
  const directOverride = has(/\b(direct|skip brief|skip nogra|no nogra|without nogra|no ceremony|just build)\b/u, text) || dictionaryHas(dictionary, "directOverride", text);
  const pureQuestion =
    has(/\?$/u, prompt.trim()) &&
    !createIntent &&
    !productSurface &&
    !evidenceNeed &&
    !riskyDomain;

  return {
    text,
    createIntent,
    productSurface,
    evidenceNeed,
    riskyDomain,
    visualQuality,
    multiFileHint,
    completionClaim,
    ambiguity,
    lowRiskEdit,
    singleFileLowScope,
    directOverride,
    pureQuestion,
    topicRelated: createIntent || productSurface || evidenceNeed || riskyDomain || completionClaim
  };
}

function scorePrompt(prompt, scoring = DEFAULT_SCORING, dictionary = DEFAULT_DICTIONARY) {
  const signals = promptSignals(prompt, dictionary);
  let score = 0;
  const reasons = [];

  if (signals.createIntent) {
    score += scoring.createIntent;
    reasons.push("create/change intent signal");
  }
  if (signals.multiFileHint || (signals.createIntent && signals.productSurface)) {
    score += scoring.productSurface;
    reasons.push("multi-file or product-surface signal");
  }
  if (signals.evidenceNeed) {
    score += scoring.evidenceNeed;
    reasons.push("evidence or verification signal");
  }
  if (signals.completionClaim) {
    score += scoring.completionClaim;
    reasons.push("completion claim signal");
  }
  if (signals.visualQuality || (signals.createIntent && signals.productSurface)) {
    score += scoring.qualityCritical;
    reasons.push("frontend or quality-critical signal");
  }
  if (signals.riskyDomain) {
    score += scoring.riskyDomain;
    reasons.push("risk-sensitive domain signal");
  }
  if (signals.ambiguity) {
    score += scoring.ambiguity;
    reasons.push("ambiguity or hard-to-revert signal");
  }
  if (signals.lowRiskEdit) {
    score += scoring.lowRiskEdit;
    reasons.push("obvious low-risk file edit");
  }
  if (signals.singleFileLowScope) {
    score += scoring.singleFileLowScope;
    reasons.push("single-file low-scope signal");
  }
  if (signals.directOverride) {
    score += scoring.directOverride;
    reasons.push("user asks for direct work");
  }
  if (signals.pureQuestion) {
    score += scoring.pureQuestion;
    reasons.push("pure question");
  }

  return { score, reasons, topicRelated: signals.topicRelated, directOverride: signals.directOverride };
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

function emitBlock(reason) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason
    })
  );
}

function normalizeCommandText(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/u, "")
    .trim();
}

function unwrapCommandMessage(prompt) {
  const trimmed = prompt.trim();
  const match = trimmed.match(/^<command-message\b[^>]*>\s*([\s\S]*?)\s*<\/command-message>\s*$/iu);
  return match ? match[1] : trimmed;
}

function dictionaryHasExact(dictionary, key, text) {
  const normalized = normalizeCommandText(text);
  const terms = Array.isArray(dictionary[key]) ? dictionary[key] : [];
  return terms.some((term) => normalizeCommandText(term) === normalized);
}

function toggleIntent(prompt, dictionary = DEFAULT_DICTIONARY) {
  const text = prompt.toLowerCase();
  if (
    /(?:^|\n)\s*handle this nogra request:\s*off\b/u.test(text) ||
    /(?:^|\n)\s*\/nogra[:\s-]?off\b/u.test(text) ||
    has(/\b(nogra off|disable nogra|turn off nogra)\b/u, text) ||
    dictionaryHas(dictionary, "toggleOff", text)
  ) {
    return "off";
  }
  if (
    /(?:^|\n)\s*handle this nogra request:\s*on\b/u.test(text) ||
    /(?:^|\n)\s*\/nogra[:\s-]?on\b/u.test(text) ||
    has(/\b(nogra on|enable nogra|turn on nogra|use nogra(?: here| for this)?)\b/u, text) ||
    dictionaryHas(dictionary, "toggleOn", text)
  ) {
    return "on";
  }
  return "";
}

function isToggleOnlyPrompt(prompt, toggle, dictionary = DEFAULT_DICTIONARY) {
  const text = normalizeCommandText(unwrapCommandMessage(prompt));
  if (new RegExp(`^handle this nogra request:\\s*${toggle}$`, "u").test(text)) {
    return true;
  }
  if (new RegExp(`^/nogra[:\\s-]?${toggle}$`, "u").test(text)) {
    return true;
  }

  if (toggle === "off") {
    return /^(nogra off|disable nogra|turn off nogra)$/u.test(text) ||
      dictionaryHasExact(dictionary, "toggleOff", text);
  }

  if (toggle === "on") {
    return /^(nogra on|enable nogra|turn on nogra|use nogra(?: here| for this)?)$/u.test(text) ||
      dictionaryHasExact(dictionary, "toggleOn", text);
  }

  return false;
}

function isNograExtensionCommand(prompt) {
  return /^\s*\/nogra-[a-z0-9-]+(?::|\s|$)/iu.test(prompt);
}

function isGeneratedWrapperPrompt(prompt) {
  const trimmed = prompt.trimStart();
  if (/^<task-notification\b/iu.test(trimmed)) {
    return true;
  }
  if (/^<tool-(?:result|use)\b/iu.test(trimmed)) {
    return true;
  }
  if (/^<command-message\b/iu.test(trimmed)) {
    return !/(^|\n)\s*(?:\/nogra(?:[:\s-]|$)|handle this nogra request:\s*(?:on|off)\b)/iu.test(prompt);
  }
  return false;
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

const input = parseInput(readStdin());
const root = projectRoot(input);
const configInfo = readConfig(root);

if (!configInfo) {
  process.exit(0);
}

const prompt = promptText(input);
if (!prompt) {
  process.exit(0);
}

if (isGeneratedWrapperPrompt(prompt)) {
  process.exit(0);
}

const config = configInfo.config;
const policy = config.routingPolicy || {};
const dictionary = dictionaryPolicy(policy);

const toggle = toggleIntent(prompt, dictionary);
if (toggle) {
  const enabled = toggle === "on";
  applyToggle(configInfo, enabled);
  if (isToggleOnlyPrompt(prompt, toggle, dictionary)) {
    const reason = enabled
      ? "Nogra automatic offers are on."
      : "Nogra automatic offers are off. Explicit /nogra:* commands still work.";
    emitBlock(reason);
    process.exit(0);
  }

  emitContext(`<!-- nogra-plugin:routing-toggle intent=${toggle} -->
<NOGRA_ROUTING_TOGGLE>
Nogra automatic routing is now ${toggle} for this workspace.

The hook updated local .nogra/config.json only. Do not call Nogra MCP for this toggle. Do not draft a brief, dispatch, verify, or spawn an agent because of the toggle itself.

If the same prompt also asks for implementation work, continue according to the new setting:
- on: automatic Nogra offers are allowed again
- off: work hands-on/direct by default; explicit /nogra:* commands still work
</NOGRA_ROUTING_TOGGLE>`);
  process.exit(0);
}

const { score, reasons, topicRelated, directOverride } = scorePrompt(prompt, scoringPolicy(policy), dictionary);

if (/^\s*\/nogra[:\s]/u.test(prompt)) {
  process.exit(0);
}

if (isNograExtensionCommand(prompt)) {
  process.exit(0);
}

const autoOfferEnabled = policy.autoOfferEnabled !== false && policy.enabled !== false;
if (!autoOfferEnabled) {
  process.exit(0);
}

const { sensitivityPercent, autoOfferThreshold, strongOfferThreshold } = routingThresholds(policy);
const topicGate = policy.topicGate !== false;

if (directOverride || (topicGate && !topicRelated)) {
  process.exit(0);
}

if (score < autoOfferThreshold) {
  process.exit(0);
}

const offer =
  score >= strongOfferThreshold
    ? "This is scoped enough that I recommend a Nogra brief before work starts. I can write the brief first, or work directly if you prefer."
    : "This has enough scope that a Nogra brief would help. I can write the brief first, or work directly if you prefer.";

emitContext(`<!-- nogra-plugin:offer-gate score=${score} threshold=${autoOfferThreshold} reasons=${reasons.join("; ")} -->
<NOGRA_OFFER_GATE>
This user prompt locally scores ${score} for Nogra routing, which meets the workspace threshold ${autoOfferThreshold}. Current Nogra sensitivity is ${sensitivityPercent}%.

Before Bash, Write, Edit, Task, browser automation, package install, app scaffolding, Nogra MCP calls, dispatch, verification, or brief drafting:
1. Use the nogra:offer skill as the first Nogra move, or make the equivalent brief/direct offer.
2. Stop after the offer and wait for the user's choice.
3. If the user chooses direct work, proceed directly and do not call Nogra.
4. If the user accepts the brief flow, then use nogra:brief.

Recommended offer text:
${offer}
</NOGRA_OFFER_GATE>`);
