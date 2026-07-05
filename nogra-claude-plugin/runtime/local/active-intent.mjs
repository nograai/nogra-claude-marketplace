import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const INACTIVE_STATUSES = new Set(["done", "closed", "complete", "completed", "cancelled", "canceled", "superseded", "inactive"]);

function now() {
  return new Date().toISOString();
}

function cleanInline(value, maxLength = 240) {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function cleanBlock(value, maxLength = 800) {
  const cleaned = String(value ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function linesFrom(value, maxItems = 6) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/\r?\n/u)
        .map((line) => line.replace(/^[-*]\s*/u, ""));
  return raw.map((item) => cleanInline(item, 180)).filter(Boolean).slice(0, maxItems);
}

function readJson(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

export function activeIntentPath(root) {
  return join(root, ".nogra", "runtime", "active-intent.json");
}

export function readActiveIntent(root) {
  const file = activeIntentPath(root);
  const raw = readJson(file);
  if (!raw || typeof raw !== "object") {
    return { status: "missing", path: file, active: false, intent: null };
  }

  const objective = cleanBlock(raw.objective || raw.title || raw.summary, 800);
  const status = cleanInline(raw.status || (objective ? "active" : "missing"), 80).toLowerCase();
  if (!objective || INACTIVE_STATUSES.has(status)) {
    return { status: status || "inactive", path: file, active: false, intent: raw };
  }

  return {
    status: "active",
    path: file,
    active: true,
    intent: {
      schema: "nogra.activeIntent.v1",
      ...raw,
      status,
      objective
    }
  };
}

function gateList(value, lowercase) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const cleaned = cleanInline(entry, 500);
      return lowercase ? cleaned.toLowerCase() : cleaned;
    })
    .filter(Boolean)
    .slice(0, 64);
}

// Normalized gate authorization carried by a GO: boundary classes the user
// approved (`authorize`), declared non-goals (`nonGoals`), and
// path/glob/command scope patterns (`scope`) that bound where the
// authorization applies.
export function normalizeActiveIntentGate(intent) {
  const gate = intent && intent.gate && typeof intent.gate === "object" ? intent.gate : {};
  return {
    authorize: gateList(gate.authorize, true),
    nonGoals: gateList(gate.nonGoals, true),
    scope: gateList(gate.scope, false)
  };
}

export function writeActiveIntent(root, intent) {
  const payload = {
    schema: "nogra.activeIntent.v1",
    status: "active",
    startedAt: now(),
    ...intent,
    updatedAt: now()
  };
  writeJsonAtomic(activeIntentPath(root), payload);
  return payload;
}

function renderLines(label, value) {
  const lines = linesFrom(value);
  if (!lines.length) return "";
  return [`${label}:`, ...lines.map((line) => `- ${line}`)].join("\n");
}

export function renderActiveIntentContext(intent) {
  const project = cleanInline(intent.project || intent.workspaceName || intent.workspaceId, 160);
  const currentBlock = cleanBlock(intent.currentBlock || intent.block || intent.focus, 500);
  const doneWhen = cleanBlock(intent.doneWhen || intent.doneCriteria || intent.acceptance, 700);
  const changePolicy = cleanBlock(
    intent.changePolicy ||
      "Intent changes only when the user explicitly changes it, closes it, or a new intent persists across the configured number of user turns.",
    700
  );
  const sections = [
    "<!-- nogra-plugin:active-intent -->",
    "<NOGRA_ACTIVE_INTENT>",
    project ? `Project: ${project}` : "",
    `Objective: ${intent.objective}`,
    renderLines("Current plan", intent.currentPlan || intent.plan),
    currentBlock ? `Current block: ${currentBlock}` : "",
    doneWhen ? `Done when: ${doneWhen}` : "",
    renderLines("Non-goals", intent.nonGoals),
    `Change policy: ${changePolicy}`,
    "Runtime rule: keep this intent in view. Do not claim the active block is done unless the done criteria are satisfied with evidence, or the user explicitly changes/closes the intent.",
    "</NOGRA_ACTIVE_INTENT>"
  ].filter(Boolean);
  return sections.join("\n");
}
