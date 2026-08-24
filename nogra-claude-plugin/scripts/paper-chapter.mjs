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
const paperFile = path.resolve(root, (cfg.paper && cfg.paper.file) || opt("paper", ".nogra/paper/papiret.html"));
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
  fs.appendFileSync(ledgerFile, JSON.stringify(event) + "\n");
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
  const all = pages();
  const covered = coveredPages();
  const fresh = all.filter((p) => !covered.has(p));
  console.log(fresh.length === 0
    ? `audit: alle ${all.length} sider er daekket af et kapitel-luk`
    : `audit: ${fresh.length} UTJEKKEDE sider (intet kapitel-luk daekker dem): ${fresh.map((p) => "s." + p).join(" · ")}`);
  process.exitCode = fresh.length === 0 ? 0 : 3;
} else if (verb === "status") {
  const evs = chapterEvents();
  const last = evs[evs.length - 1];
  const fresh = pages().filter((p) => !coveredPages().has(p));
  console.log(`bogen: ${evs.length} lukkede kapitler · ${fresh.length} utjekkede sider${last ? ` · sidst lukket ${String(last.ts).slice(0, 16)}` : ""}`);
} else {
  console.error(`ukendt verb: ${verb} (open|close|audit|status)`);
  process.exitCode = 64;
}
