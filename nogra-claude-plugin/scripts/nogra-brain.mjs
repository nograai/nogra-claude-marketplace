#!/usr/bin/env node
// nogra-brain — the braincheck behind `/nogra:brain`.
//
//   node scripts/nogra-brain.mjs status [--root <dir>] [--json] [--no-event]
//   node scripts/nogra-brain.mjs line   [--root <dir>]                 (one line for /nogra:status)
//   node scripts/nogra-brain.mjs consolidated --receipt <path> [--memory-dir <dir>] [--root <dir>]
//   node scripts/nogra-brain.mjs mark <raw-file> [note] [--root <dir>]
//   node scripts/nogra-brain.mjs stamp "<line>" [--root <dir>]
//
// `status` MEASURES four things and prints at most 12 lines plus one verdict: the native memory
// window (dom 34), the brain vault's distance behind the ledger, the valve's last word, and whether
// the drawings registry keeps up. It writes a `brain-status` event carrying the numbers only.
//
// `mark` and `stamp` are the house's `bin/brain-run mark|stamp` moved under the plugin roof: the
// sidecar `brain/raw/.ingested.tsv` stays the marker home (raw is byte-immutable) and a compilation
// is receipted in the ledger as `brain-compiled` with `metadata.watermark`, mirrored in brain/log.md.
//
// This measures and offers. It never consolidates, never compiles, never edits memory, never reads
// a transcript. Consolidation needs the operator's GO and is dispatched by the Manager.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MEMORY_WINDOW,
  countLines,
  ledgerFile,
  marginBreaches,
  measureMemory,
  pendingConsolidation,
  readWorkspaceId,
  scanLedger,
  tsValue,
  windowBreaches
} from "../runtime/local/brain-valve.mjs";
import { appendLedger, findWorkspaceRoot } from "../runtime/local/walls.mjs";
import { lastBound } from "./paper-bind.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_STATUS_LINES = 12;

// ---------------------------------------------------------------------------- small measurements

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
}

function day(ts) {
  const value = tsValue(ts);
  if (!value) return "-";
  return new Date(value).toISOString().slice(0, 10);
}

function daysSince(ts, now = Date.now()) {
  const value = tsValue(ts);
  if (!value) return null;
  return Math.floor((now - value) / 86400000);
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function ledgerLines(root) {
  const text = readText(ledgerFile(root));
  return text === null ? 0 : countLines(text);
}

/** Newest `memory/archive/consolidation-run-<n>-<date>.md`: run number, date, and ⚠-carrying lines. */
function lastConsolidationReceipt(memoryDir) {
  const dir = path.join(memoryDir, "archive");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => /^consolidation-run-.*\.md$/u.test(name));
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    const match = name.match(/^consolidation-run-(\d+)-(\d{4}-\d{2}-\d{2})/u);
    const run = match ? Number(match[1]) : -1;
    const date = match ? match[2] : "";
    if (!best || run > best.run || (run === best.run && date > best.date)) best = { name, run, date };
  }
  if (!best) return null;
  const text = readText(path.join(dir, best.name));
  const warnings = text === null ? null : text.split("\n").filter((line) => line.includes("⚠")).length;
  return { ...best, warnings };
}

/** brain/raw files carrying no INGESTED marker — sidecar first, then inline, exactly as brain-run. */
function measureBrain(root) {
  const brainDir = path.join(root, "brain");
  const rawDir = path.join(brainDir, "raw");
  if (!fs.existsSync(rawDir)) return { exists: false, total: 0, unmarked: 0 };
  let names = [];
  try {
    names = fs.readdirSync(rawDir).filter((name) => name.endsWith(".md") || name.endsWith(".txt"));
  } catch {
    return { exists: false, total: 0, unmarked: 0 };
  }
  const sidecar = new Set();
  const sidecarText = readText(path.join(rawDir, ".ingested.tsv"));
  if (sidecarText !== null) {
    for (const line of sidecarText.split("\n")) {
      const name = line.split("\t")[0].trim();
      if (name) sidecar.add(name);
    }
  }
  let unmarked = 0;
  for (const name of names) {
    if (sidecar.has(name)) continue;
    const text = readText(path.join(rawDir, name));
    if (text !== null && text.includes("INGESTED")) continue;
    unmarked += 1;
  }
  return { exists: true, total: names.length, unmarked };
}

/** Is the valve actually wired in THIS plugin (hooks.json SessionEnd -> session-end.mjs -> valve)? */
function valveWired() {
  const hooks = readText(path.join(PLUGIN_ROOT, "hooks", "hooks.json"));
  const sessionEnd = readText(path.join(PLUGIN_ROOT, "hooks", "session-end.mjs"));
  if (hooks === null || sessionEnd === null) return false;
  let parsed;
  try {
    parsed = JSON.parse(hooks);
  } catch {
    return false;
  }
  const wired = JSON.stringify(parsed?.hooks?.SessionEnd ?? []).includes("session-end.mjs");
  return wired && sessionEnd.includes("brain-valve.mjs");
}

/** drawings/index.md vs the newest drawing beside it — does the registry keep up? */
function measureDrawings(root) {
  for (const name of ["drawings", "tegninger"]) {
    const dir = path.join(root, name);
    const index = path.join(dir, "index.md");
    if (!fs.existsSync(index)) continue;
    let indexMtime = 0;
    try {
      indexMtime = fs.statSync(index).mtimeMs;
    } catch {
      continue;
    }
    let newest = null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry === "index.md" || entry.startsWith(".")) continue;
      try {
        const stat = fs.statSync(path.join(dir, entry));
        if (!stat.isFile()) continue;
        if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { name: entry, mtimeMs: stat.mtimeMs };
      } catch {
        // an unreadable entry is not a measurement
      }
    }
    return { dir: name, indexMtime, newest, lagging: Boolean(newest && newest.mtimeMs > indexMtime) };
  }
  return null;
}

// -------------------------------------------------------------------------------------- status

function collect(root) {
  const memory = measureMemory({ root });
  const receipt = memory.dir ? lastConsolidationReceipt(memory.dir) : null;
  const brain = measureBrain(root);
  const compiled = scanLedger(root, { types: ["brain-compiled"] })
    .sort((left, right) => tsValue(left.ts) - tsValue(right.ts))
    .pop() || null;
  const dueEvents = scanLedger(root, { types: ["consolidation_due"] })
    .sort((left, right) => tsValue(left.ts) - tsValue(right.ts));
  const lastDue = dueEvents.length ? dueEvents[dueEvents.length - 1] : null;
  return {
    root,
    workspaceId: readWorkspaceId(root),
    memory,
    receipt,
    brain,
    compiled,
    ledgerLines: ledgerLines(root),
    lastDue,
    pending: pendingConsolidation(root),
    valveWired: valveWired(),
    drawings: measureDrawings(root),
    margin: marginBreaches(memory),
    window: windowBreaches(memory)
  };
}

function renderStatus(facts) {
  const { memory, brain, compiled, receipt, drawings } = facts;
  const lines = [`brain · ${facts.workspaceId} · ${stamp()}`];

  if (memory.status !== "resolved") {
    lines.push(`memory: kunne ikke opløses (${memory.status}) — ingen måling, ingen dom`);
  } else {
    lines.push(
      `memory: ${memory.files} filer · MEMORY.md ${memory.indexLines} linjer / ${kb(memory.indexBytes)} ` +
        `(vindue ${MEMORY_WINDOW.indexLines} / ${kb(MEMORY_WINDOW.indexBytes)} · margin ${MEMORY_WINDOW.marginLines} / ${kb(MEMORY_WINDOW.marginBytes)})`
    );
    lines.push(
      `memory: største ${memory.largest?.name || "-"} ${memory.largest ? kb(memory.largest.bytes) : "-"} · ` +
        `checkpoint ${memory.checkpointLines} linjer (vindue ${MEMORY_WINDOW.checkpointLines}) · USER.md ${memory.userBytes} B`
    );
    lines.push(
      receipt
        ? `memory: sidste konsolidering run ${receipt.run} (${receipt.date}) · ${receipt.warnings === null ? "?" : receipt.warnings} linjer med ⚠ i receipten`
        : "memory: ingen konsolidator-receipt i archive/"
    );
  }

  if (!brain.exists) {
    lines.push("brain: ingen brain/raw i dette workspace (`/nogra:brain init` scaffolder den)");
  } else {
    const behind = compiled ? daysSince(compiled.ts) : null;
    lines.push(
      `brain: ${brain.unmarked} af ${brain.total} raw uden INGESTED-markør · ` +
        (compiled
          ? `sidste brain-compiled wm ${compiled.raw?.metadata?.watermark ?? "-"} (${day(compiled.ts)}, ${behind} dage bag) · uret ${facts.ledgerLines} linjer`
          : `ingen brain-compiled i uret · uret ${facts.ledgerLines} linjer`)
    );
  }

  lines.push(
    `ventil: ${facts.lastDue
      ? `seneste consolidation_due ${day(facts.lastDue.ts)} · ${facts.pending ? "UBESVARET" : "besvaret"}`
      : "ingen consolidation_due i uret"} · ` +
      `plugin-hook ${facts.valveWired ? "koblet" : "IKKE koblet"} (hooks/session-end.mjs)`
  );

  if (drawings) {
    lines.push(
      `tegninger: ${drawings.dir}/index.md ${stamp(new Date(drawings.indexMtime))} · ` +
        `nyeste ${drawings.newest ? `${drawings.newest.name} ${stamp(new Date(drawings.newest.mtimeMs))}` : "-"} — ` +
        `${drawings.lagging ? "registret HALTER" : "registret følger med"}`
    );
  }

  const verdict = facts.window.length > 0
    ? `DOM: OVER VINDUET (${facts.window.join(" · ")}) → tilbyd \`/nogra:brain consolidate\``
    : facts.margin.length > 0
      ? `DOM: over margin (${facts.margin.join(" · ")}) → tilbyd \`/nogra:brain consolidate\``
      : `DOM: inden for vinduet (margin ${MEMORY_WINDOW.marginLines} linjer / ${kb(MEMORY_WINDOW.marginBytes)})`;

  // The board is a measurement, never a lecture: hard-cap the body, the verdict always survives.
  return [...lines.slice(0, MAX_STATUS_LINES - 1), verdict];
}

// ---------------------------------------------------------------- the consolidation receipt

/** Danish thousands separators: `9.259 B` is 9259 bytes, not 9.259. */
function danishInt(value) {
  const match = String(value).match(/\d[\d.]*/u);
  return match ? Number(match[0].replaceAll(".", "")) : null;
}

function bytesIn(cell) {
  const match = String(cell).match(/([\d.]+)\s*B\b/u);
  return match ? Number(match[1].replaceAll(".", "")) : null;
}

/**
 * Read a consolidator receipt. The run number and date come from the FILENAME (authoritative);
 * before/after numbers are lifted from the `Målt FØR → EFTER` table when it is there. A number
 * that cannot be read stays null — the footer prints `?` rather than inventing one.
 */
export function parseReceipt(file) {
  const name = path.basename(file);
  const fromName = name.match(/^consolidation-run-(\d+)-(\d{4}-\d{2}-\d{2})/u);
  const text = readText(file);
  if (text === null) return null;
  const heading = text.match(/^#\s*Consolidation run\s*(\d+)\s*[—-]\s*(\d{4}-\d{2}-\d{2})/mu);
  const run = Number(fromName?.[1] ?? heading?.[1] ?? 0) || null;
  const date = fromName?.[2] || heading?.[2] || "";

  let filesBefore = null;
  let filesAfter = null;
  let indexBytes = null;
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const label = cells[1];
    if (/filer/iu.test(label) && !/archive/iu.test(label) && filesBefore === null) {
      filesBefore = danishInt(cells[2]);
      filesAfter = danishInt(cells[3]);
    }
    // The label must BE MEMORY.md — a row like "bytes, ekskl. MEMORY.md" merely mentions it, and
    // its parenthetical delta (`+384 B`) would otherwise be read as the index size (run 27).
    if (/^\**\s*MEMORY\.md\s*\**$/u.test(label) && indexBytes === null) {
      indexBytes = bytesIn(cells[3]) ?? bytesIn(cells[2]);
    }
  }
  return { file, name, run, date, filesBefore, filesAfter, indexBytes };
}

/** Has this exact receipt already been stamped? The ledger is the guard, not a local flag. */
export function receiptAlreadyStamped(root, receiptName) {
  return scanLedger(root, { types: ["brain-consolidated"] })
    .some((event) => String(event.raw?.metadata?.receiptName || "") === receiptName);
}

/**
 * Stamp a REAL consolidation: one `brain-consolidated` event + ONE footer line in MEMORY.md.
 * Idempotent — a second call with the same receipt writes nothing.
 */
export function recordConsolidated({ root, receipt, memoryDir = "", now = new Date() }) {
  const file = path.resolve(receipt);
  if (!path.dirname(file).split(path.sep).includes("archive")) {
    return { status: "not-archived", file };
  }
  if (!fs.existsSync(file)) return { status: "missing-receipt", file };
  const parsed = parseReceipt(file);
  if (!parsed) return { status: "unreadable", file };
  if (receiptAlreadyStamped(root, parsed.name)) return { status: "already", file, receipt: parsed };

  const dir = memoryDir || measureMemory({ root }).dir;
  const indexPath = dir ? path.join(dir, "MEMORY.md") : "";
  // A number the receipt did not carry is measured now where that is honest, never invented.
  const liveIndex = indexPath ? readText(indexPath) : null;
  const indexBytes = parsed.indexBytes ?? (liveIndex === null ? null : Buffer.byteLength(liveIndex));
  let filesAfter = parsed.filesAfter;
  if (filesAfter === null && dir) {
    try {
      filesAfter = fs.readdirSync(dir).filter((entry) => entry.endsWith(".md")).length;
    } catch {
      filesAfter = null;
    }
  }
  const show = (value) => (value === null || value === undefined ? "?" : value);
  const kb = indexBytes === null ? "?" : (indexBytes / 1024).toFixed(1).replace(".", ",");
  const footer =
    `*Run ${show(parsed.run)} (${parsed.date || "?"}): ${show(parsed.filesBefore)} → ${show(filesAfter)} filer · ` +
    `indeks ${kb} KB · receipt archive/${parsed.name}*`;

  const event = appendLedger(root, {
    schema: "nogra.event.v1",
    releaseVersion: "v1.0.0",
    eventId: `event-${now.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-brain-consolidated`,
    createdAt: now.toISOString(),
    workspaceId: readWorkspaceId(root),
    eventType: "brain-consolidated",
    source: "scripts/nogra-brain.mjs",
    message:
      `brain-consolidated: run ${show(parsed.run)} (${parsed.date || "?"}) · ` +
      `${show(parsed.filesBefore)} -> ${show(filesAfter)} files · index ${indexBytes === null ? "?" : indexBytes} bytes · ` +
      `receipt archive/${parsed.name}`,
    metadata: {
      run: parsed.run ?? 0,
      date: parsed.date,
      filesBefore: parsed.filesBefore ?? 0,
      filesAfter: filesAfter ?? 0,
      indexBytes: indexBytes ?? 0,
      receipt: `archive/${parsed.name}`,
      receiptName: parsed.name,
      memoryDir: dir
    },
    briefId: "",
    runId: "",
    redactions: []
  });

  let footerWritten = false;
  if (indexPath && liveIndex !== null) {
    const separator = liveIndex.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(indexPath, `${separator}${footer}\n`, "utf8");
    footerWritten = true;
  }
  return { status: "ok", file, receipt: parsed, event, footer, footerWritten, memoryDir: dir };
}

/**
 * The one-line form `/nogra:status` carries. Numbers only, no event, no side effects.
 * `brain: inden for vinduet · brain-gap N dage · paper: bundet HH:MM`
 */
export function renderLine(facts, bound) {
  const window = facts.window.length > 0
    ? "over vinduet"
    : facts.margin.length > 0
      ? "over margin"
      : "inden for vinduet";
  const gap = facts.compiled ? `${daysSince(facts.compiled.ts)} dage` : "aldrig kompileret";
  let paper = "aldrig bundet";
  if (bound) {
    const at = new Date(tsValue(bound.ts));
    const pad = (value) => String(value).padStart(2, "0");
    paper = `bundet ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  return `brain: ${window} · brain-gap ${gap} · paper: ${paper}`;
}

function statusEvent(root, facts) {
  const now = new Date();
  return appendLedger(root, {
    schema: "nogra.event.v1",
    releaseVersion: "v1.0.0",
    eventId: `event-${now.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-brain-status`,
    createdAt: now.toISOString(),
    workspaceId: facts.workspaceId,
    eventType: "brain-status",
    source: "scripts/nogra-brain.mjs",
    message:
      `brain status: MEMORY.md ${facts.memory.indexLines} lines / ${facts.memory.indexBytes} bytes · ` +
      `checkpoint ${facts.memory.checkpointLines} lines · ${facts.memory.files} memory files · ` +
      `brain raw unmarked ${facts.brain.unmarked}/${facts.brain.total} · ledger ${facts.ledgerLines} lines`,
    metadata: {
      memoryFiles: facts.memory.files,
      indexLines: facts.memory.indexLines,
      indexBytes: facts.memory.indexBytes,
      checkpointLines: facts.memory.checkpointLines,
      userBytes: facts.memory.userBytes,
      largestBytes: facts.memory.largest?.bytes || 0,
      rawTotal: facts.brain.total,
      rawUnmarked: facts.brain.unmarked,
      lastCompiledWatermark: Number(facts.compiled?.raw?.metadata?.watermark) || 0,
      ledgerLines: facts.ledgerLines,
      consolidationRun: facts.receipt?.run ?? 0,
      pendingConsolidation: facts.pending ? 1 : 0,
      valveWired: facts.valveWired ? 1 : 0,
      overMargin: facts.margin.length,
      overWindow: facts.window.length
    },
    briefId: "",
    runId: "",
    redactions: []
  });
}

// ------------------------------------------------------------------------------ mark and stamp

function markRaw(root, file, note) {
  const rawDir = path.join(root, "brain", "raw");
  const name = path.basename(file);
  if (!fs.existsSync(path.join(rawDir, name))) {
    console.error(`STOP: ${name} findes ikke i brain/raw`);
    return 66;
  }
  const sidecar = path.join(rawDir, ".ingested.tsv");
  const text = readText(sidecar) ?? "";
  if (text.split("\n").some((line) => line.split("\t")[0].trim() === name)) {
    console.log(`allerede markeret: ${name}`);
    return 0;
  }
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  fs.appendFileSync(sidecar, `${name}\t${date}\t${note || "nogra-brain"}\n`, "utf8");
  console.log(`markeret (sidecar): ${name}`);
  return 0;
}

function stampCompiled(root, message) {
  const watermark = ledgerLines(root) + 1;
  const now = new Date();
  const event = appendLedger(root, {
    schema: "nogra.event.v1",
    releaseVersion: "v1.0.0",
    eventId: `event-${now.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-brain-compiled`,
    createdAt: now.toISOString().replace(/\.\d{3}Z$/u, "Z"),
    workspaceId: readWorkspaceId(root),
    eventType: "brain-compiled",
    message,
    briefId: "",
    runId: "",
    metadata: { watermark, store: "brain/" },
    redactions: []
  });
  const log = path.join(root, "brain", "log.md");
  if (fs.existsSync(log)) fs.appendFileSync(log, `ur: brain-compiled @ wm ${watermark} — ${message}\n`, "utf8");
  console.log(`STEMPLET: brain-compiled @ wm ${watermark}`);
  return event;
}

// ------------------------------------------------------------------------------------- main

function main() {

  const argv = process.argv.slice(2);
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    // Boolean flags must be recognized by name: taking the next token as a value made a trailing
    // `--no-event` parse as "" (falsy) and the receipt was written anyway.
    if (argv[i] === "--json" || argv[i] === "--no-event") options[argv[i].slice(2)] = true;
    else if (argv[i].startsWith("--")) {
      options[argv[i].slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else positional.push(argv[i]);
  }

  const root = findWorkspaceRoot([options.root || "", process.env.CLAUDE_PROJECT_ROOT || "", process.cwd()]);
  if (!root) {
    console.error("STOP: intet Nogra-workspace (.nogra/config.json) fundet");
    process.exit(64);
  }

  const verb = positional[0] || "status";
  if (verb === "status") {
    const facts = collect(root);
    if (options.json) {
      console.log(JSON.stringify(facts, null, 2));
    } else {
      for (const line of renderStatus(facts)) console.log(line);
    }
    if (!options["no-event"]) {
      try {
        statusEvent(root, facts);
      } catch {
        // the board is the deliverable; a failed receipt must not swallow the measurement
      }
    }
    // status is read-only and always exits 0 — the DOM line is the signal, not the exit code.
    process.exit(0);
  } else if (verb === "consolidated") {
    if (!options.receipt) {
      console.error("brug: nogra-brain consolidated --receipt <sti til archive/consolidation-run-N-<dato>.md> [--memory-dir <dir>]");
      process.exit(64);
    }
    const outcome = recordConsolidated({
      root,
      receipt: options.receipt,
      memoryDir: options["memory-dir"] || ""
    });
    if (outcome.status === "not-archived") {
      console.error("STOP: receipten ligger ikke i en archive/-mappe — en konsolidering kvitteres kun fra arkivet");
      process.exit(2);
    }
    if (outcome.status === "missing-receipt") {
      console.error(`STOP: receipten findes ikke: ${outcome.file}`);
      process.exit(65);
    }
    if (outcome.status === "unreadable") {
      console.error(`STOP: receipten kunne ikke læses: ${outcome.file}`);
      process.exit(65);
    }
    if (outcome.status === "already") {
      console.log(`allerede kvitteret: ${outcome.receipt.name} (intet skrevet)`);
      process.exit(0);
    }
    if (options.json) console.log(JSON.stringify({ footer: outcome.footer, eventId: outcome.event.eventId, metadata: outcome.event.metadata }, null, 2));
    else console.log(`KVITTERET: brain-consolidated run ${outcome.receipt.run} · ${outcome.footerWritten ? "fod-linje skrevet i MEMORY.md" : "MEMORY.md ikke fundet — kun uret"}`);
    process.exit(0);
  } else if (verb === "line") {
    // read-only, one line, no receipt — this is what /nogra:status prints
    console.log(renderLine(collect(root), lastBound(root)));
    process.exit(0);
  } else if (verb === "mark") {
    if (!positional[1]) {
      console.error("brug: nogra-brain mark <raw-fil> [note]");
      process.exit(64);
    }
    process.exit(markRaw(root, positional[1], positional[2]));
  } else if (verb === "stamp") {
    if (!positional[1]) {
      console.error("brug: nogra-brain stamp \"<linje>\"");
      process.exit(64);
    }
    stampCompiled(root, positional[1]);
    process.exit(0);
  } else {
    console.error("brug: nogra-brain status|line|consolidated --receipt <sti>|mark <raw>|stamp \"<linje>\"  [--root <dir>] [--json]");
    process.exit(64);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
