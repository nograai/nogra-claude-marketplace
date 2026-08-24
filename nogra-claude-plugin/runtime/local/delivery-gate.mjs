// Delivery gate — the Stop-time check that a message to the operator is a DELIVERY, not a claim.
//
// Born 21/08/2026 after a yellow card: a dev server was reported "up" measured from the
// assistant's own machine, not from the operator's seat, and operator decisions were handed
// out as homework in chat instead of on the shared board. The gate enforces the RITUAL; the
// truth is the screenshot taken in the operator's own browser.
//
// Three checks on the assistant's final message:
//   1. loopback links (localhost / 127.0.0.1 / 0.0.0.0)     -> never a delivery (always blocked)
//   2. house links (private IPs, *.local, *.workers.dev, configured hosts) -> require a
//      `delivery-receipt` ledger event for the same host:port within the receipt window.
//      Receipts are written by `scripts/nogra-delivery-receipt.mjs` ONLY when a fresh screenshot
//      file exists (the operator's browser, not the assistant's curl).
//   3. homework phrases (>= N occurrences) without a board reference (card id / artifact URL /
//      board host) -> "decisions belong on the board".
//
// Defaults are English and generic; a workspace extends them in .nogra/config.json:
//   "deliveryGate": { "enabled": true, "receiptWindowMinutes": 15, "homeworkMinOccurrences": 2,
//                     "hostPatterns": ["nogra-house(\\.local)?"], "homeworkPhrases": ["dit greb"],
//                     "boardRefPatterns": ["tavlen\\.y26\\.dev"] }
// Fail-open everywhere: any error -> no output, exit 0. Never loops: when stop_hook_active is
// already set the gate downgrades to a systemMessage.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const DEFAULT_GATE = Object.freeze({
  enabled: true,
  receiptWindowMinutes: 15,
  homeworkMinOccurrences: 2,
  hostPatterns: [
    "192\\.168\\.\\d{1,3}\\.\\d{1,3}",
    "10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
    "100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d{1,3}\\.\\d{1,3}",
    "[a-z0-9-]+\\.local",
    "[a-z0-9-]+\\.[a-z0-9-]+\\.ts\\.net",
    "[a-z0-9-]+(?:\\.[a-z0-9-]+)?\\.workers\\.dev"
  ],
  homeworkPhrases: [
    "your call", "your decision", "your hand", "ceo decision", "ceo's call",
    "let me know when", "when you say so", "tell me when", "you decide"
  ],
  boardRefPatterns: [
    "\\bcard_[a-f0-9]{12}\\b",
    "claude\\.ai/code/artifact/[0-9a-f-]{8,}"
  ]
});

const LOOPBACK_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:[/?#][^\s)>\]"']*)?/giu;
const URL_RE = /\bhttps?:\/\/[^\s)>\]"']+/giu;

export function cleanInline(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function findWorkspaceRoot(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    let cur = resolve(String(c));
    for (;;) {
      if (existsSync(join(cur, ".nogra", "config.json"))) return cur;
      const up = resolve(cur, "..");
      if (up === cur) break;
      cur = up;
    }
  }
  return "";
}

export function readGateConfig(root) {
  const config = readJson(join(root, ".nogra", "config.json")) || {};
  const gate = config.deliveryGate && typeof config.deliveryGate === "object" ? config.deliveryGate : {};
  const merge = (key) => [...DEFAULT_GATE[key], ...(Array.isArray(gate[key]) ? gate[key].map(String) : [])];
  return {
    enabled: gate.enabled !== false,
    receiptWindowMinutes: Number.isFinite(gate.receiptWindowMinutes) ? gate.receiptWindowMinutes : DEFAULT_GATE.receiptWindowMinutes,
    homeworkMinOccurrences: Number.isFinite(gate.homeworkMinOccurrences) ? gate.homeworkMinOccurrences : DEFAULT_GATE.homeworkMinOccurrences,
    hostPatterns: merge("hostPatterns"),
    homeworkPhrases: merge("homeworkPhrases"),
    boardRefPatterns: merge("boardRefPatterns"),
    workspaceId: cleanInline(config.workspaceId, 120) || "unknown"
  };
}

export function hostPort(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host, patterns) {
  const bare = host.replace(/:\d+$/u, "");
  return patterns.some((p) => {
    try { return new RegExp(`^(?:${p})$`, "iu").test(bare); } catch { return false; }
  });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function houseLinks(text, config) {
  const out = new Set();
  for (const m of String(text).match(URL_RE) || []) {
    const hp = hostPort(m);
    if (hp && hostMatches(hp, config.hostPatterns)) out.add(hp);
  }
  return [...out];
}

export function loopbackLinks(text) {
  return String(text).match(LOOPBACK_RE) || [];
}

export function homeworkHits(text, config) {
  const hits = [];
  const lower = String(text).toLowerCase();
  for (const phrase of config.homeworkPhrases) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase.toLowerCase())}(?![\\p{L}\\p{N}])`, "gu");
    const n = (lower.match(re) || []).length;
    for (let i = 0; i < n; i += 1) hits.push(phrase);
  }
  return hits;
}

export function hasBoardRef(text, config) {
  return config.boardRefPatterns.some((p) => {
    try { return new RegExp(p, "iu").test(String(text)); } catch { return false; }
  });
}

// Receipts: `delivery-receipt` events in the ledger within the window, keyed by host:port.
export function recentReceiptHosts(root, config, now = Date.now()) {
  const ledger = join(root, ".nogra", "ledger", "events.jsonl");
  if (!existsSync(ledger)) return new Set();
  const windowMs = config.receiptWindowMinutes * 60 * 1000;
  const hosts = new Set();
  let lines;
  try { lines = readFileSync(ledger, "utf8").split(/\r?\n/u); } catch { return hosts; }
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 600; i -= 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if ((e.eventType || e.type || e.event) !== "delivery-receipt") continue;
    const t = Date.parse(e.createdAt || e.ts || "");
    if (!Number.isFinite(t) || now - t > windowMs) continue;
    const url = cleanInline((e.metadata && e.metadata.url) || e.url || "");
    const hp = hostPort(url);
    if (hp) hosts.add(hp);
  }
  return hosts;
}

export function evaluate(text, { config, receiptHosts }) {
  const reasons = [];
  const loop = loopbackLinks(text);
  if (loop.length) {
    reasons.push(`loopback link (${loop.length}): ${loop[0]} — localhost is the assistant's machine, never a delivery; deliver the host form the operator can click, measured in THEIR browser.`);
  }
  const house = houseLinks(text, config);
  const missing = house.filter((hp) => !receiptHosts.has(hp));
  if (missing.length) {
    reasons.push(`house link without a delivery-receipt (< ${config.receiptWindowMinutes} min) for: ${missing.join(", ")} — take a screenshot in the operator's browser, run scripts/nogra-delivery-receipt.mjs <url> <screenshot>, then send the link.`);
  }
  const hits = homeworkHits(text, config);
  if (hits.length >= config.homeworkMinOccurrences && !hasBoardRef(text, config)) {
    const sample = [...new Set(hits)].slice(0, 4).join(", ");
    reasons.push(`operator homework in chat (${hits.length}: ${sample}) without a board reference — decisions belong on the board: create the card, then point at it.`);
  }
  return reasons;
}

export function appendGateEvent(root, config, { decision, reason, metadata }) {
  try {
    const ledger = join(root, ".nogra", "ledger", "events.jsonl");
    const when = new Date();
    const stamp = when.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const event = {
      schema: "nogra.event.v1",
      releaseVersion: "v1.0.0",
      eventId: `event-${stamp}-delivery-gate-${randomBytes(2).toString("hex")}`,
      createdAt: when.toISOString(),
      workspaceId: config.workspaceId,
      eventType: "delivery-gate",
      message: `${decision}: ${cleanInline(reason, 600)}`,
      briefId: "",
      runId: "",
      metadata: metadata || {},
      redactions: []
    };
    mkdirSync(dirname(ledger), { recursive: true });
    appendFileSync(ledger, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  } catch {
    return null;
  }
}

export function appendReceiptEvent(root, { url, screenshot, note, workspaceId }) {
  const ledger = join(root, ".nogra", "ledger", "events.jsonl");
  const when = new Date();
  const stamp = when.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const event = {
    schema: "nogra.event.v1",
    releaseVersion: "v1.0.0",
    eventId: `event-${stamp}-delivery-receipt-${randomBytes(2).toString("hex")}`,
    createdAt: when.toISOString(),
    workspaceId: workspaceId || "unknown",
    eventType: "delivery-receipt",
    message: `seen in the operator's browser: ${cleanInline(url, 300)} — screenshot ${cleanInline(screenshot, 300)}${note ? ` — ${cleanInline(note, 200)}` : ""}`,
    briefId: "",
    runId: "",
    metadata: { url: cleanInline(url, 300), screenshot: cleanInline(screenshot, 300), note: cleanInline(note, 200) },
    redactions: []
  };
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
