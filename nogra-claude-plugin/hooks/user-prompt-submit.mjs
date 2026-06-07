#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  directOverride: 0,
  pureQuestion: -50
};

const DEFAULT_SENSITIVITY_PERCENT = 50;
const DEFAULT_SENSITIVITY_STEP_PERCENT = 5;
const DEFAULT_DICTIONARY = {
  createIntent: ["build", "create", "make", "scaffold", "implement", "write", "edit", "change", "design", "fix", "debug", "refactor", "deploy", "verify", "test", "check"],
  productSurface: ["app", "site", "website", "page", "landing page", "dashboard", "ui", "ux", "frontend", "component", "view", "screen", "hero", "full viewport", "viewport", "react", "tailwind", "html", "css", "browser", "screenshot", "inspiration"],
  evidenceNeed: ["test", "build check", "screenshot", "browser", "evidence", "verify", "verification", "check", "qa"],
  completionClaim: ["done", "finished", "complete", "actually done", "claim checked"],
  qualityCritical: ["visual", "polished", "beautiful", "design", "brand", "animation", "motion", "inspiration"],
  riskyDomain: ["auth", "database", "db", "schema", "migration", "payment", "security", "deploy", "production", "prod", "api", "backend", "permission", "permissions"],
  ambiguity: ["unclear", "risky", "hard to revert"],
  lowRiskEdit: ["readme", "one sentence", "single sentence", "hello nogra"],
  singleFileLowScope: ["single file", "one file"],
  directOverride: [
    "direct",
    "direct/native",
    "skip brief",
    "skip nogra",
    "no nogra",
    "without nogra",
    "no ceremony",
    "just build",
    "claude native",
    "direkte",
    "uden nogra",
    "uden brief",
    "ingen nogra",
    "ingen brief",
    "spring nogra over",
    "spring brief over",
    "kør uden nogra",
    "koer uden nogra",
    "køre uden nogra",
    "koere uden nogra"
  ],
  toggleOn: [],
  toggleOff: []
};

const IRREVERSIBLE_BOUNDARY_ANCHORS = [
  "production deploy",
  "data migration or data loss",
  "auth/security/secrets",
  "payments/billing",
  "destructive bulk change",
  "external customer-impacting send"
];

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
    reasons.push("user asks for direct work");
  }
  if (signals.pureQuestion) {
    score += scoring.pureQuestion;
    reasons.push("pure question");
  }

  return { score, reasons, topicRelated: signals.topicRelated, directOverride: signals.directOverride };
}

function sensitivityPosture(sensitivityPercent = DEFAULT_SENSITIVITY_PERCENT) {
  if (sensitivityPercent <= 35) return "conservative";
  if (sensitivityPercent >= 70) return "eager";
  return "balanced";
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

function emitDirectChoice() {
  emitContext(`<!-- nogra-plugin:direct-choice -->
<NOGRA_DIRECT_CHOICE>
The user chose direct work for the pending Nogra offer. Nogra automatic routing stays ON for the workspace.

Proceed directly for this task. If an irreversible boundary appears later, surface the boundary and ask whether to continue direct or switch to the Nogra brief flow.
</NOGRA_DIRECT_CHOICE>`);
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

function exactIntentLines(prompt) {
  return userAuthoredText(prompt)
    .toLowerCase()
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/[.!?]+$/u, "").trim())
    .filter(Boolean);
}

function dictionaryToggleLine(line, dictionary = DEFAULT_DICTIONARY) {
  for (const [key, intent] of [["toggleOff", "off"], ["toggleOn", "on"]]) {
    const terms = Array.isArray(dictionary[key]) ? dictionary[key] : [];
    for (const term of terms) {
      if (
        line === term ||
        line.startsWith(`${term} og `) ||
        line.startsWith(`${term} and `)
      ) {
        return intent;
      }
    }
  }
  return "";
}

function toggleIntent(prompt, dictionary = DEFAULT_DICTIONARY) {
  for (const line of exactIntentLines(prompt)) {
    const dictionaryIntent = dictionaryToggleLine(line, dictionary);
    if (dictionaryIntent) {
      return dictionaryIntent;
    }
    if (
      /^handle this nogra request:\s*off$/u.test(line) ||
      /^\/nogra[:\s-]?off$/u.test(line) ||
      /^(?:please\s+)?(?:(?:turn|switch|set)\s+nogra\s+off|turn\s+off\s+nogra|disable\s+nogra)$/u.test(line)
    ) {
      return "off";
    }
    if (
      /^handle this nogra request:\s*on$/u.test(line) ||
      /^\/nogra[:\s-]?on$/u.test(line) ||
      /^(?:please\s+)?(?:(?:turn|switch|set)\s+nogra\s+on|turn\s+on\s+nogra|enable\s+nogra)$/u.test(line)
    ) {
      return "on";
    }
  }
  return "";
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

function workspaceRootFromConfig(configPath) {
  return dirname(dirname(configPath));
}

function hitPercent(score) {
  return Math.max(0, Math.min(100, Math.round(numericSetting(score, 0))));
}

function autoOfferEnabled(policy = {}) {
  return policy.autoOfferEnabled !== false && policy.enabled !== false;
}

function writeRoutingScore(configInfo, scoreState) {
  try {
    const root = workspaceRootFromConfig(configInfo.configPath);
    const runtimeDir = join(root, ".nogra", "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "last-routing-score.json"),
      `${JSON.stringify(
        {
          schema: "nogra.routingScore.v1",
          updatedAt: new Date().toISOString(),
          ...scoreState,
          hitPercent: hitPercent(scoreState.score)
        },
        null,
        2
      )}\n`
    );
  } catch {
    // Routing telemetry is advisory. Never fail or emit context because of it.
  }
}

function writeRoutingOffState(configInfo, policy = {}) {
  const { sensitivityPercent, autoOfferThreshold, strongOfferThreshold } = routingThresholds(policy);
  const posture = sensitivityPosture(sensitivityPercent);
  writeRoutingScore(configInfo, {
    score: 0,
    reasons: [],
    topicRelated: false,
    directOverride: false,
    autoOfferEnabled: false,
    topicGate: policy.topicGate !== false,
    threshold: autoOfferThreshold,
    strongThreshold: strongOfferThreshold,
    sensitivityPercent,
    offerTriggered: false,
    route: "none",
    routingDecision: "none",
    suppressionReason: "auto-off",
    judgmentFallback: {
      active: false,
      reasons: []
    },
    tripwire: {
      active: false,
      anchors: IRREVERSIBLE_BOUNDARY_ANCHORS,
      reasons: []
    },
    managerJudgment: {
      active: false,
      posture,
      anchors: [],
      reasons: []
    }
  });
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function recentRoutingRecord(configInfo, policy = {}) {
  const root = workspaceRootFromConfig(configInfo.configPath);
  const record = readJsonFile(join(root, ".nogra", "runtime", "last-routing-score.json"));
  if (!record || typeof record !== "object") return null;

  const maxAgeMs = numericSetting(policy.pendingOfferMaxAgeMs, 30 * 60 * 1000);
  const updatedAtMs = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) return null;
  if (record.autoOfferEnabled === false || record.offerResolution) return null;

  const fallback = record.judgmentFallback && typeof record.judgmentFallback === "object"
    ? record.judgmentFallback
    : {};
  const tripwire = record.tripwire && typeof record.tripwire === "object"
    ? record.tripwire
    : {};
  if (record.offerTriggered !== true && fallback.active !== true && tripwire.active !== true) return null;
  return record;
}

function isDirectChoicePrompt(prompt) {
  const lines = exactIntentLines(prompt);
  if (!lines.length || lines.length > 2) return false;
  const text = lines.join(" ");
  if (text.length > 80) return false;
  return /^(?:direct|directly|work directly|take it directly|go direct|skip brief|no brief|without brief|direkte|bare direkte|du kører bare direkte|du koerer bare direkte|du køre bare direkte|du koere bare direkte|kør direkte|koer direkte|køre direkte|koere direkte|arbejd direkte|uden brief|ingen brief|uden nogra|ingen nogra)$/u.test(text);
}

function writeRoutingResolution(configInfo, record, resolution) {
  writeRoutingScore(configInfo, {
    ...record,
    updatedAt: new Date().toISOString(),
    offerResolution: resolution,
    offerResolvedAt: new Date().toISOString(),
    route: resolution,
    routingDecision: resolution,
    offerTriggered: false
  });
}

const input = parseInput(readStdin());
const root = projectRoot(input);
const configInfo = readConfig(root);

if (!configInfo) {
  process.exit(0);
}

captureSessionAnchor(root, input, "UserPromptSubmit");

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
const routingPrompt = userAuthoredText(prompt);

const toggle = toggleIntent(prompt, dictionary);
if (toggle) {
  emitContext(`<!-- nogra-plugin:routing-toggle intent=${toggle} -->
<NOGRA_ROUTING_TOGGLE_REQUEST>
The user asked to turn Nogra automatic offers ${toggle} for this workspace.

Hooks are routing guardrails only. Do not treat this hook as the actor, and do not say the hook already changed config.

Use the nogra:${toggle} skill now. The skill owns reading and updating local .nogra/config.json, then reporting the result visibly to the user.

If the same prompt also asks for implementation work, first apply the toggle through the skill, then continue according to the new setting.
</NOGRA_ROUTING_TOGGLE_REQUEST>`);
  process.exit(0);
}

if (/^\s*\/nogra[:\s]/u.test(routingPrompt)) {
  process.exit(0);
}

if (isNograExtensionCommand(routingPrompt)) {
  process.exit(0);
}

if (!autoOfferEnabled(policy)) {
  writeRoutingOffState(configInfo, policy);
  process.exit(0);
}

if (!routingPrompt) {
  process.exit(0);
}

const pendingRecord = recentRoutingRecord(configInfo, policy);
if (pendingRecord && isDirectChoicePrompt(routingPrompt)) {
  writeRoutingResolution(configInfo, pendingRecord, "direct");
  emitDirectChoice();
  process.exit(0);
}

const focus = resolveProjectFocus({ cwd: root, prompt: routingPrompt });
if (focus.additionalContext) {
  emitContext(focus.additionalContext);
  process.exit(0);
}

const { score, reasons, topicRelated, directOverride } = scorePrompt(routingPrompt, scoringPolicy(policy), dictionary);
const { sensitivityPercent, autoOfferThreshold, strongOfferThreshold } = routingThresholds(policy);
const topicGate = policy.topicGate !== false;

writeRoutingScore(configInfo, {
  score,
  reasons,
  topicRelated,
  directOverride,
  autoOfferEnabled: true,
  topicGate,
  threshold: autoOfferThreshold,
  strongThreshold: strongOfferThreshold,
  sensitivityPercent,
  offerTriggered: false,
  route: "none",
  routingDecision: "none",
  judgmentFallback: {
    active: false,
    reasons: []
  },
  tripwire: {
    active: false,
    anchors: IRREVERSIBLE_BOUNDARY_ANCHORS,
    reasons: []
  },
  managerJudgment: {
    active: false,
    posture: sensitivityPosture(sensitivityPercent),
    anchors: [],
    reasons: []
  }
});
