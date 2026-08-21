import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
    scope: gateList(gate.scope, false),
    grants: normalizeGrants(gate.grants)
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

// --- Ask-grants -------------------------------------------------------------
// An ask-grant binds the operator's LITERAL words to ONE boundary class, with
// optional scope patterns and a TTL. It is recorded by an explicit hand — the
// operator's own `/nogra:authorize`, or the Manager echoing the binding in chat
// BEFORE acting — never derived from prompt text by the runtime: Nogra does not
// score prompts. gate-arming can never be granted (dropped here AND unreachable
// by evaluation order in the guard). Semantics mirror `gate.authorize`: no
// scope -> the gate skips its ask (never allows); scope match + autoApprove ->
// allow. Every use lands as ONE ledger line (`ask-grant-used`) quoting the ask.
// TTL forms: `intent` (lives with the intent), `turn` (dies at the operator's
// next prompt), `next` (the prompt after next), `N turns`, `30m`/`1h`/`1d`.

const NEVER_GRANTABLE = new Set(["gate-arming"]);
const GRANT_LIST_CAP = 64;

function compactStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

export function parseGrantTtl(value, fromMs = Date.now()) {
  const raw = cleanInline(value, 40).toLowerCase();
  if (!raw || raw === "intent") return { ttl: "intent", kind: "intent", expiresAt: null, turnsLeft: null };
  if (raw === "turn" || raw === "tur") return { ttl: "turn", kind: "turns", expiresAt: null, turnsLeft: 1 };
  if (raw === "next" || raw === "naeste" || raw === "næste") return { ttl: "next", kind: "turns", expiresAt: null, turnsLeft: 2 };
  const turns = /^(\d{1,2})\s*(turns?|ture?)$/u.exec(raw);
  if (turns) {
    const n = Number(turns[1]);
    return n > 0 ? { ttl: `${n} turns`, kind: "turns", expiresAt: null, turnsLeft: n } : null;
  }
  const duration = /^(\d{1,4})\s*(m|min|mins|minutes?|h|t|hours?|timer?|d|days?|dage?)$/u.exec(raw);
  if (!duration) return null;
  const n = Number(duration[1]);
  const unit = duration[2];
  const ms = unit.startsWith("m")
    ? n * 60_000
    : unit === "h" || unit === "t" || unit.startsWith("hour") || unit.startsWith("time")
      ? n * 3_600_000
      : n * 86_400_000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return { ttl: raw, kind: "duration", expiresAt: new Date(fromMs + ms).toISOString(), turnsLeft: null };
}

function grantIsLive(raw, nowMs) {
  if (!raw || typeof raw !== "object") return false;
  if (cleanInline(raw.status || "active", 40).toLowerCase() !== "active") return false;
  const cls = cleanInline(raw.class || raw.boundary, 80).toLowerCase();
  if (!cls || NEVER_GRANTABLE.has(cls)) return false;
  const expiresAt = cleanInline(raw.expiresAt, 40);
  if (expiresAt) {
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at) || at <= nowMs) return false;
  }
  if (raw.turnsLeft !== null && raw.turnsLeft !== undefined && !(Number(raw.turnsLeft) > 0)) return false;
  return true;
}

// Live grants only: revoked/expired/used-up/never-grantable entries never
// reach the gate. Stored history stays in the file (capped at 64).
export function normalizeGrants(value, nowMs = Date.now()) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-GRANT_LIST_CAP)
    .filter((raw) => grantIsLive(raw, nowMs))
    .map((raw) => ({
      id: cleanInline(raw.id, 80) || "grant-unnamed",
      ask: cleanInline(raw.ask, 500),
      class: cleanInline(raw.class || raw.boundary, 80).toLowerCase(),
      scope: gateList(raw.scope, false),
      ttl: cleanInline(raw.ttl, 40) || "intent",
      expiresAt: cleanInline(raw.expiresAt, 40) || null,
      turnsLeft: raw.turnsLeft === null || raw.turnsLeft === undefined ? null : Number(raw.turnsLeft),
      grantedAt: cleanInline(raw.grantedAt, 40) || null,
      grantedBy: cleanInline(raw.grantedBy, 80) || null
    }));
}

function readRawIntent(root) {
  return readJson(activeIntentPath(root));
}

function rawIntentActive(raw) {
  if (!raw || typeof raw !== "object") return false;
  const objective = cleanBlock(raw.objective || raw.title || raw.summary, 800);
  const status = cleanInline(raw.status || (objective ? "active" : "missing"), 80).toLowerCase();
  return Boolean(objective) && !INACTIVE_STATUSES.has(status);
}

function saveRawIntent(root, raw) {
  raw.updatedAt = now();
  writeJsonAtomic(activeIntentPath(root), raw);
  return raw;
}

// Record a grant. Requires a running intent unless `objective` (the operator's
// own words) is given, in which case a minimal intent is started — the same
// shape the authorize skill documents. Returns { ok, grant } or { ok:false,
// reason } — never throws on operator input.
export function addGrant(root, input = {}) {
  const cls = cleanInline(input.class || input.boundary, 80).toLowerCase();
  const ask = cleanInline(input.ask, 500);
  if (!cls) return { ok: false, reason: "class-required" };
  if (NEVER_GRANTABLE.has(cls)) return { ok: false, reason: "never-grantable", class: cls };
  if (!ask) return { ok: false, reason: "ask-required" };
  const ttl = parseGrantTtl(input.ttl);
  if (!ttl) return { ok: false, reason: "bad-ttl", ttl: cleanInline(input.ttl, 40) };
  let raw = readRawIntent(root);
  let intentStarted = false;
  if (!rawIntentActive(raw)) {
    const objective = cleanBlock(input.objective, 800);
    if (!objective) return { ok: false, reason: "no-running-intent" };
    raw = { schema: "nogra.activeIntent.v1", status: "active", startedAt: now(), objective, gate: {} };
    intentStarted = true;
  }
  if (!raw.gate || typeof raw.gate !== "object") raw.gate = {};
  if (!Array.isArray(raw.gate.grants)) raw.gate.grants = [];
  const grant = {
    id: `grant-${compactStamp()}-${randomBytes(2).toString("hex")}`,
    ask,
    class: cls,
    scope: gateList(input.scope, false),
    ttl: ttl.ttl,
    expiresAt: ttl.expiresAt,
    turnsLeft: ttl.turnsLeft,
    grantedAt: now(),
    grantedBy: cleanInline(input.grantedBy, 80) || "operator-chat",
    source: cleanInline(input.source, 120) || "chat",
    status: "active"
  };
  raw.gate.grants = [...raw.gate.grants, grant].slice(-GRANT_LIST_CAP);
  saveRawIntent(root, raw);
  return { ok: true, grant, intentStarted, path: activeIntentPath(root) };
}

export function revokeGrant(root, id) {
  const wanted = cleanInline(id, 80);
  const raw = readRawIntent(root);
  const grants = raw && raw.gate && Array.isArray(raw.gate.grants) ? raw.gate.grants : [];
  const hit = grants.find((g) => g && typeof g === "object" && cleanInline(g.id, 80) === wanted);
  if (!hit) return { ok: false, reason: "grant-missing", id: wanted };
  if (cleanInline(hit.status || "active", 40).toLowerCase() !== "active") return { ok: false, reason: "grant-not-active", id: wanted, status: hit.status };
  hit.status = "revoked";
  hit.revokedAt = now();
  saveRawIntent(root, raw);
  return { ok: true, id: wanted };
}

export function listGrants(root, nowMs = Date.now()) {
  const raw = readRawIntent(root);
  const stored = raw && raw.gate && Array.isArray(raw.gate.grants) ? raw.gate.grants : [];
  return {
    intentActive: rawIntentActive(raw),
    live: normalizeGrants(stored, nowMs),
    stored: stored.filter((g) => g && typeof g === "object").map((g) => ({
      id: cleanInline(g.id, 80),
      class: cleanInline(g.class || g.boundary, 80).toLowerCase(),
      status: cleanInline(g.status || "active", 40).toLowerCase(),
      ttl: cleanInline(g.ttl, 40) || "intent",
      expiresAt: cleanInline(g.expiresAt, 40) || null,
      turnsLeft: g.turnsLeft === null || g.turnsLeft === undefined ? null : Number(g.turnsLeft),
      ask: cleanInline(g.ask, 500)
    }))
  };
}

// The operator's next prompt is the clock for turn-TTLs: every live grant with
// `turnsLeft` ticks down by one; at zero it is expired in place (history kept).
export function expireTurnGrants(root, { trigger = "user-prompt" } = {}) {
  const raw = readRawIntent(root);
  const grants = raw && raw.gate && Array.isArray(raw.gate.grants) ? raw.gate.grants : [];
  let changed = 0;
  const expired = [];
  for (const g of grants) {
    if (!g || typeof g !== "object") continue;
    if (cleanInline(g.status || "active", 40).toLowerCase() !== "active") continue;
    if (g.turnsLeft === null || g.turnsLeft === undefined) continue;
    const left = Number(g.turnsLeft) - 1;
    g.turnsLeft = left;
    changed += 1;
    if (left <= 0) {
      g.status = "expired";
      g.expiredAt = now();
      g.expiredBy = cleanInline(trigger, 60) || "user-prompt";
      expired.push(cleanInline(g.id, 80));
    }
  }
  if (changed) saveRawIntent(root, raw);
  return { changed, expired };
}

// ONE ledger line per use — the operator's ask quoted verbatim, so the
// receipt IS the intent. Append-only; the caller never lets this throw into
// the gate (see the guard).
export function recordGrantUse(root, { grant, boundary, target, risk, decision } = {}) {
  const ledger = join(root, ".nogra", "ledger", "events.jsonl");
  const config = readJson(join(root, ".nogra", "config.json")) || {};
  const when = new Date();
  const event = {
    schema: "nogra.event.v1",
    releaseVersion: "v1.0.0",
    eventId: `event-${compactStamp(when)}-ask-grant-used-${randomBytes(2).toString("hex")}`,
    createdAt: when.toISOString(),
    workspaceId: cleanInline(config.workspaceId, 120) || "unknown",
    eventType: "ask-grant-used",
    message: `ask-grant ${grant.id} used (${decision}): boundary ${boundary} for ${cleanInline(target, 200)} — ask: "${grant.ask}"`,
    briefId: "",
    runId: "",
    metadata: {
      grantId: grant.id,
      boundary,
      target: cleanInline(target, 300),
      risk: cleanInline(risk, 80),
      decision,
      ttl: grant.ttl,
      expiresAt: grant.expiresAt,
      turnsLeft: grant.turnsLeft
    },
    redactions: []
  };
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify(event)}\n`, "utf8");
  return event;
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
