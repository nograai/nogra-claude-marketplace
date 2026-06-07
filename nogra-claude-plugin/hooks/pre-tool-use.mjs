#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseJson(raw) {
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

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
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

  if (signals.createIntent) score += scoring.createIntent;
  if (signals.multiFileHint || (signals.createIntent && signals.productSurface)) score += scoring.productSurface;
  if (signals.evidenceNeed) score += scoring.evidenceNeed;
  if (signals.completionClaim) score += scoring.completionClaim;
  if (signals.visualQuality || (signals.createIntent && signals.productSurface)) score += scoring.qualityCritical;
  if (signals.riskyDomain) score += scoring.riskyDomain;
  if (signals.ambiguity) score += scoring.ambiguity;
  if (signals.lowRiskEdit) score += scoring.lowRiskEdit;
  if (signals.singleFileLowScope) score += scoring.singleFileLowScope;
  if (signals.pureQuestion) score += scoring.pureQuestion;

  return { score, topicRelated: signals.topicRelated, directOverride: signals.directOverride };
}

function semanticText(prompt) {
  return prompt
    .toLowerCase()
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function sensitivityPosture(sensitivityPercent = DEFAULT_SENSITIVITY_PERCENT) {
  if (sensitivityPercent <= 35) return "conservative";
  if (sensitivityPercent >= 70) return "eager";
  return "balanced";
}

function shellTokenText(token) {
  return String(token || "")
    .trim()
    .replace(/^['"`]|['"`]$/gu, "")
    .replace(/\\ /gu, " ");
}

function isDangerousRecursiveRemoveTarget(rawTarget) {
  let target = shellTokenText(rawTarget);

  if (!target) return false;
  if (/^\//u.test(target)) return true;

  target = target.replace(/\/+$/u, "");
  if (!target) return false;

  if (/[*?[\]]/u.test(target)) return true;
  if (/^(?:~(?:\/|$)|\$|\$\{)/u.test(target)) return true;
  if (/^\.\.?$/u.test(target) || /(?:^|\/)\.\.(?:\/|$)/u.test(target)) return true;

  target = target.replace(/^(?:\.\/)+/u, "");
  const segments = target.split("/").filter(Boolean);
  return segments.some((segment) => {
    if (/^\.env(?:\.|$)/u.test(segment)) return true;
    return [".git", ".ssh"].includes(segment);
  });
}

function hasUnsafeRecursiveRemove(text) {
  for (const segment of text.split(/\n|&&|\|\||;/u)) {
    const match = /\brm\b([\s\S]*)/u.exec(segment);
    if (!match) continue;

    const tokens = match[1].trim().split(/\s+/u).filter(Boolean);
    let recursive = false;
    let force = false;
    const targets = [];
    let passthrough = false;

    for (const token of tokens) {
      const value = shellTokenText(token);
      if (!value) continue;
      if (!passthrough && value === "--") {
        passthrough = true;
        continue;
      }
      if (!passthrough && /^-[a-z]+$/u.test(value)) {
        recursive ||= value.includes("r");
        force ||= value.includes("f");
        continue;
      }
      if (!passthrough && /^--[a-z0-9-]+$/u.test(value)) continue;
      targets.push(value);
    }

    if (recursive && force && targets.some((target) => isDangerousRecursiveRemoveTarget(target))) {
      return true;
    }
  }
  return false;
}

function executableBoundaryTripwire(inputText) {
  const text = semanticText(inputText);
  const reasons = [];

  if (!text) {
    return { active: false, reasons: [] };
  }

  if (
    /\bvercel\b[^\n]*\s--prod(?:uction)?\b/u.test(text) ||
    /\bwrangler\s+(?:pages\s+)?deploy\b/u.test(text) ||
    /\bnetlify\s+deploy\b[^\n]*\s--prod(?:uction)?\b/u.test(text) ||
    /\bfirebase\s+deploy\b/u.test(text) ||
    /\bfly\s+deploy\b/u.test(text) ||
    /\brailway\s+up\b/u.test(text) ||
    /\bgh\s+release\s+create\b/u.test(text) ||
    /\bgit\s+push\b[^\n]*(?:--force|-f)\b/u.test(text)
  ) {
    reasons.push("production deploy or externally visible release");
  }

  if (
    /\b(?:npx\s+)?prisma\s+migrate\s+(?:deploy|reset|resolve)\b/u.test(text) ||
    /\b(?:npx\s+)?prisma\s+db\s+push\b/u.test(text) ||
    /\b(?:npx\s+)?drizzle-kit\s+(?:push|migrate)\b/u.test(text) ||
    /\bsupabase\s+db\s+(?:push|reset|migration\s+up|remote\s+commit)\b/u.test(text) ||
    /\bknex\s+migrate:(?:latest|up|rollback)\b/u.test(text) ||
    /\bsequelize\s+db:migrate\b/u.test(text) ||
    /\b(?:psql|mysql|sqlite3)\b[\s\S]{0,600}\b(?:drop\s+(?:table|database|schema)|truncate(?:\s+table)?|delete\s+from)\b/u.test(text) ||
    /\b(?:drop\s+(?:table|database|schema)|truncate(?:\s+table)?|delete\s+from)\b/u.test(text) ||
    hasUnsafeRecursiveRemove(text) ||
    /\bsupabase\s+db\s+reset\b/u.test(text)
  ) {
    reasons.push("data migration or data-loss command");
  }

  if (
    /(?:^|\s|\/)\.env(?:\.[a-z0-9_-]+)?(?:\s|$)/u.test(text) ||
    /\b(?:vercel\s+env\s+(?:add|rm|pull)|wrangler\s+secret\s+put|fly\s+secrets\s+set|railway\s+variables\s+set|supabase\s+secrets\s+set|doppler\s+secrets\s+set|aws\s+secretsmanager\s+put-secret-value)\b/u.test(text)
  ) {
    reasons.push("secrets or environment boundary");
  }

  if (/\bstripe\s+(?:products?|prices?|payment_links?|checkout|billing_portal|subscriptions?|webhook_endpoints?)\s+(?:create|update|delete)\b/u.test(text)) {
    reasons.push("payment or billing command");
  }

  if (/\b(?:sendgrid|mailchimp|resend)\b[^\n]*\b(?:send|broadcast|campaign|emails?)\b/u.test(text)) {
    reasons.push("external customer-impacting send");
  }

  return { active: reasons.length > 0, reasons };
}

function isExplicitNograPrompt(prompt) {
  return /^\s*\/nogra[:\s]/u.test(prompt) || /\b(nogra brief|nogra:brief|nogra verify|nogra:verify)\b/iu.test(prompt);
}

function isNograExtensionCommand(prompt) {
  return /^\s*\/nogra-[a-z0-9-]+(?::|\s|$)/iu.test(prompt);
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

function isNograTool(input) {
  if (typeof input.tool_name === "string" && /^mcp__(?:plugin_nogra_nogra|nogra)__/.test(input.tool_name)) {
    return true;
  }

  if (input.tool_name !== "Skill") return false;
  return JSON.stringify(input.tool_input || {}).toLowerCase().includes("nogra:");
}

function toolBoundaryText(input) {
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const parts = [nonEmptyString(input.tool_name)];
  const pathValue = nonEmptyString(toolInput.file_path) || nonEmptyString(toolInput.path);

  for (const key of ["command", "file_path", "path"]) {
    const value = nonEmptyString(toolInput[key]);
    if (value) parts.push(value);
  }

  const includeWritePayload = /(?:^|\/)(?:migrations?|prisma|drizzle|sql)\b|\.sql$|(?:^|\s|\/)\.env(?:\.[a-z0-9_-]+)?$/iu.test(pathValue);
  if (includeWritePayload) {
    parts.push(nonEmptyString(toolInput.content));
    parts.push(nonEmptyString(toolInput.new_string));
  }

  if (includeWritePayload && Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits.slice(0, 10)) {
      if (edit && typeof edit === "object") {
        parts.push(nonEmptyString(edit.old_string));
        parts.push(nonEmptyString(edit.new_string));
      }
    }
  }

  return parts
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

function pendingOfferState(root, policy) {
  const record = readJsonFile(join(root, ".nogra", "runtime", "last-routing-score.json"));
  if (!record || typeof record !== "object") {
    return { active: false };
  }

  const maxAgeMs = numericSetting(policy.pendingOfferMaxAgeMs, 30 * 60 * 1000);
  const updatedAtMs = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) {
    return { active: false };
  }

  const autoOfferEnabled = policy.autoOfferEnabled !== false && policy.enabled !== false;
  if (!autoOfferEnabled || record.autoOfferEnabled === false) {
    return { active: false };
  }

  if (record.offerResolution) {
    return { active: false };
  }

  if (record.offerTriggered !== true) {
    const fallback = record.judgmentFallback && typeof record.judgmentFallback === "object"
      ? record.judgmentFallback
      : {};
    const tripwire = record.tripwire && typeof record.tripwire === "object"
      ? record.tripwire
      : {};
    if (fallback.active !== true && tripwire.active !== true) {
      return { active: false };
    }
  }

  if (record.preToolAskForUpdatedAt === record.updatedAt) {
    return { active: false };
  }

  return {
    active: true,
    updatedAt: record.updatedAt,
    score: numericSetting(record.score, 0),
    threshold: numericSetting(record.threshold, numericSetting(policy.autoOfferThreshold, 60)),
    sensitivityPercent: numericSetting(record.sensitivityPercent, DEFAULT_SENSITIVITY_PERCENT),
    reasons: Array.isArray(record.reasons) ? record.reasons.filter((reason) => typeof reason === "string") : [],
    fallbackReasons: Array.isArray(record.judgmentFallback?.reasons)
      ? record.judgmentFallback.reasons.filter((reason) => typeof reason === "string")
    : [],
    tripwireReasons: Array.isArray(record.tripwire?.reasons)
      ? record.tripwire.reasons.filter((reason) => typeof reason === "string")
      : []
  };
}

function autoOfferEnabled(policy = {}) {
  return policy.autoOfferEnabled !== false && policy.enabled !== false;
}

function writeRoutingOffState(root, policy = {}) {
  const { sensitivityPercent, autoOfferThreshold, strongOfferThreshold } = routingThresholds(policy);
  const posture = sensitivityPosture(sensitivityPercent);
  const path = join(root, ".nogra", "runtime", "last-routing-score.json");

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          schema: "nogra.routingScore.v1",
          updatedAt: new Date().toISOString(),
          score: 0,
          hitPercent: 0,
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
        },
        null,
        2
      )}\n`
    );
  } catch {
    // Routing telemetry is advisory. Never block the tool because of it.
  }
}

function markPreToolAskEmitted(root, pending = {}) {
  const path = join(root, ".nogra", "runtime", "last-routing-score.json");
  const record = readJsonFile(path);
  if (!record || typeof record !== "object") return;

  try {
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...record,
          preToolAskEmittedAt: new Date().toISOString(),
          preToolAskForUpdatedAt: pending.updatedAt || record.updatedAt || null,
          preToolPermissionDecision: "ask"
        },
        null,
        2
      )}\n`
    );
  } catch {
    // Permission prompts are the product behavior. Telemetry updates are best effort.
  }
}

function userFacingJudgmentReason(kind, pending, toolName = "tool") {
  const reasons = [
    ...(pending.reasons || []),
    ...(pending.fallbackReasons || []),
    ...(pending.tripwireReasons || [])
  ];
  const reasonText = reasons.length ? ` Signals: ${reasons.join("; ")}.` : "";
  const scoreText = Number.isFinite(pending.score)
    ? ` Legacy heat ${pending.score}, legacy threshold ${pending.threshold}.`
    : "";
  const prefix = kind === "fallback"
    ? "Nogra is ON and caught Claude starting a tool across an irreversible boundary before the choice was visible."
    : "Nogra is ON and caught Claude starting a tool across an irreversible boundary before the choice was confirmed.";

  return `${prefix} Tool: ${toolName}.${scoreText}${reasonText} This is a last-minute safety rail, not a broad brief gate. Approve direct for this task/tool, or reject and ask Claude to offer the Nogra brief flow. Use /nogra:off only for workspace-level disable.`;
}

function emitAsk(reason, root, pending) {
  markPreToolAskEmitted(root, pending);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason
      }
    })
  );
}

const input = parseJson(readStdin());
const root = projectRoot(input);
const config = readConfig(root);

if (!config) process.exit(0);

captureSessionAnchor(root, input, "PreToolUse");

const prompt = nonEmptyString(input.prompt);
const policy = config.routingPolicy || {};
if (isNograTool(input)) {
  process.exit(0);
}

if (!prompt) {
  if (!autoOfferEnabled(policy)) {
    writeRoutingOffState(root, policy);
    process.exit(0);
  }

  const pending = pendingOfferState(root, policy);
  if (pending.active) {
    emitAsk(userFacingJudgmentReason("pending", pending, input.tool_name), root, pending);
    process.exit(0);
  }

  const toolTripwire = executableBoundaryTripwire(toolBoundaryText(input));
  if (toolTripwire.active) {
    emitAsk(
      userFacingJudgmentReason(
        "fallback",
        {
          score: 0,
          threshold: numericSetting(policy.autoOfferThreshold, 60),
          reasons: [],
          tripwireReasons: toolTripwire.reasons
        },
        input.tool_name
      ),
      root
    );
  }
  process.exit(0);
}

if (isGeneratedWrapperPrompt(prompt)) {
  process.exit(0);
}

const scoring = scoringPolicy(policy);
const dictionary = dictionaryPolicy(policy);
const routingPrompt = userAuthoredText(prompt);

const toggle = toggleIntent(prompt, dictionary);
if (toggle) {
  process.exit(0);
}

if (isExplicitNograPrompt(routingPrompt) || isNograExtensionCommand(routingPrompt)) {
  process.exit(0);
}

if (!autoOfferEnabled(policy)) {
  writeRoutingOffState(root, policy);
  process.exit(0);
}

if (!routingPrompt) {
  process.exit(0);
}

const pending = pendingOfferState(root, policy);
if (pending.active) {
  emitAsk(userFacingJudgmentReason("pending", pending, input.tool_name), root, pending);
  process.exit(0);
}

const { score, topicRelated, directOverride } = scorePrompt(routingPrompt, scoring, dictionary);

const { sensitivityPercent, autoOfferThreshold } = routingThresholds(policy);
const tripwire = executableBoundaryTripwire(toolBoundaryText(input));

if (!tripwire.active) {
  process.exit(0);
}

emitAsk(
  userFacingJudgmentReason(
    "fallback",
    {
      score,
      threshold: autoOfferThreshold,
      sensitivityPercent,
      reasons: [],
      tripwireReasons: tripwire.reasons
    },
    input.tool_name
  ),
  root
);
