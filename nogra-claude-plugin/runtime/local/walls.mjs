// Walls — "a blocker is a lookup before it is a diagnosis."
//
// Operational walls (a flagged login callback, an expired door, a denied domain) tend to live
// only in the ledger, where they are found again at full price by the next session. This module
// makes the lookup mechanical: extract the symptom's terms, search the ledger for earlier events
// that carry them, surface the latest matches — and keep a small projection of OPEN walls
// (.nogra/state/WALLS.md) that the ground step and the post-compact pointer can pin.
//
// Generic on purpose: no workspace vocabulary here. Workspaces extend signal patterns in
// .nogra/config.json → { "walls": { "signalPatterns": [...], "enabled": true } }.

import fs from "node:fs";
import path from "node:path";
import { cleanInline, findWorkspaceRoot, readJson } from "./delivery-gate.mjs";

export { findWorkspaceRoot };

export const DEFAULT_WALLS = Object.freeze({
  enabled: true,
  // Signals that a message or tool result describes a wall. English defaults; workspaces extend.
  signalPatterns: [
    "\\berror page\\b", "\\bsecurity error\\b", "\\bcannot attach\\b", "\\bnot allowed\\b",
    "\\bpermission denied\\b", "\\bdenied\\b", "\\bblocked\\b", "\\bforbidden\\b", "\\bunauthori[sz]ed\\b",
    "\\btimed? ?out\\b", "\\b(?:401|403|404|407|429|5\\d\\d)\\b", "\\bECONN\\w*\\b", "\\bconnection (?:refused|reset|lost)\\b",
    "\\bno longer exists\\b", "\\bfailed\\b", "\\bnot found\\b", "\\bdisconnected\\b", "\\bcaptcha\\b"
  ],
  // Strong signals only: used for PostToolUse (successful tool results), where generic words like
  // "failed"/"404"/"not found" appear in ordinary output (logs, SQL, ledger reads) and would recall on noise.
  strongSignalPatterns: [
    "\\berror page\\b", "\\bsecurity error\\b", "\\bcannot attach\\b", "\\bpermission denied\\b",
    "\\bforbidden\\b", "\\bunauthori[sz]ed\\b", "\\bECONN\\w*\\b", "\\bconnection (?:refused|reset|lost)\\b",
    "\\bcaptcha\\b", "\\bdangerous site\\b", "\\baccess denied\\b", "\\bnot allowed\\b"
  ],
  maxMatches: 3,
  lookbackDays: 60,
  repeatThreshold: 2,
  minTermHits: 3
});

const STOP = new Set(("the a an and or of to in on at for with from by is are was were be been this that these those it its as "
  + "into onto over under not no yes via per de det den der som og i på til af for med er var en et de vi du jeg han hun "
  + "action actions tool tools result output error errors failed failure exit code status ok true false null undefined "
  + "http https www com dk dev html json id tab tabs page frame showing call calls remaining completed "
  // tool-/house-generic tokens that say nothing about a symptom (names, UI verbs, harness words):
  + "users patricklarsen y26dev projects inbox ledger events jsonl nogra fable computer left_click screenshot captured "
  + "successfully executed element elements matching found reference removed accessibility subsection interrupted "
  + "nooutputexpected returncodeinterpretation isimage matches tabid navigate navigated wait seconds returned context "
  + "available title href generic button link option options listbox combobox heading menu menuitem textbox dropdown "
  + "input query tree select click clicked type typed scroll scrolled drag dragged pressed keys chrome browser window "
  + "viewport boligscout katrine kilde kilden vores prod fabrik worker workers script brormand champ chef").split(/\s+/));

export function readWallsConfig(root) {
  const cfg = readJson(path.join(root, ".nogra", "config.json")) || {};
  const w = cfg.walls || {};
  return {
    ...DEFAULT_WALLS,
    ...w,
    signalPatterns: [...DEFAULT_WALLS.signalPatterns, ...(Array.isArray(w.signalPatterns) ? w.signalPatterns : [])],
    workspaceId: cfg.workspaceId || "workspace"
  };
}

export function hasWallSignal(text, config = DEFAULT_WALLS, { strong = false } = {}) {
  const t = String(text || "");
  const pats = strong ? (config.strongSignalPatterns || DEFAULT_WALLS.strongSignalPatterns) : config.signalPatterns;
  return pats.some((p) => { try { return new RegExp(p, "iu").test(t); } catch { return false; } });
}

/** Terms worth searching for: words >= 4 chars (not stopwords), URL paths, status codes, quoted phrases. */
export function symptomTerms(text, max = 12) {
  // Tool results often arrive JSON-stringified: turn literal \n / \t / \" back into separators first.
  const t = String(text || "").replace(/\\[ntr]/g, " ").replace(/\\"/g, " ");
  const terms = new Set();
  for (const m of t.matchAll(/\/[a-z0-9_./-]{4,}/giu)) terms.add(m[0].toLowerCase());
  for (const m of t.matchAll(/\b(?:40[0-9]|429|5\d\d)\b/gu)) terms.add(m[0]);
  for (const m of t.matchAll(/[\p{L}][\p{L}\p{N}_-]{3,}/gu)) {
    const w = m[0].toLowerCase();
    if (!STOP.has(w) && !/^\d+$/u.test(w)) terms.add(w);
  }
  return [...terms].slice(0, max * 3).sort((a, b) => b.length - a.length).slice(0, max);
}

export function readLedgerEvents(root) {
  const file = path.join(root, ".nogra", "ledger", "events.jsonl");
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = line.trim(); if (!s) continue;
    let e; try { e = JSON.parse(s); } catch { continue; }
    const ts = e.createdAt || e.ts || e.timestamp || "";
    const type = e.eventType || e.event || e.type || "";
    const text = [e.message, e.details, e.summary, e.reason].filter(Boolean).join(" ");
    out.push({ ts, type, text, raw: e });
  }
  return out;
}

function daysAgo(ts, now) {
  const d = Date.parse(ts); if (Number.isNaN(d)) return Infinity;
  return (now - d) / 86400000;
}

/** Rank earlier events by how many symptom terms they carry. Wall events win ties and get a boost. */
export function matchWalls(root, text, { config = DEFAULT_WALLS, now = Date.now() } = {}) {
  const terms = symptomTerms(text);
  if (terms.length === 0) return { terms, matches: [], repeats: 0 };
  const events = readLedgerEvents(root);
  const scored = [];
  for (const ev of events) {
    if (daysAgo(ev.ts, now) > (config.lookbackDays || 60)) continue;
    const hay = (ev.text + " " + ev.type).toLowerCase();
    let hits = 0; const hitTerms = [];
    for (const term of terms) if (hay.includes(term)) { hits += 1; hitTerms.push(term); }
    if (hits < (config.minTermHits || 2)) continue;
    const isWall = ev.type === "wall";
    scored.push({ ev, score: hits + (isWall ? 2 : 0), hitTerms, isWall });
  }
  scored.sort((a, b) => b.score - a.score || (b.ev.ts > a.ev.ts ? 1 : -1));
  const matches = scored.slice(0, config.maxMatches || 3).map((m) => ({
    ts: m.ev.ts, type: m.ev.type, isWall: m.isWall, terms: m.hitTerms,
    text: cleanInline(m.ev.text, 320)
  }));
  const repeats = scored.filter((m) => !m.isWall).length;
  const hasWallRecord = scored.some((m) => m.isWall);
  return { terms, matches, repeats, hasWallRecord };
}

export function appendLedger(root, event) {
  const file = path.join(root, ".nogra", "ledger", "events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export function recordWall(root, { symptom, cause = "", cureNow = "", whoClicks = "", durableFix = "", status = "open", ref = "", workspaceId = "workspace", source = "scripts/nogra-wall.mjs" }) {
  const now = new Date().toISOString();
  const id = `wall-${now.replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
  const event = {
    schema: "nogra.event.v1", releaseVersion: "v1.0.0", eventId: id, createdAt: now, workspaceId,
    eventType: "wall", source,
    message: `WALL (${status}): ${cleanInline(symptom, 200)} — cause: ${cleanInline(cause, 200)} — cure now: ${cleanInline(cureNow, 200)} — who clicks: ${cleanInline(whoClicks, 80)} — durable fix: ${cleanInline(durableFix, 200)}${ref ? ` — ref: ${cleanInline(ref, 120)}` : ""}`,
    metadata: { wall: { symptom, cause, cureNow, whoClicks, durableFix, status, ref } },
    briefId: "", runId: "", redactions: []
  };
  appendLedger(root, event);
  projectWalls(root);
  return event;
}

/** Open walls = latest wall event per symptom whose status is not closed. */
export function openWalls(root) {
  const bySymptom = new Map();
  for (const ev of readLedgerEvents(root)) {
    if (ev.type !== "wall") continue;
    const w = ev.raw?.metadata?.wall; if (!w || !w.symptom) continue;
    bySymptom.set(w.symptom.toLowerCase(), { ts: ev.ts, ...w });
  }
  return [...bySymptom.values()].filter((w) => w.status !== "closed").sort((a, b) => (b.ts > a.ts ? 1 : -1));
}

export function projectWalls(root) {
  const walls = openWalls(root);
  const lines = ["# WALLS — open operational walls (projection of `wall` events; the ledger wins)", ""];
  if (walls.length === 0) lines.push("_none open_");
  for (const w of walls) {
    lines.push(`- **${w.symptom}** (${w.ts.slice(0, 16)}) — cause: ${w.cause || "?"} · cure now: ${w.cureNow || "?"} · who clicks: ${w.whoClicks || "?"} · durable fix: ${w.durableFix || "?"}${w.ref ? ` · ref: ${w.ref}` : ""}`);
  }
  lines.push("", "_Rule: a blocker is a lookup before it is a diagnosis — run `nogra-wall match \"<symptom>\"` before acting on one._");
  const file = path.join(root, ".nogra", "state", "WALLS.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

/** The context block the hooks inject. Returns "" when there is nothing worth saying. */
export function recallBlock(root, text, { config = DEFAULT_WALLS, now = Date.now(), strong = false } = {}) {
  if (!hasWallSignal(text, config, { strong })) return "";
  const { matches, repeats, hasWallRecord, terms } = matchWalls(root, text, { config, now });
  if (matches.length === 0 && repeats === 0) return "";
  const out = ["<NOGRA_WALL_RECALL>", "A blocker is a lookup before it is a diagnosis. The ledger has seen this symptom before:"];
  for (const m of matches) out.push(`- ${m.ts.slice(0, 16)} · ${m.isWall ? "WALL" : m.type} · ${m.text}`);
  if (!hasWallRecord && repeats >= (config.repeatThreshold || 2)) {
    out.push(`- NAG: ${repeats} earlier hits and no recorded wall — record it: nogra-wall record --symptom "..." --cause "..." --cure "..." --who "..." --durable "..."`);
  }
  out.push(`terms: ${terms.slice(0, 8).join(", ")}`, "</NOGRA_WALL_RECALL>");
  return out.join("\n");
}
