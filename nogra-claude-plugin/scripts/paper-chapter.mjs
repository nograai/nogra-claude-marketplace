#!/usr/bin/env node
// paper-chapter — BOGEN-formen (tegning drawings/bogen-papirets-kapitelform-2026-08-24.md, CEO 24/08).
// Kapitlerne bor i URET: `paper-chapter-closed`-events baerer sidelisten. Verber:
//   open  [--title "..."]   aabn dagens kapitel (event, ingen fil-skrivning)
//   close [--summary "..."] luk kapitlet: stempl ALLE nuvaerende siders pn-liste i uret
//   audit                   maal utjekkede sider = sider i papiret som INTET kapitel-luk daekker
//   status                  et-linjes form til /nogra:status
// Projektion, aldrig kilde. Ingen haandskrevne kapitler — uret er kapitelbogen.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const verb = args[0] || "status";
const opt = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = path.resolve(opt("root", process.cwd()));
const cfgFile = path.join(root, ".nogra", "config.json");
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
// Runde-2-fund 7: det EKSPLICITTE flag vinder over config (som paper-bind/now goer) — foer
// blev --paper stille ignoreret i ethvert workspace hvis config bar paper.file.
const paperFile = path.resolve(root, opt("paper", "") || (cfg.paper && cfg.paper.file) || ".nogra/paper/papiret.html");
const ledgerFile = path.resolve(root, (cfg.paper && cfg.paper.ledger) || ".nogra/ledger/events.jsonl");

function pages() {
  if (!fs.existsSync(paperFile)) return [];
  const html = fs.readFileSync(paperFile, "utf8");
  const out = [];
  for (const m of html.matchAll(/<section class="page"[^>]*>([\s\S]*?)<\/section>/gu)) {
    const pn = (m[1].match(/<p class="pn">([^<]+)<\/p>/u) || [])[1]?.trim();
    if (pn && pn !== "indhold" && pn !== "kort" && pn !== "nu") out.push(pn);
  }
  return out;
}
function ledgerEvents() {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
function append(event) {
  // Runde-2-fund 4: bar appendFileSync doede med ufanget ENOENT i et frisk workspace uden
  // .nogra/ledger/ — skriveren opretter nu mappen som alle andre skrivere, og eventet baerer
  // samme form som resten af uret (schema/eventId/createdAt/workspaceId), saa tree-sync ikke
  // skal falde tilbage paa fingerprint-identitet for netop disse haandstemplede events.
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  const at = new Date();
  const full = {
    schema: "nogra.event.v1",
    eventId: `event-${at.toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14)}-paper-chapter-${Math.abs(JSON.stringify(event).split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 10000}`,
    createdAt: at.toISOString(),
    workspaceId: path.basename(root),
    ...event,
  };
  fs.appendFileSync(ledgerFile, JSON.stringify(full) + "\n");
}
const now = () => new Date().toISOString();
const chapterEvents = () => ledgerEvents().filter((e) => (e.event || e.eventType) === "paper-chapter-closed");
const coveredPages = () => new Set(chapterEvents().flatMap((e) => (e.metadata && e.metadata.pages) || []));

if (verb === "open") {
  append({ ts: now(), actor: "paper-chapter", event: "paper-chapter-opened", metadata: { title: opt("title", new Date().toISOString().slice(0, 10)) } });
  console.log(`kapitel aabnet: ${opt("title", new Date().toISOString().slice(0, 10))}`);
} else if (verb === "close") {
  const all = pages();
  const covered = coveredPages();
  const fresh = all.filter((p) => !covered.has(p));
  append({ ts: now(), actor: "paper-chapter", event: "paper-chapter-closed", metadata: { pages: fresh, allPages: all.length, summary: opt("summary", ""), chapter: chapterEvents().length + 1 } });
  console.log(`kapitel ${chapterEvents().length} lukket: ${fresh.length} nye sider tjekket ind (${fresh.join(", ") || "ingen"}) · ${all.length} sider i bogen`);
} else if (verb === "audit") {
  // Runde-2-fund 3: pages() paa manglende papir gav [] og gaten meldte "alle 0 sider daekket"
  // med exit 0 — en gate der ikke kan finde sit emne skal FEJLE, ikke melde groent.
  if (!fs.existsSync(paperFile)) {
    console.error(`audit: papiret findes ikke (${paperFile}) — gaten kan ikke maale`);
    process.exitCode = 2;
  } else {
  const all = pages();
  const covered = coveredPages();
  const fresh = all.filter((p) => !covered.has(p));
  console.log(fresh.length === 0
    ? `audit: alle ${all.length} sider er daekket af et kapitel-luk`
    : `audit: ${fresh.length} UTJEKKEDE sider (intet kapitel-luk daekker dem): ${fresh.map((p) => "s." + p).join(" · ")}`);
  process.exitCode = fresh.length === 0 ? 0 : 3;
  }
} else if (verb === "status") {
  const evs = chapterEvents();
  const last = evs[evs.length - 1];
  const covered = coveredPages(); // runde-2-fund 5: hejst — foer blev hele ledgeren parset PER SIDE
  const fresh = pages().filter((p) => !covered.has(p));
  console.log(`bogen: ${evs.length} lukkede kapitler · ${fresh.length} utjekkede sider${last ? ` · sidst lukket ${String(last.ts).slice(0, 16)}` : ""}`);
} else {
  console.error(`ukendt verb: ${verb} (open|close|audit|status)`);
  process.exitCode = 64;
}
