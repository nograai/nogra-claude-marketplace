#!/usr/bin/env node
// paper-now — the Paper's "Lige nu" page. It MEASURES; it never remembers.
//
//   node scripts/paper-now.mjs [<paper.html>] [--root <dir>] [--no-event] [--json] [--now "<stamp>"]
//
// Everything on the page is read at the moment of writing: the ledger (lines, events, the newest
// three summaries), the doors (`paper.doors` in config, measured with curl and a 10 s ceiling),
// the open decisions, the newest finds, and an optional workspace-supplied command. Nothing is
// carried over from a previous run — a number without a measurement behind it does not appear.
//
// The section is written between `<!-- PAPER-NOW START -->` and `<!-- PAPER-NOW END -->` at the end
// of the paper's body, and REPLACED on every run (idempotent). It reuses the paper's own classes
// (.page .ed .lead .k .g .y .r .recv .pn) — it never invents styling.
//
// Boundary: projection only. It never edits DECISIONS.md and never edits the ledger except for its
// own `paper-now` receipt. Command output is HTML-ESCAPED before it is embedded: verbatim text,
// never markup injected into the operator's paper.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseDecisions, readPaperConfig, resolveIn } from "./paper-bind.mjs";
import { appendLedger, findWorkspaceRoot } from "../runtime/local/walls.mjs";
import { countLines, readWorkspaceId } from "../runtime/local/brain-valve.mjs"; // runde-2-fund 14: doedt tsValue-import fjernet

const START = "<!-- PAPER-NOW START -->";
const END = "<!-- PAPER-NOW END -->";
const DOOR_TIMEOUT_SECONDS = 10;
/** Heuristic for "open": the decision's HEADING carries one of these. Overridable via paper.openMarkers. */
const DEFAULT_OPEN_MARKERS = ["GO?", "afventer", "udestår"];
const MAX_COMMAND_CHARS = 1200;

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#x27;");
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function stampNow(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ------------------------------------------------------------------------------- measurements

export function measureLedger(file) {
  const text = readText(file);
  if (text === null) return { lines: 0, events: 0, newest: [], newestTs: "" };
  const lines = countLines(text);
  const parsed = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // an unparseable line is not an event
    }
  }
  const newest = parsed.slice(-3).reverse().map((event) => ({
    ts: String(event.createdAt || event.ts || "").slice(0, 16).replaceAll("T", " "),
    type: String(event.eventType || event.event || event.type || ""),
    text: String(event.summary || event.message || event.details || "").replace(/\s+/gu, " ").slice(0, 180)
  }));
  return { lines, events: parsed.length, newest, newestTs: newest[0]?.ts || "" };
}

export function measureDoors(doors) {
  if (!Array.isArray(doors) || doors.length === 0) return [];
  return doors.slice(0, 8).map((entry) => {
    const url = typeof entry === "string" ? entry : String(entry?.url || "");
    const name = typeof entry === "string" ? url.replace(/^https?:\/\//iu, "").split("/")[0] : String(entry?.name || url);
    if (!url) return { name, url, code: "—" };
    try {
      const code = execFileSync(
        "curl",
        ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", String(DOOR_TIMEOUT_SECONDS), url],
        { encoding: "utf8", timeout: (DOOR_TIMEOUT_SECONDS + 2) * 1000, stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      return { name, url, code: code || "000" };
    } catch {
      // curl itself failed or was killed — say so, never guess a status
      return { name, url, code: "000" };
    }
  });
}

export function measureOpenDecisions(decisionsText, markers = DEFAULT_OPEN_MARKERS) {
  const sections = parseDecisions(decisionsText || "");
  const needles = markers.map((marker) => String(marker).toLowerCase());
  const open = sections.filter((section) => {
    const heading = section.title.toLowerCase();
    return needles.some((needle) => heading.includes(needle));
  });
  return { total: sections.length, open };
}

export function measureFunds(fundText, limit = 5) {
  if (!fundText) return [];
  return fundText
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- **"))
    .slice(-limit)
    .reverse()
    .map((line) => line.trim().replace(/^-\s*/u, "").replace(/\s+/gu, " ").slice(0, 200));
}

export function runCommandHook(command, cwd) {
  if (!command) return null;
  try {
    const out = execFileSync("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.slice(0, MAX_COMMAND_CHARS).trimEnd();
  } catch (error) {
    return `(kommandoen fejlede: ${String(error?.message || "ukendt").slice(0, 120)})`;
  }
}

// -------------------------------------------------------------------------------- the section

function doorCell(doors) {
  if (doors.length === 0) return "ingen døre i config";
  return doors
    .map((door) => {
      const code = String(door.code);
      const cls = /^2/u.test(code) ? "g" : /^[34]/u.test(code) ? "y" : "r";
      return `<span class="${cls}">${escapeHtml(code)}</span> ${escapeHtml(door.name)}`;
    })
    .join(" · ");
}

function listOr(items, empty) {
  if (items.length === 0) return `<ul><li>${empty}</li></ul>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

export function buildNowSection({ stamp, ledger, doors, decisions, funds, commandOut, markers }) {
  const lines = [
    START,
    '<section class="page">',
    `  <div class="ed">Side · LIGE NU — målt ${escapeHtml(stamp)} (målt, ikke husket; uret er sandheden, dette er spejlet · genereret af /nogra:paper now)</div>`,
    "  <h2>Hvor huset står, i ét blik</h2>",
    `  <p class="lead">Alt herunder er læst i dette øjeblik: ${ledger.lines} linjer i uret · ` +
      `${doors.length} ${doors.length === 1 ? "dør" : "døre"} målt · ${decisions.open.length} åbne domme · ${funds.length} fund.</p>`,
    "  <table><tr><th>flade</th><th>nu</th></tr>",
    `  <tr><td>Uret</td><td><b>${ledger.lines}</b> linjer · <b>${ledger.events}</b> events · seneste <span class="k">${escapeHtml(ledger.newestTs || "—")}</span></td></tr>`,
    `  <tr><td>Døre</td><td>${doorCell(doors)}</td></tr>`,
    `  <tr><td>Domme</td><td><b>${decisions.total}</b> i DECISIONS.md · <b>${decisions.open.length}</b> åbne (heuristik: overskriften nævner ${escapeHtml(markers.join(" / "))})</td></tr>`,
    "  </table>",
    "  <h3>Seneste i uret</h3>",
    `  ${listOr(
      ledger.newest.map(
        (event) => `<span class="k">${escapeHtml(event.ts)}</span> ${escapeHtml(event.type)} — ${escapeHtml(event.text)}`
      ),
      "— uret er tomt"
    )}`,
    "  <h3>Åbne domme</h3>",
    `  ${listOr(
      decisions.open.slice(0, 6).map((section) => `<b>${escapeHtml(section.id)}</b> · ${escapeHtml(section.title.slice(0, 160))}`),
      `— ingen overskrift matcher heuristikken (${escapeHtml(markers.join(" / "))})`
    )}`,
    "  <h3>Fund — seneste 5</h3>",
    `  ${listOr(funds.map((fund) => escapeHtml(fund)), "— intet fund-indeks i dette workspace")}`
  ];
  if (commandOut !== null && commandOut !== undefined) {
    lines.push("  <h3>Fabrik</h3>");
    lines.push(`  <p class="recv">${escapeHtml(commandOut)}</p>`);
  }
  lines.push('  <p class="pn">nu</p>', "</section>", END);
  return lines.join("\n");
}

export function applyNowSection(paper, section) {
  if (paper.includes(START)) {
    // Runde-2-fund 2 (samme klasse som bind-markoer-fundet): grenen valgtes paa START alene,
    // regexen kraever BEGGE — et papir med START uden END holdt stille op med at opdatere,
    // mens paperNow kvitterede groent med friskmaalte tal. Siden der findes for at bevise
    // "maalt, ikke husket" maa aldrig selv vaere kun husket.
    if (!paper.includes(END)) {
      throw new Error("PAPER-NOW START staar uden END-markoer i Papiret — now ikke anvendt");
    }
    const span = new RegExp(`${START}[\\s\\S]*?${END}`, "gu");
    const replaced = paper.replace(span, () => section);
    if (replaced === paper && !paper.includes(section)) {
      throw new Error("PAPER-NOW-markoererne matchede ikke (END foer START?) — now ikke anvendt");
    }
    return replaced;
  }
  // No section yet: put it at the END of the paper body, inside the book wrapper when there is one.
  const lastClose = paper.lastIndexOf("</div>");
  if (lastClose < 0) return `${paper.replace(/\s*$/u, "")}\n${section}\n`;
  return `${paper.slice(0, lastClose)}${section}\n${paper.slice(lastClose)}`;
}

// ---------------------------------------------------------------------------------------- verb

export function paperNow({ root, paper = "", now = "", writeEvent = true } = {}) {
  const config = readPaperConfig(root);
  const paperPath = paper ? path.resolve(paper) : resolveIn(root, config?.file || "");
  if (!paperPath) return { status: "no-config" };
  if (!fs.existsSync(paperPath)) return { status: "missing-paper", paper: paperPath };

  const ledgerPath = resolveIn(root, "", config?.ledger || ".nogra/ledger/events.jsonl");
  const decisionsPath = resolveIn(root, "", config?.decisions || ".nogra/state/DECISIONS.md");
  const fundPath = resolveIn(root, "", config?.funds || ".nogra/state/FUND-INDEKS.md");
  const markers = Array.isArray(config?.openMarkers) && config.openMarkers.length
    ? config.openMarkers.map(String)
    : DEFAULT_OPEN_MARKERS;

  const stamp = now || stampNow();
  const ledger = measureLedger(ledgerPath);
  const doors = measureDoors(config?.doors);
  const decisions = measureOpenDecisions(readText(decisionsPath), markers);
  const funds = measureFunds(readText(fundPath));
  const commandOut = config?.sql ? runCommandHook(String(config.sql), root) : null;

  const section = buildNowSection({ stamp, ledger, doors, decisions, funds, commandOut, markers });
  // Runde-2-fund 13 (datatab): readText sluger enhver laesefejl til null, og ?? "" gjorde en
  // MISLYKKET laesning af en EKSISTERENDE fil (EACCES, kortvarig laas) til et tomt papir — naeste
  // linje overskrev saa operatoerens HELE papir med kun NOW-sektionen og kvitterede groent.
  // existsSync (:206) beviste at filen er der; laesningen skal derfor LYKKES foer der skrives.
  const currentPaper = readText(paperPath);
  if (currentPaper === null) return { status: "unreadable-paper", paper: paperPath };
  fs.writeFileSync(paperPath, applyNowSection(currentPaper, section), "utf8");

  const htmlLines = section.split("\n").length;
  let event = null;
  if (writeEvent) {
    const at = new Date();
    event = appendLedger(root, {
      schema: "nogra.event.v1",
      releaseVersion: "v1.0.0",
      eventId: `event-${at.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-paper-now`,
      createdAt: at.toISOString(),
      workspaceId: readWorkspaceId(root),
      eventType: "paper-now",
      source: "scripts/paper-now.mjs",
      message:
        `paper-now: ledger ${ledger.lines} lines / ${ledger.events} events · ${doors.length} doors ` +
        `(${doors.filter((door) => /^2/u.test(String(door.code))).length} ok) · ${decisions.open.length}/${decisions.total} open decisions · ` +
        `${funds.length} finds · ${htmlLines} html lines`,
      metadata: {
        ledgerLines: ledger.lines,
        ledgerEvents: ledger.events,
        doors: doors.length,
        doorsOk: doors.filter((door) => /^2/u.test(String(door.code))).length,
        decisions: decisions.total,
        openDecisions: decisions.open.length,
        funds: funds.length,
        commandHook: commandOut === null ? 0 : 1,
        htmlLines
      },
      briefId: "",
      runId: "",
      redactions: []
    });
  }
  return { status: "ok", paper: paperPath, section, htmlLines, ledger, doors, decisions, funds, event, now: stamp };
}

// ---------------------------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--no-event" || argv[i] === "--json") options[argv[i].slice(2)] = true;
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
  const result = paperNow({
    root,
    paper: positional[0] || "",
    now: options.now || "",
    writeEvent: !options["no-event"]
  });
  if (result.status === "no-config") {
    console.error("STOP: .nogra/config.json mangler nøglen `paper` — se `/nogra:paper bind`");
    process.exit(2);
  }
  if (result.status !== "ok") {
    console.error(`STOP: ${result.status}${result.paper ? ` — ${result.paper}` : ""}`);
    process.exit(65);
  }
  if (options.json) {
    console.log(JSON.stringify({
      paper: result.paper,
      htmlLines: result.htmlLines,
      ledgerLines: result.ledger.lines,
      doors: result.doors,
      openDecisions: result.decisions.open.length,
      funds: result.funds.length,
      eventId: result.event?.eventId || ""
    }, null, 2));
  } else {
    console.log(
      `paper-now: ${result.ledger.lines} urets-linjer · ${result.doors.length} døre · ` +
      `${result.decisions.open.length}/${result.decisions.total} åbne domme · ${result.funds.length} fund · ` +
      `${result.htmlLines} html-linjer (${result.now})`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
