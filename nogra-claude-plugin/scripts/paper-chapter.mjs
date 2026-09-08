#!/usr/bin/env node
// paper-chapter — BOGEN-formen. Kapitler og sider er projektioner af uret:
//   open  [--chapter N] [--title "..."]                         markoer + skille + order + event
//   page  --pn <K8 · s.7> --title "..." --body <file.html|->     idempotent side + event
//   close [--summary "..."]                                    stempl nye sider i uret
//   audit                                                        maal sider, order og id-kollisioner
//   status                                                       et-linjes form til /nogra:status
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const verb = args[0] || "status";
const opt = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const root = path.resolve(opt("root", process.cwd()));
const cfgFile = path.join(root, ".nogra", "config.json");
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
// Det eksplicitte flag vinder over config, som det goer i paper-bind og paper-now.
const paperFile = path.resolve(root, opt("paper", "") || (cfg.paper && cfg.paper.file) || ".nogra/paper/papiret.html");
const ledgerFile = path.resolve(root, (cfg.paper && cfg.paper.ledger) || ".nogra/ledger/events.jsonl");

const ORDER_START = "<!-- PAPER-ORDER START -->";
const ORDER_END = "<!-- PAPER-ORDER END -->";

class ChapterError extends Error {
  constructor(message, code = 65) {
    super(message);
    this.code = code;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#x27;");
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function localStamp(date = new Date()) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function fileStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`;
}

function markerDate(date = new Date()) {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}`;
}

function pages(html = null) {
  if (html === null && !fs.existsSync(paperFile)) return [];
  const source = html === null ? fs.readFileSync(paperFile, "utf8") : html;
  const out = [];
  for (const m of source.matchAll(/<section class="page"[^>]*>([\s\S]*?)<\/section>/gu)) {
    const pn = (m[1].match(/<p class="pn">([^<]+)<\/p>/u) || [])[1]?.trim();
    if (pn && pn !== "indhold" && pn !== "kort" && pn !== "nu") out.push(pn);
  }
  return out;
}

function ledgerEvents() {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function append(event, at = new Date()) {
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const full = {
    schema: "nogra.event.v1",
    eventId: `event-${at.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-paper-chapter-${Math.abs(JSON.stringify(event).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 10000}`,
    createdAt: at.toISOString(),
    workspaceId: path.basename(root),
    ...event,
  };
  fs.appendFileSync(ledgerFile, JSON.stringify(full) + "\n");
  return full;
}

const now = () => new Date().toISOString();
const chapterEvents = () => ledgerEvents().filter((event) => (event.event || event.eventType) === "paper-chapter-closed");
const coveredPages = () => new Set(chapterEvents().flatMap((event) => (event.metadata && event.metadata.pages) || []));

function attr(opening, name) {
  const match = opening.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "iu"));
  return match ? match[2] : "";
}

/** Balanced section spans, so a page body may itself contain nested sections. */
function sectionSpans(html) {
  const spans = [];
  const stack = [];
  for (const match of html.matchAll(/<section\b[^>]*>|<\/section\s*>/giu)) {
    if (/^<section\b/iu.test(match[0])) {
      stack.push({ start: match.index, opening: match[0] });
    } else {
      const opened = stack.pop();
      if (opened) spans.push({ ...opened, end: match.index + match[0].length });
    }
  }
  return spans;
}

function normalizePn(pn) {
  return String(pn).normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function chapterFrom(value) {
  const number = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function inferChapter(pn) {
  return chapterFrom((String(pn).match(/^\s*K\s*(\d+)/iu) || [])[1]);
}

function chapterNumbers(html) {
  const found = new Set();
  const patterns = [
    /PAPER-KAPITEL-(\d+)-[^\r\n]*?\s+START\s*-->/gu,
    /\bid=["']skille-k(\d+)["']/giu,
    /\bid=["']side-K(\d+)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) found.add(Number(match[1]));
  }
  return [...found].sort((left, right) => left - right);
}

function orderRule(chapter) {
  // Positive, unique chapter numbers keep K1 < K2 < ...; existing fixed front matter stays first.
  return `#skille-k${chapter}, .book>section[id^="side-K${chapter}"]{order:${chapter}}`;
}

function orderBlock(html) {
  const start = html.indexOf(ORDER_START);
  const end = html.indexOf(ORDER_END);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < start) throw new ChapterError("PAPER-ORDER-hegnet er ufuldstaendigt");
  return { start, end, bodyStart: start + ORDER_START.length, body: html.slice(start + ORDER_START.length, end) };
}

function hasOrderRule(html, chapter) {
  let block;
  try { block = orderBlock(html); } catch { return false; }
  if (!block) return false;
  const escaped = String(chapter).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `#skille-k${escaped}\\s*,\\s*\\.book>section\\[id\\^=["']side-K${escaped}["']\\]\\s*\\{\\s*order\\s*:\\s*${escaped}\\s*;?\\s*\\}`,
    "u"
  );
  return pattern.test(block.body);
}

function upsertOrderRule(html, chapter) {
  let block = orderBlock(html);
  if (!block) {
    const styleEnd = html.indexOf("</style>");
    if (styleEnd < 0) throw new ChapterError("papirets <style>-blok mangler — order kan ikke skrives");
    const inserted = `${ORDER_START}\n${orderRule(chapter)}\n${ORDER_END}\n`;
    return `${html.slice(0, styleEnd)}${inserted}${html.slice(styleEnd)}`;
  }
  const linePattern = new RegExp(
    `^\\s*#skille-k${chapter}\\s*,\\s*\\.book>section\\[id\\^=["']side-K${chapter}["']\\][^\\r\\n]*$`,
    "iu"
  );
  const kept = block.body.split("\n").filter((line) => !linePattern.test(line));
  while (kept.length && kept[0].trim() === "") kept.shift();
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const body = [...kept, orderRule(chapter)].join("\n");
  return `${html.slice(0, block.bodyStart)}\n${body}\n${html.slice(block.end)}`;
}

function chapterRange(html, chapter) {
  const starts = [...html.matchAll(new RegExp(`<!--\\s*(PAPER-KAPITEL-${chapter}-[^\\r\\n]*?)\\s+START\\s*-->`, "gu"))];
  if (starts.length === 0) throw new ChapterError(`kapitel ${chapter} har ingen START-markoer`);
  if (starts.length > 1) throw new ChapterError(`kapitel ${chapter} har ${starts.length} START-markoerer`);
  const start = starts[0];
  const afterStart = start.index + start[0].length;
  const markerName = start[1].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const endMatch = new RegExp(`<!--\\s*${markerName}\\s+END\\s*-->`, "gu");
  endMatch.lastIndex = afterStart;
  const exactEnd = endMatch.exec(html);
  const nextStart = new RegExp("<!--\\s*PAPER-KAPITEL-\\d+-[^\\r\\n]*?\\s+START\\s*-->", "gu");
  nextStart.lastIndex = afterStart;
  const following = nextStart.exec(html);
  const bookEnd = html.lastIndexOf("</div>");
  const end = exactEnd?.index ?? following?.index ?? (bookEnd >= afterStart ? bookEnd : html.length);
  return { start: afterStart, end };
}

/** True when the byte position is within a generated PAPER-KORT/BIND/NOW fence. */
function generatedBlockAt(html, position) {
  const depth = new Map();
  const markers = /<!--\s*(PAPER-(?:KORT|NOW)|PAPER-BIND(?::[A-Z0-9_-]+)?)\s+(START|END)\s*-->/giu;
  for (const marker of html.matchAll(markers)) {
    if (marker.index >= position) break;
    const key = marker[1].toUpperCase().startsWith("PAPER-BIND") ? "PAPER-BIND" : marker[1].toUpperCase();
    const current = depth.get(key) || 0;
    depth.set(key, marker[2].toUpperCase() === "START" ? current + 1 : Math.max(0, current - 1));
  }
  return [...depth.values()].some((value) => value > 0);
}

function pageSection({ pn, id, title, body, stamp }) {
  const bodyText = String(body).trim();
  return [
    `<section class="page" id="side-${id}">`,
    `  <div class="ed">Side ${escapeHtml(pn)} · stempel ${escapeHtml(stamp)} · genereret af paper-chapter page</div>`,
    `  <h2>${escapeHtml(title)}</h2>`,
    bodyText,
    `  <p class="pn">${escapeHtml(pn)}</p>`,
    "</section>",
  ].filter((line) => line !== "").join("\n");
}

function archiveBeforePage(date) {
  const archiveDir = path.join(root, ".nogra", "paper", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  let archive = path.join(archiveDir, `papiret-foer-page-${fileStamp(date)}.html`);
  let suffix = 1;
  while (fs.existsSync(archive)) {
    archive = path.join(archiveDir, `papiret-foer-page-${fileStamp(date)}-${suffix}.html`);
    suffix += 1;
  }
  fs.copyFileSync(paperFile, archive);
  return archive;
}

function addPage() {
  const pn = opt("pn", "").trim();
  if (!pn) throw new ChapterError("page kraever --pn <sidetal>", 64);
  const id = normalizePn(pn);
  if (!id) throw new ChapterError("page --pn kan ikke normaliseres til et id", 64);
  const chapter = chapterFrom(opt("chapter", "")) || inferChapter(pn);
  if (!chapter) throw new ChapterError("page kraever --chapter N naar --pn ikke begynder med K<N>", 64);
  const bodyArg = opt("body", "");
  if (!bodyArg) throw new ChapterError("page kraever --body <fil.html|->", 64);
  const title = opt("title", pn);
  if (!fs.existsSync(paperFile)) throw new ChapterError(`papiret findes ikke (${paperFile})`);

  let body;
  try {
    body = bodyArg === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(root, bodyArg), "utf8");
  } catch (error) {
    throw new ChapterError(`page-kroppen kan ikke laeses (${bodyArg}): ${error?.code || error?.message || "ukendt"}`);
  }

  const current = fs.readFileSync(paperFile, "utf8");
  const range = chapterRange(current, chapter);
  const matching = sectionSpans(current).filter((span) => attr(span.opening, "id") === `side-${id}`);
  if (matching.length > 1) throw new ChapterError(`id-kollision: side-${id} findes ${matching.length} gange`);

  const at = new Date();
  const stamp = localStamp(at);
  let next;
  let insertionAt;
  if (matching.length === 1) {
    const existing = matching[0];
    insertionAt = existing.start;
    const existingText = current.slice(existing.start, existing.end);
    const oldStamp = (existingText.match(/<div class="ed">Side [\s\S]*? · stempel ([^<]+?) · genereret af paper-chapter page<\/div>/u) || [])[1];
    const stable = pageSection({ pn, id, title, body, stamp: oldStamp || stamp });
    const replacement = stable === existingText ? stable : pageSection({ pn, id, title, body, stamp });
    next = `${current.slice(0, existing.start)}${replacement}${current.slice(existing.end)}`;
  } else {
    insertionAt = range.start;
    if (has("append")) {
      const chapterPages = sectionSpans(current).filter((span) =>
        span.start >= range.start && span.end <= range.end && attr(span.opening, "class").split(/\s+/u).includes("page")
      );
      if (chapterPages.length) insertionAt = Math.max(...chapterPages.map((span) => span.end));
    }
    const section = pageSection({ pn, id, title, body, stamp });
    next = `${current.slice(0, insertionAt)}\n${section}\n${current.slice(insertionAt).replace(/^\n/u, "")}`;
  }

  // Hegnet er selve den roede proeve: en side maa aldrig lande i en genereret blok.
  if (generatedBlockAt(current, insertionAt)) throw new ChapterError("page-indsaetningspunktet ligger inde i en genereret PAPER-KORT/PAPER-BIND/PAPER-NOW-blok");
  if (next === current) {
    console.log(`side uændret: ${pn} · kapitel ${chapter}`);
    return;
  }

  const archive = archiveBeforePage(at);
  fs.writeFileSync(paperFile, next, "utf8");
  append({ ts: at.toISOString(), actor: "paper-chapter", event: "paper-page-added", metadata: { count: 1, pn, chapter } }, at);
  console.log(`side tilføjet: ${pn} · kapitel ${chapter} · før-kopi ${path.basename(archive)}`);
}

function addOrUpdateChapter() {
  if (!fs.existsSync(paperFile)) throw new ChapterError(`papiret findes ikke (${paperFile})`);
  const current = fs.readFileSync(paperFile, "utf8");
  const explicit = opt("chapter", "");
  if (explicit && !chapterFrom(explicit)) throw new ChapterError("open --chapter skal vaere et positivt heltal", 64);
  const eventChapters = ledgerEvents().map((event) => chapterFrom(event.metadata?.chapter)).filter(Boolean);
  const known = [...chapterNumbers(current), ...eventChapters];
  const chapter = chapterFrom(explicit) || (known.length ? Math.max(...known) + 1 : 1);
  const title = opt("title", `Kapitel ${chapter}`);
  const at = new Date();

  let next = upsertOrderRule(current, chapter);
  const starts = [...next.matchAll(new RegExp(`<!--\\s*PAPER-KAPITEL-${chapter}-[^\\r\\n]*?\\s+START\\s*-->`, "gu"))];
  if (starts.length > 1) throw new ChapterError(`kapitel ${chapter} har ${starts.length} START-markoerer`);
  const divider = [
    `<section id="skille-k${chapter}" class="skille">`,
    `  <p class="nr">Kapitel ${chapter} · ${localStamp(at)}</p>`,
    `  <h2>${escapeHtml(title)}</h2>`,
    "</section>",
  ].join("\n");
  if (starts.length === 0) {
    const name = `PAPER-KAPITEL-${chapter}-${markerDate(at)}`;
    const structure = `${next.includes(`id="skille-k${chapter}"`) ? "" : divider + "\n"}<!-- ${name} START -->\n<!-- ${name} END -->\n`;
    const bookEnd = next.lastIndexOf("</div>");
    const bodyEnd = next.lastIndexOf("</body>");
    const insertionAt = bookEnd >= 0 ? bookEnd : bodyEnd >= 0 ? bodyEnd : next.length;
    next = `${next.slice(0, insertionAt)}${structure}${next.slice(insertionAt)}`;
  } else if (!next.includes(`id="skille-k${chapter}"`)) {
    const insertionAt = starts[0].index;
    next = `${next.slice(0, insertionAt)}${divider}\n${next.slice(insertionAt)}`;
  }

  if (next !== current) fs.writeFileSync(paperFile, next, "utf8");
  append({ ts: at.toISOString(), actor: "paper-chapter", event: "paper-chapter-opened", metadata: { title, chapter } }, at);
  console.log(`kapitel ${chapter} aabnet: ${title}`);
}

function duplicateIds(html) {
  const counts = new Map();
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, "");
  for (const tag of markup.matchAll(/<[a-z][^>]*>/giu)) {
    const match = tag[0].match(/\bid\s*=\s*(["'])(.*?)\1/iu);
    if (!match) continue;
    counts.set(match[2], (counts.get(match[2]) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id}×${count}`);
}

if (verb === "open") {
  try { addOrUpdateChapter(); } catch (error) {
    console.error(`STOP: ${error.message}`);
    process.exitCode = error.code || 65;
  }
} else if (verb === "page") {
  try { addPage(); } catch (error) {
    console.error(`STOP: ${error.message}`);
    process.exitCode = error.code || 65;
  }
} else if (verb === "close") {
  const all = pages();
  const covered = coveredPages();
  const fresh = all.filter((pn) => !covered.has(pn));
  const chapter = chapterEvents().length + 1;
  append({ ts: now(), actor: "paper-chapter", event: "paper-chapter-closed", metadata: { pages: fresh, allPages: all.length, summary: opt("summary", ""), chapter } });
  console.log(`kapitel ${chapter} lukket: ${fresh.length} nye sider tjekket ind (${fresh.join(", ") || "ingen"}) · ${all.length} sider i bogen`);
} else if (verb === "audit") {
  if (!fs.existsSync(paperFile)) {
    console.error(`audit: papiret findes ikke (${paperFile}) — gaten kan ikke maale`);
    process.exitCode = 2;
  } else {
    const html = fs.readFileSync(paperFile, "utf8");
    const all = pages(html);
    const covered = coveredPages();
    const fresh = all.filter((pn) => !covered.has(pn));
    const missingOrders = chapterNumbers(html).filter((chapter) => !hasOrderRule(html, chapter));
    const collisions = duplicateIds(html);
    const issues = [];
    if (fresh.length) issues.push(`${fresh.length} UTJEKKEDE sider: ${fresh.map((pn) => "s." + pn).join(" · ")}`);
    if (missingOrders.length) issues.push(`kapitler uden order-regel: ${missingOrders.map((chapter) => "K" + chapter).join(", ")}`);
    if (collisions.length) issues.push(`id-kollisioner: ${collisions.join(", ")}`);
    console.log(issues.length ? `audit: ${issues.join(" · ")}` : `audit: alle ${all.length} sider er daekket · alle kapitler har order · ingen id-kollisioner`);
    process.exitCode = issues.length ? 3 : 0;
  }
} else if (verb === "status") {
  const events = chapterEvents();
  const last = events[events.length - 1];
  const covered = coveredPages();
  const fresh = pages().filter((pn) => !covered.has(pn));
  console.log(`bogen: ${events.length} lukkede kapitler · ${fresh.length} utjekkede sider${last ? ` · sidst lukket ${String(last.ts).slice(0, 16)}` : ""}`);
} else {
  console.error(`ukendt verb: ${verb} (open|page|close|audit|status)`);
  process.exitCode = 64;
}
