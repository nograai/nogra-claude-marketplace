#!/usr/bin/env node
// bin/papir-kort — BOGEN trin 1 (tegning drawings/bogen-papirets-kapitelform-2026-08-24.md).
// To idempotente projektioner ind i Papiret:
//   <!-- PAPER-TOC START/END -->  indholdsfortegnelse (bogens indeks) foer foerste side
//   <!-- PAPER-KORT START/END --> kort-tavlen (projektion af CURRENT-TASKS) foer PAPER-NOW
// Skriver KUN mellem markoerer + injicerer id="side-<pn>" paa sektioner (deterministisk).
// Projektion, aldrig kilde. To koersler i samme minut = samme fil.
import fs from "node:fs";

// Porteret fra husets bin/papir-kort (BOGEN trin 1, tegning bogen-papirets-kapitelform-2026-08-24.md).
import path from "node:path";
const argi = (n, f = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const ROOT = path.resolve(argi("root", process.cwd()));
const cfgFile = path.join(ROOT, ".nogra", "config.json");
const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
const PAPER = path.resolve(ROOT, argi("paper", "") || (cfg.paper && cfg.paper.file) || ".nogra/paper/papiret.html"); // runde-2-fund 7: flag vinder
const TASKS = path.resolve(ROOT, argi("tasks", ".nogra/state/CURRENT-TASKS.md"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = fs.readFileSync(PAPER, "utf8");

// ---- 1) id-injektion + TOC-data: hver <section class="page"> faar id="side-<pn>" ----
const entries = [];
html = html.replace(/<section class="page"( id="[^"]*")?>([\s\S]*?)<\/section>/gu, (m, hadId, body) => {
  const pn = (body.match(/<p class="pn">([^<]+)<\/p>/u) || [])[1]?.trim() || "";
  const ed = (body.match(/<div class="ed">([\s\S]*?)<\/div>/u) || [])[1] || "";
  const h2 = (body.match(/<h2>([\s\S]*?)<\/h2>/u) || [])[1] || "";
  const title = h2.replace(/<[^>]+>/gu, "").trim() || ed.replace(/<[^>]+>/gu, "").trim().slice(0, 80);
  // Runde-2-fund 8: en sektion med haandsat id men uden pn fik sit id STRIPPET — bevar det.
  const id = pn ? `side-${pn.replace(/[^a-z0-9æøå]/giu, "")}` : (hadId ? hadId.match(/id="([^"]*)"/u)[1] : "");
  // Bogens egne meta-sider (indhold/kort) er ikke kapitel-opslag — de staar fast i TOC'en selv.
  if (pn && title && pn !== "kort" && pn !== "indhold") entries.push({ pn, title, id });
  return `<section class="page"${id ? ` id="${id}"` : ""}>${body}</section>`;
});

// ---- 2) kort-tavlen fra CURRENT-TASKS ----
const tasks = fs.readFileSync(TASKS, "utf8").split("\n");
const cards = [];
for (const line of tasks) {
  const m = line.match(/^(\d+)\.\s+(.*)$/u);
  if (!m) continue;
  const [, num, rest] = m;
  // Runde-2-fund 9: fluebenet testes nu EFTER markdown-strippen ("**✅ ...**" laestes som aaben).
  const plain = rest.replace(/\*\*/gu, "").replace(/`/gu, "");
  const closed = /^[~\s]*[✅✓]/u.test(plain);
  cards.push({ num: Number(num), closed, text: plain });
}
const open = cards.filter((c) => !c.closed);
const done = cards.filter((c) => c.closed);
const stamp = new Date().toLocaleString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const kortBlock = [
  "<!-- PAPER-KORT START -->",
  '<section class="page" id="side-kort">',
  `  <div class="ed">KORT-TAVLEN · projektion af .nogra/state/CURRENT-TASKS.md · genereret af bin/papir-kort ${esc(stamp)} — skrives aldrig i hånden</div>`,
  `  <h2>Kortene — ${open.length} åbne · ${done.length} lukkede</h2>`,
  '  <p class="lead">Bogens levende opslagstavle: de åbne kort er det der venter et ord eller en hånd; de lukkede står som kvitteringslinjer. Numrene er bogens referencer (kort 57 = kort 57, alle steder).</p>',
  ...open.map((c) => `  <p><b class="y">kort ${c.num}</b> · ${esc(c.text.slice(0, 320))}${c.text.length > 320 ? "…" : ""}</p>`),
  '  <p><b>Lukkede:</b></p>',
  ...done.slice(-12).map((c) => `  <p><span class="g">✓ kort ${c.num}</span> · ${esc(c.text.replace(/^✅\s*/u, "").slice(0, 140))}…</p>`),
  done.length > 12 ? `  <p>… + ${done.length - 12} ældre lukkede (fuld liste i CURRENT-TASKS.md)</p>` : "",
  '  <p class="pn">kort</p>',
  "</section>",
  "<!-- PAPER-KORT END -->",
].filter(Boolean).join("\n");

// ---- 3) TOC-blokken ----
const tocBlock = [
  "<!-- PAPER-TOC START -->",
  '<section class="page" id="side-indhold">',
  `  <div class="ed">INDHOLD · bogens indeks · genereret af bin/papir-kort ${esc(stamp)}</div>`,
  "  <h2>Bogen — indholdsfortegnelse</h2>",
  '  <p class="lead">Papiret læses ned som en bog: ét kapitel pr. dag, siderne i rækkefølge. Kort-tavlen og "Lige nu" står bagerst og er altid friske.</p>',
  ...entries.map((e) => `  <p><a href="#${e.id}"><b>s.${esc(e.pn)}</b></a> · ${esc(e.title)}</p>`),
  '  <p><a href="#side-kort"><b>KORT</b></a> · Kort-tavlen (åbne domme + kvitteringer)</p>',
  '  <p class="pn">indhold</p>',
  "</section>",
  "<!-- PAPER-TOC END -->",
].join("\n");

// ---- 4) idempotent indsættelse ----
if (html.includes("<!-- PAPER-KORT START -->")) {
  html = html.replace(/<!-- PAPER-KORT START -->[\s\S]*?<!-- PAPER-KORT END -->/u, () => kortBlock);
} else {
  if (!html.includes("<!-- PAPER-NOW START -->")) throw new Error("PAPER-NOW-markøren mangler — kort-tavlen har intet anker");
  // Runde-2-fund 6: STRENG-formen tolkede $&, $` osv. i tasktekst som erstatningsmoenstre.
  html = html.replace("<!-- PAPER-NOW START -->", () => `${kortBlock}\n<!-- PAPER-NOW START -->`);
}
if (html.includes("<!-- PAPER-TOC START -->")) {
  html = html.replace(/<!-- PAPER-TOC START -->[\s\S]*?<!-- PAPER-TOC END -->/u, () => tocBlock);
} else {
  const firstPage = html.indexOf('<section class="page"');
  if (firstPage < 0) throw new Error("ingen sider fundet — TOC har intet anker");
  html = `${html.slice(0, firstPage)}${tocBlock}\n${html.slice(firstPage)}`;
}
fs.writeFileSync(PAPER, html);
console.log(`papir-kort: TOC ${entries.length + 1} opslag · kort-tavlen ${open.length} åbne + ${done.length} lukkede`);
