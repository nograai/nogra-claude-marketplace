#!/usr/bin/env node
// paper-bind — bind DECISIONS.md (projection) + the ledger (truth) into the Paper as one
// expand/collapse block. A faithful Node port of the house's `bin/papir-bind` (python), moved under
// the plugin roof as the `bind` verb of `/nogra:paper`.
//
//   node scripts/paper-bind.mjs [<paper.html>] [--root <dir>] [--decisions <p>] [--ledger <p>]
//                               [--markers paper|papir] [--generator <text>] [--now "<dd/mm/yyyy HH:MM>"]
//                               [--no-event] [--json]
//
// Without a positional path the paper comes from `.nogra/config.json → paper.file`. One paper per
// workspace. Idempotent: the block between the markers is REPLACED, never appended, and a paper
// still carrying the old `PAPIR-BIND` markers is migrated in place — never double-inserted.
//
// Boundary: this is a PROJECTION. It never edits DECISIONS.md, never edits the ledger, and puts
// nothing in the paper but names, numbers and ids.
//
// Port notes (why this is byte-identical to the python, not merely similar):
//   · `html.escape` order: & < > " ' — same five substitutions, same order.
//   · python slices strings by CODE POINT; DECISIONS.md carries emoji, so `body[:400]` is done
//     with Array.from(...) and not String.slice().
//   · python's `str.replace` replaces every occurrence; JS `String.replace(str, str)` replaces the
//     first — every such call here is `replaceAll` or a global regex.
//   · `\b` is unicode-aware in python and ASCII-only in JS, so the ledger lookup spells the word
//     boundaries out as `(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}_])`.
//   · the event number is the index in the list of PARSED ledger lines, not the raw file line.
//   · `sorted(..., reverse=True)` is stable in python: ties keep their order. A JS stable sort with
//     an inverted comparator does the same.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { appendLedger, findWorkspaceRoot } from "../runtime/local/walls.mjs";
import { readWorkspaceId, scanLedger, tsValue } from "../runtime/local/brain-valve.mjs";

const CONFIG_TEMPLATE = {
  paper: {
    file: "<path to the paper html — relative to the workspace root, or absolute>",
    artifactUrl: "https://claude.ai/code/artifact/<artifact-id>",
    decisions: ".nogra/state/DECISIONS.md",
    ledger: ".nogra/ledger/events.jsonl"
  }
};

const ANCHOR = "<h2>Det jeg skal have dit ord på</h2>";
const STYLE =
  ".bind details{border:1px solid var(--rule);border-radius:6px;padding:6px 10px;margin:6px 0;" +
  "background:var(--paper2)} .bind summary{cursor:pointer;font-size:14px} .bind details[open]" +
  "{padding-bottom:10px} .bind ul{margin:2px 0 0 18px;padding:0} .bind .small{font-size:12px;color:var(--mute)}";

// ------------------------------------------------------------------------------ python parity

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#x27;");
}

/** python slices by code point; DECISIONS.md carries emoji. */
function sliceCodePoints(value, end) {
  return Array.from(String(value)).slice(0, end).join("");
}

function md2html(source) {
  let text = escapeHtml(source);
  text = text.replace(/\*\*([^\n]+?)\*\*/gu, "<b>$1</b>");
  text = text.replace(/`([^`]+)`/gu, '<span class="k">$1</span>');
  text = text.replace(/\*([^\n]+?)\*/gu, "<i>$1</i>");
  const paragraphs = text.split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean);
  return paragraphs.map((part) => `<p>${part.replaceAll("\n", "<br>")}</p>`).join("");
}

function statusOf(title, body) {
  const t = `${title} ${sliceCodePoints(body, 400)}`.toLowerCase();
  // Review-fund 24/08 (lokalt): "go " som SUBSTRING markerede aabne domme groenne — "afventer GO
  // paa briefen" bar "go " og blev GO/lukket. Aaben-signalet vinder nu (en dom der AFVENTER go er
  // aaben uanset ordet), og go matches paa ordgraense saa "go?"/"lego"/"algo" aldrig taeller.
  if (t.includes("go?") || t.includes("åben") || t.includes("afventer") || t.includes("udestår")) {
    return ["y", "åben"];
  }
  if (/(^|[^\p{L}\p{N}])go($|[^\p{L}\p{N}])/u.test(t) || t.includes("lukket") || t.includes("dømt")) {
    return ["g", "GO/lukket"];
  }
  if (t.includes("brief")) return ["y", "åben"];
  return ["", ""];
}

function decisionKey(id) {
  const match = String(id).match(/^(\d+)([a-z]?)/u);
  return match ? [Number(match[1]), match[2]] : [0, ""];
}

function compareKeys(left, right) {
  const a = decisionKey(left);
  const b = decisionKey(right);
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/** Both shapes DECISIONS.md carries: `## N · title` and `- Date: ts` + `**N · title:** body`. */
export function parseDecisions(text) {
  const sections = [];
  const headings = /^## (\d+) · ([\s\S]+?)\n([\s\S]*?)(?=^## \d+ · |$(?![\s\S]))/gmu;
  for (const match of text.matchAll(headings)) {
    sections.push({ id: match[1], title: match[2].trim(), body: match[3].trim() });
  }
  const dated = /^- Date: (\S+)\n {2}\*\*(\d+[a-z]?)\s*(?:·\s*)?([\s\S]+?):\*\*\s*([\s\S]*?)(?=^- Date: |^## |$(?![\s\S]))/gmu;
  for (const match of text.matchAll(dated)) {
    const when = sliceCodePoints(match[1], 16).replaceAll("T", " ");
    sections.push({ id: match[2], title: match[3].trim(), body: `*${when}* — ${match[4].trim()}` });
  }
  sections.sort((left, right) => compareKeys(left.id, right.id));
  return sections;
}

export function parseLedger(text) {
  const events = [];
  for (const line of text.split("\n")) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    events.push(parsed);
  }
  return events;
}

function ledgerHits(events, id) {
  const n = String(id).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const word = "[\\p{L}\\p{N}_]";
  const pattern = new RegExp(
    `(?<!${word})(dom|DECISIONS|brief|pkt|punkt)\\s*${n}(?!${word})` +
      `|(?<!${word})${n} GO(?!${word})` +
      `|"${n} GO"`,
    "iu"
  );
  const hits = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const text = ["summary", "message", "details"].map((key) => String(event[key] ?? "")).join(" ");
    if (!pattern.test(text)) continue;
    const ts = sliceCodePoints(event.ts || event.createdAt || "", 16).replaceAll("T", " ");
    hits.push({
      ts,
      actor: event.actor || event.eventType || "",
      event: event.event || event.eventType || "",
      index: index + 1
    });
  }
  return hits.slice(-6);
}

function localStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ------------------------------------------------------------------------------------- the block

export function buildBlock({ decisions, ledger, now, marker, generator }) {
  const sections = parseDecisions(decisions);
  const events = parseLedger(ledger);
  const parts = [
    `<!-- ${marker}:DECISIONS START -->\n<div class="bind"><p class="small">` +
      `<b>Bundet fra uret + DECISIONS.md · ${now}</b> — ${sections.length} domme/briefs. ` +
      "Fold ud for ordlyden; uret-linjerne er sandheden (event-nummer = linje i " +
      '<span class="k">.nogra/ledger/events.jsonl</span>). Genereres af ' +
      `<span class="k">${generator}</span>, aldrig i hånden.</p>`
  ];
  // python's sorted(reverse=True) is stable; an inverted comparator on a stable sort matches it.
  const ordered = sections.slice().sort((left, right) => compareKeys(right.id, left.id));
  for (const { id, title, body } of ordered) {
    const [cls, label] = statusOf(title, body);
    const hits = ledgerHits(events, id);
    const ur = hits.length
      ? hits
          .map(
            (hit) =>
              `<li><span class="k">#${hit.index}</span> ${escapeHtml(hit.ts)} · ` +
              `${escapeHtml(hit.actor)} · ${escapeHtml(hit.event)}</li>`
          )
          .join("")
      : "<li>— ingen uret-linje matcher endnu</li>";
    const heading = md2html(title).replaceAll("<p>", "").replaceAll("</p>", "");
    const badge = label ? `<span class="dom ${cls}">${label}</span>` : "";
    parts.push(
      `<details><summary><b>${id}</b> · ${heading} ${badge}</summary>${md2html(body)}` +
        `<p class="small"><b>Uret:</b></p><ul class="small">${ur}</ul></details>`
    );
  }
  parts.push(`</div>\n<!-- ${marker}:DECISIONS END -->`);
  return { block: parts.join("\n"), count: sections.length };
}

export function applyBlock(paper, block, marker) {
  let text = paper;
  // Compatibility: a paper still carrying the old `PAPIR-BIND` markers is REPLACED in place, so
  // renaming the markers can never double-insert the block.
  const existing = ["PAPER-BIND", "PAPIR-BIND"].find((name) => text.includes(`<!-- ${name}:DECISIONS START -->`));
  if (existing) {
    const span = new RegExp(
      `<!-- ${existing}:DECISIONS START -->[\\s\\S]*?<!-- ${existing}:DECISIONS END -->`,
      "gu"
    );
    text = text.replace(span, () => block);
  } else {
    const anchorAt = text.indexOf(ANCHOR);
    if (anchorAt <= 0) throw new Error("s.7-ankeret mangler i Papiret");
    const leadAt = text.indexOf('<p class="lead">', anchorAt);
    // Review-fund 24/08 (HIGH): indexOf(-1) klamper til 0 og indexOf("</p>", -1)+4 kan give cut=3 —
    // blokken blev splejset over ankeret eller midt i aabningstagget, og receipten meldte groent paa
    // oedelagt papir. Et bind der ikke kan finde sin plads skal STOPPE, aldrig gaette.
    if (leadAt < 0) throw new Error("s.7-ankerets lead-afsnit mangler i Papiret — bind ikke anvendt");
    const closeAt = text.indexOf("</p>", leadAt);
    if (closeAt < 0) throw new Error("s.7-ankerets lead-afsnit er ulukket i Papiret — bind ikke anvendt");
    const cut = closeAt + 4;
    text = `${text.slice(0, cut)}\n${block}\n${text.slice(cut)}`;
  }
  if (!text.includes(".bind details")) {
    text = text.replace("</style>", () => `${STYLE}\n</style>`);
  }
  return text;
}

// ------------------------------------------------------------------- the verb, callable in-process

export function readPaperConfig(root) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, ".nogra", "config.json"), "utf8"));
  } catch {
    config = {};
  }
  return config.paper && typeof config.paper === "object" ? config.paper : null;
}

export function resolveIn(root, value, fallback = "") {
  const chosen = value || fallback;
  if (!chosen) return "";
  return path.isAbsolute(chosen) ? chosen : path.join(root, chosen);
}

/**
 * Bind DECISIONS + ledger into the paper. Returns a status instead of exiting, so callers
 * (the `decide` post-step, the smokes) can decide what a missing config means for them.
 * status: ok · no-config · missing-paper · no-anchor · error
 */
export function bindPaper({
  root,
  paper = "",
  decisions = "",
  ledger = "",
  markers = "paper",
  generator = "scripts/paper-bind.mjs",
  now = "",
  writeEvent = true
} = {}) {
  const paperConfig = readPaperConfig(root);
  const paperPath = paper ? path.resolve(paper) : resolveIn(root, paperConfig?.file || "");
  if (!paperPath) return { status: "no-config", configTemplate: CONFIG_TEMPLATE };
  if (!fs.existsSync(paperPath)) return { status: "missing-paper", paper: paperPath };

  const decisionsPath = resolveIn(root, decisions, paperConfig?.decisions || ".nogra/state/DECISIONS.md");
  const ledgerPath = resolveIn(root, ledger, paperConfig?.ledger || ".nogra/ledger/events.jsonl");
  const marker = String(markers).toLowerCase() === "papir" ? "PAPIR-BIND" : "PAPER-BIND";
  const stampedAt = now || localStamp();

  let built;
  try {
    built = buildBlock({
      decisions: fs.readFileSync(decisionsPath, "utf8"),
      ledger: fs.readFileSync(ledgerPath, "utf8"),
      now: stampedAt,
      marker,
      generator
    });
  } catch (error) {
    return { status: "error", paper: paperPath, error: error?.message || "unknown" };
  }

  let next;
  try {
    next = applyBlock(fs.readFileSync(paperPath, "utf8"), built.block, marker);
  } catch (error) {
    return { status: "no-anchor", paper: paperPath, error: error?.message || "unknown" };
  }
  fs.writeFileSync(paperPath, next, "utf8");

  const sha256 = createHash("sha256").update(fs.readFileSync(paperPath)).digest("hex");
  let event = null;
  if (writeEvent) {
    const at = new Date();
    event = appendLedger(root, {
      schema: "nogra.event.v1",
      releaseVersion: "v1.0.0",
      eventId: `event-${at.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-paper-bound`,
      createdAt: at.toISOString(),
      workspaceId: readWorkspaceId(root),
      eventType: "paper-bound",
      source: "scripts/paper-bind.mjs",
      message: `paper-bound: ${built.count} decisions bound into ${path.basename(paperPath)} · sha256 ${sha256}`,
      metadata: {
        decisions: built.count,
        paper: path.relative(root, paperPath),
        sha256,
        artifactUrl: paperConfig?.artifactUrl || "",
        marker
      },
      briefId: "",
      runId: "",
      redactions: []
    });
  }
  return { status: "ok", paper: paperPath, decisions: built.count, sha256, marker, now: stampedAt, event };
}

/** Newest `paper-bound` event, or null — the one-line status form asks this. */
export function lastBound(root) {
  const events = scanLedger(root, { types: ["paper-bound"] });
  if (events.length === 0) return null;
  return events.reduce((best, event) => (tsValue(event.ts) > tsValue(best.ts) ? event : best));
}

// ------------------------------------------------------------------------------------------ main

function main() {
  const argv = process.argv.slice(2);
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (["--no-event", "--json", "--last"].includes(argv[i])) options[argv[i].slice(2)] = true;
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

  if (options.last) {
    const event = lastBound(root);
    if (!event) {
      console.log("paper: aldrig bundet");
      process.exit(0);
    }
    const at = new Date(tsValue(event.ts));
    const pad = (value) => String(value).padStart(2, "0");
    console.log(`paper: bundet ${pad(at.getHours())}:${pad(at.getMinutes())} · ${event.raw?.metadata?.decisions ?? "?"} domme`);
    process.exit(0);
  }

  const result = bindPaper({
    root,
    paper: positional[0] || "",
    decisions: options.decisions || "",
    ledger: options.ledger || "",
    markers: options.markers || "paper",
    generator: options.generator || "scripts/paper-bind.mjs",
    now: options.now || "",
    writeEvent: !options["no-event"]
  });

  if (result.status === "no-config") {
    // The skill never writes config.json on the operator's behalf — it says exactly what to add.
    console.error("STOP: .nogra/config.json mangler nøglen `paper`. Tilføj den (ét papir pr. workspace):");
    console.error(JSON.stringify(result.configTemplate, null, 2));
    process.exit(2);
  }
  if (result.status === "missing-paper") {
    console.error(`STOP: papiret findes ikke: ${result.paper}`);
    process.exit(65);
  }
  if (result.status !== "ok") {
    console.error(`STOP: ${result.status}${result.error ? ` — ${result.error}` : ""}`);
    process.exit(65);
  }

  if (options.json) {
    console.log(JSON.stringify({
      paper: result.paper,
      decisions: result.decisions,
      sha256: result.sha256,
      marker: result.marker,
      eventId: result.event?.eventId || ""
    }, null, 2));
  } else {
    console.log(
      `paper-bind: ${result.decisions} domme bundet ind i ${path.basename(result.paper)} ` +
      `(${result.now}) · sha256 ${result.sha256.slice(0, 12)}`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
