// Nogra brain valve — the smoke alarm for Claude Code's native auto-memory.
//
// The write-loop is the sprinkler; this is only the VALVE that says WHEN. At SessionEnd it MEASURES
// the memory window and, when the measurement is over the margin, appends ONE `consolidation_due`
// event to the workspace ledger and drops ONE line in `inbox/out/`. It never consolidates, never
// asks, never blocks teardown (SessionEnd hooks share a 1.5 s budget) — it states what it measured.
//
// The window is dom 34 (23/08/2026, matched against the platform docs): Claude Code loads at most
// the first 200 lines / 25 KB of MEMORY.md, so the house window is MEMORY.md <= 200 lines /
// <= 25 KB with the alarm margin at 150 lines / 15 KB, plus the house's own checkpoint window
// (project_checkpoint.md <= 150 lines). File count is free.
//
// Line counts use `wc -l` semantics (number of newline characters) so any number printed from here
// can be checked by hand with `wc -l` and match.
//
// The ledger door is `appendLedger` from walls.mjs — the same door hooks/task-deleted.mjs uses.
// The `nogra.event.v1` shape carries no watermark, so nothing here guesses one.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveNativeMemory } from "./native-memory.mjs";
import { appendLedger } from "./walls.mjs";

export const MEMORY_WINDOW = Object.freeze({
  indexLines: 200,
  indexBytes: 25000, // platformens spliceCap (2.1.251: GF=25000) — ikke 25*1024 (dom 73, 2a)
  entryChars: 200,   // platformen: "Keep index entries to one line under ~200 chars" (dom 73, 2a)
  marginLines: 150,
  marginBytes: 15 * 1024,
  checkpointLines: 150
});

/** Today's `consolidation_due`, if any, is at the very end of the ledger — a tail read is enough. */
const LEDGER_TAIL_BYTES = 512 * 1024;

/** Events that answer an open `consolidation_due`. `consolidation_done` is the pre-plugin name. */
export const CONSOLIDATION_ANSWER_TYPES = Object.freeze(["brain-consolidated", "consolidation_done"]);

export function ledgerFile(root) {
  return path.join(root, ".nogra", "ledger", "events.jsonl");
}

/** `wc -l` semantics: the number of newline characters, so printed numbers survive a hand-check. */
export function countLines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return count;
}

/** Ledger timestamps arrive as ISO-Z and as `+0200` offsets; compare on epoch, never on strings. */
export function tsValue(ts) {
  const raw = String(ts || "");
  if (!raw) return 0;
  let value = Date.parse(raw);
  if (Number.isNaN(value)) value = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/u, "$1:$2"));
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Read ledger events, optionally only the tail and only the named types.
 * Returns `{ type, ts, raw }` with the type normalized across every shape the ledger carries
 * (`eventType` from the plugin, `event`/`type` from the older house scripts).
 */
export function scanLedger(root, { types = null, tailBytes = 0 } = {}) {
  const file = ledgerFile(root);
  let text = "";
  try {
    const size = fs.statSync(file).size;
    if (tailBytes > 0 && size > tailBytes) {
      const handle = fs.openSync(file, "r");
      try {
        // Review-fund 24/08 (LOW): allocUnsafe + ignoreret bytesRead kunne dekode uinitialiseret
        // heap som ledger-linjer ved kort laesning (fil roteret/trunkeret mellem stat og read).
        const buffer = Buffer.alloc(tailBytes);
        const bytesRead = fs.readSync(handle, buffer, 0, tailBytes, size - tailBytes);
        text = buffer.toString("utf8", 0, bytesRead);
        const firstBreak = text.indexOf("\n");
        text = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
      } finally {
        fs.closeSync(handle);
      }
    } else {
      text = fs.readFileSync(file, "utf8");
    }
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    // Cheap pre-filter so a 1.7 MB ledger is not fully parsed for three event types.
    if (types && !types.some((type) => trimmed.includes(`"${type}"`))) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = event.eventType || event.event || event.type || "";
    if (types && !types.includes(type)) continue;
    out.push({ type, ts: event.createdAt || event.ts || event.generatedAt || "", raw: event });
  }
  return out;
}

export function readWorkspaceId(root) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, ".nogra", "config.json"), "utf8"));
    const id = String(config?.workspaceId || "").trim();
    return id || "unknown";
  } catch {
    return "unknown";
  }
}

/** Measure the native auto-memory window. Read-only; never mutates memory. */
export function measureMemory({ root, hookInput = {}, env = process.env } = {}) {
  const base = {
    status: "unresolved",
    dir: "",
    files: 0,
    indexExists: false,
    indexLines: 0,
    indexBytes: 0,
    checkpointExists: false,
    checkpointLines: 0,
    userBytes: 0,
    largest: null
  };
  let resolution;
  try {
    resolution = resolveNativeMemory({ projectDir: root, hookInput, env });
  } catch {
    return base;
  }
  if (resolution.status !== "resolved") return { ...base, status: resolution.status };
  const dir = resolution.resolvedDirectory;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return { ...base, status: "absent", dir };
  }
  let largest = null;
  for (const name of names) {
    try {
      const bytes = fs.statSync(path.join(dir, name)).size;
      if (!largest || bytes > largest.bytes) largest = { name, bytes };
    } catch {
      // an unreadable file is not a measurement; skip it rather than invent a size
    }
  }
  const read = (name) => {
    try {
      return fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      return null;
    }
  };
  const index = read("MEMORY.md");
  const checkpoint = read("project_checkpoint.md");
  const user = read("USER.md");
  return {
    status: "resolved",
    dir,
    files: names.length,
    indexExists: index !== null,
    indexLines: index === null ? 0 : countLines(index),
    indexBytes: index === null ? 0 : Buffer.byteLength(index),
    indexLongestEntry: index === null ? 0 : Math.max(0, ...index.split("\n").map((l) => l.length)),
    indexEntriesOver: index === null ? 0 : index.split("\n").filter((l) => l.length > MEMORY_WINDOW.entryChars).length,
    checkpointExists: checkpoint !== null,
    checkpointLines: checkpoint === null ? 0 : countLines(checkpoint),
    userBytes: user === null ? 0 : Buffer.byteLength(user),
    largest
  };
}

/** Reasons the measurement is past the ALARM margin (the early line, not the hard window). */
export function marginBreaches(measurement, window = MEMORY_WINDOW) {
  const out = [];
  if (measurement.indexLines > window.marginLines) {
    out.push(`MEMORY.md ${measurement.indexLines} lines > margin ${window.marginLines}`);
  }
  if (measurement.indexBytes > window.marginBytes) {
    out.push(`MEMORY.md ${measurement.indexBytes} bytes > margin ${window.marginBytes}`);
  }
  if (measurement.checkpointLines > window.checkpointLines) {
    out.push(`project_checkpoint.md ${measurement.checkpointLines} lines > ${window.checkpointLines}`);
  }
  return out;
}

/** Reasons the measurement is past the HARD load window Claude Code actually enforces. */
export function windowBreaches(measurement, window = MEMORY_WINDOW) {
  const out = [];
  if (measurement.indexLines > window.indexLines) out.push(`MEMORY.md ${measurement.indexLines} lines > ${window.indexLines}`);
  if (measurement.indexBytes > window.indexBytes) out.push(`MEMORY.md ${measurement.indexBytes} bytes > ${window.indexBytes}`);
  if ((measurement.indexEntriesOver ?? 0) > 0) out.push(`MEMORY.md ${measurement.indexEntriesOver} entries > ${MEMORY_WINDOW.entryChars} chars (longest ${measurement.indexLongestEntry}) — the platform truncates long entries`);
  return out;
}

export function localDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One alarm per workspace per day: look for today's `consolidation_due` in the ledger tail. */
export function dueLoggedOn(root, day) {
  return scanLedger(root, { types: ["consolidation_due"], tailBytes: LEDGER_TAIL_BYTES })
    .some((event) => (event.raw?.metadata?.day || String(event.ts).slice(0, 10)) === day);
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1);
}

/**
 * The valve itself. Returns what it did; throws nothing.
 * `{ fired, reason, measurement, event, note }`
 */
export function runValve({ root, hookInput = {}, env = process.env, now = new Date(), window = MEMORY_WINDOW } = {}) {
  const result = { fired: false, reason: "", measurement: null, event: null, note: "" };
  try {
    if (!root) {
      result.reason = "no-workspace";
      return result;
    }
    const measurement = measureMemory({ root, hookInput, env });
    result.measurement = measurement;
    if (measurement.status !== "resolved" || !measurement.indexExists) {
      result.reason = `memory-${measurement.status === "resolved" ? "no-index" : measurement.status}`;
      return result;
    }
    const breaches = marginBreaches(measurement, window);
    if (breaches.length === 0) {
      result.reason = "within-margin";
      return result;
    }
    const day = localDay(now);
    if (dueLoggedOn(root, day)) {
      result.reason = "already-due-today";
      return result;
    }
    const stamp = now.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
    const event = {
      schema: "nogra.event.v1",
      releaseVersion: "v1.0.0",
      eventId: `event-${stamp}-consolidation-due-${randomBytes(2).toString("hex")}`,
      createdAt: now.toISOString(),
      workspaceId: readWorkspaceId(root),
      eventType: "consolidation_due",
      source: "hooks/session-end.mjs",
      message:
        `consolidation_due: MEMORY.md ${measurement.indexLines} lines / ${kb(measurement.indexBytes)} KB ` +
        `(window ${window.indexLines} lines / ${kb(window.indexBytes)} KB, margin ${window.marginLines} / ${kb(window.marginBytes)} KB) · ` +
        `project_checkpoint.md ${measurement.checkpointLines} lines (window ${window.checkpointLines}) · ` +
        `${measurement.files} files — ${breaches.join(" · ")}`,
      metadata: {
        day,
        memoryDir: measurement.dir,
        files: measurement.files,
        indexLines: measurement.indexLines,
        indexBytes: measurement.indexBytes,
        checkpointLines: measurement.checkpointLines,
        userBytes: measurement.userBytes,
        largestFile: measurement.largest?.name || "",
        largestBytes: measurement.largest?.bytes || 0,
        window: { ...window }
      },
      briefId: "",
      runId: "",
      redactions: []
    };
    appendLedger(root, event);

    const outDir = path.join(root, "inbox", "out");
    fs.mkdirSync(outDir, { recursive: true });
    const notePath = path.join(outDir, `consolidation-due-${day}.md`);
    const note =
      `⚠ Konsolidering forfalden ${day} — MEMORY.md ${measurement.indexLines} linjer / ${kb(measurement.indexBytes)} KB ` +
      `(vindue ${window.indexLines} / ${kb(window.indexBytes)} KB · margin ${window.marginLines} / ${kb(window.marginBytes)} KB) · ` +
      `project_checkpoint.md ${measurement.checkpointLines} linjer (vindue ${window.checkpointLines}) · ` +
      `${measurement.files} filer i memory. Tilbyd \`/nogra:brain consolidate\` — konsolidering kræver operatørens GO (uret: consolidation_due).\n`;
    fs.writeFileSync(notePath, note, "utf8");

    result.fired = true;
    result.reason = "over-margin";
    result.event = event;
    result.note = notePath;
    return result;
  } catch (error) {
    // Fail-open: the alarm is never allowed to hold the door on the way out.
    result.reason = `error:${error?.message || "unknown"}`;
    return result;
  }
}

/** The newest `consolidation_due` that no consolidation receipt has answered yet, or null. */
export function pendingConsolidation(root) {
  const events = scanLedger(root, { types: ["consolidation_due", ...CONSOLIDATION_ANSWER_TYPES] });
  let due = null;
  let answered = 0;
  for (const event of events) {
    if (event.type === "consolidation_due") {
      if (!due || tsValue(event.ts) > tsValue(due.ts)) due = event;
    } else if (tsValue(event.ts) > answered) {
      answered = tsValue(event.ts);
    }
  }
  if (!due) return null;
  if (answered && answered >= tsValue(due.ts)) return null;
  return due;
}

/**
 * ONE line for SessionStart: what the valve measured and when. It states, it never asks.
 * Empty string when nothing is due — silence is the normal state.
 */
export function consolidationDueLine(root, { hookInput = {}, env = process.env } = {}) {
  try {
    const due = pendingConsolidation(root);
    if (!due) return "";
    const meta = due.raw?.metadata || {};
    let lines = Number(meta.indexLines) || 0;
    let bytes = Number(meta.indexBytes) || 0;
    if (!lines || !bytes) {
      // Pre-plugin `consolidation_due` events carry total bytes/files, not the index window.
      const measurement = measureMemory({ root, hookInput, env });
      lines = lines || measurement.indexLines;
      bytes = bytes || measurement.indexBytes;
    }
    const date = meta.day || String(due.ts).slice(0, 10);
    return `⚠ consolidation due since ${date}: MEMORY.md ${lines} lines / ${kb(bytes)} KB — offer /nogra:brain consolidate`;
  } catch {
    return "";
  }
}
