// Pace — the operator's tempo as state, not mood.
//
// The operator's own words set the pace mechanically: "slow down" -> SLOW, "full speed" -> NORMAL.
// State lives in .nogra/state/PACE.json and holds until the operator changes it (or the CLI does).
// While SLOW, the UserPromptSubmit hook injects ONE line per turn: one move per reply, short,
// no parallel bursts, ask before the next. Phrase lists are English by default; a workspace adds
// its own in .nogra/config.json: "pace": { "slowPhrases": [...], "normalPhrases": [...] }.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export const DEFAULT_PACE = Object.freeze({
  slowPhrases: ["slow down", "slooow down", "one move at a time", "one step at a time", "take it slow", "easy now"],
  normalPhrases: ["full speed", "free rein", "speed up", "normal pace", "pace normal", "back to normal"]
});

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function readPaceConfig(root) {
  const config = readJson(join(root, ".nogra", "config.json")) || {};
  const pace = config.pace && typeof config.pace === "object" ? config.pace : {};
  const merge = (key) => [...DEFAULT_PACE[key], ...(Array.isArray(pace[key]) ? pace[key].map(String) : [])];
  return { slowPhrases: merge("slowPhrases"), normalPhrases: merge("normalPhrases"), workspaceId: String(config.workspaceId || "unknown").slice(0, 120) };
}

export function paceFile(root) {
  return join(root, ".nogra", "state", "PACE.json");
}

export function readPace(root) {
  const rec = readJson(paceFile(root));
  return rec && (rec.pace === "slow" || rec.pace === "normal") ? rec : { pace: "normal" };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches a phrase as words; tolerates stretched vowels ("slooooow down").
export function matchPhrase(text, phrases) {
  const t = String(text).toLowerCase();
  for (const p of phrases) {
    const pattern = escapeRe(p.toLowerCase()).replace(/([aeiouyæøå])/gu, "$1+").replace(/\\ /g, "\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u");
    const m = t.match(re);
    if (m) return m[0];
  }
  return "";
}

export function writePace(root, pace, setBy, quote, workspaceId) {
  const file = paceFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const when = new Date();
  const rec = { schema: "nogra.pace.v1", pace, setBy: String(setBy || "").slice(0, 80), setAt: when.toISOString(), quote: String(quote || "").slice(0, 160) };
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  try {
    const ledger = join(root, ".nogra", "ledger", "events.jsonl");
    mkdirSync(dirname(ledger), { recursive: true });
    const stamp = when.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    appendFileSync(ledger, `${JSON.stringify({
      schema: "nogra.event.v1", releaseVersion: "v1.0.0",
      eventId: `event-${stamp}-pace-${pace}-${randomBytes(2).toString("hex")}`,
      createdAt: rec.setAt, workspaceId: workspaceId || "unknown",
      eventType: `pace-${pace}`, message: `PACE ${pace.toUpperCase()} set by ${rec.setBy}: "${rec.quote}"`,
      briefId: "", runId: "", metadata: { pace, setBy: rec.setBy }, redactions: []
    })}\n`, "utf8");
  } catch {
    // the pace file is the state; the ledger line is an audit convenience
  }
  return rec;
}

export function renderPaceContext(rec) {
  return `<NOGRA_PACE>PACE: SLOW (set ${rec.setAt || "?"} by ${rec.setBy || "?"}: "${rec.quote || ""}"). One move per reply · keep it short (<= 8 lines) · no parallel bursts · report, ask, wait. Lifted only by the operator ("full speed" / "normal pace") or scripts/nogra-pace.mjs normal.</NOGRA_PACE>`;
}
