#!/usr/bin/env node
// Falsifiable smoke for paper-chapter page + generated chapter order + paper-now's bound count.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const beds = [];
let fails = 0;

const ok = (name, condition, detail = "") => {
  console.log((condition ? "  ok   " : "  FAIL ") + name + (condition || !detail ? "" : ` — ${detail}`));
  if (!condition) fails += 1;
};

function paper({ chapter = 8, inside = "", order = "" } = {}) {
  return [
    "<!doctype html><html><head><style>",
    ".book{display:flex;flex-direction:column}",
    order,
    "</style></head><body><div class=\"book\">",
    inside,
    `<!-- PAPER-KAPITEL-${chapter}-29-08 START -->`,
    `<!-- PAPER-KAPITEL-${chapter}-29-08 END -->`,
    "</div></body></html>",
  ].join("\n");
}

function bed(html, ledger = "") {
  const root = mkdtempSync(join(tmpdir(), "nogra-paper-chapter-"));
  beds.push(root);
  mkdirSync(join(root, ".nogra", "ledger"), { recursive: true });
  mkdirSync(join(root, ".nogra", "state"), { recursive: true });
  writeFileSync(join(root, "papiret.html"), html, "utf8");
  writeFileSync(join(root, "body.html"), "<p>Brødtekst fra filen.</p>\n", "utf8");
  writeFileSync(join(root, ".nogra", "ledger", "events.jsonl"), ledger, "utf8");
  writeFileSync(join(root, ".nogra", "state", "DECISIONS.md"), "", "utf8");
  writeFileSync(join(root, ".nogra", "state", "FUND-INDEKS.md"), "", "utf8");
  writeFileSync(join(root, ".nogra", "config.json"), JSON.stringify({
    workspaceId: "smoke-paper-chapter",
    paper: {
      file: "papiret.html",
      decisions: ".nogra/state/DECISIONS.md",
      ledger: ".nogra/ledger/events.jsonl",
    },
  }), "utf8");
  return root;
}

function run(script, root, argv, input = "") {
  const result = spawnSync("node", [join(HERE, script), ...argv, "--root", root], {
    encoding: "utf8",
    input,
  });
  return { code: result.status ?? 1, out: `${result.stdout || ""}${result.stderr || ""}` };
}

const readPaper = (root) => readFileSync(join(root, "papiret.html"), "utf8");
const readLedger = (root) => readFileSync(join(root, ".nogra", "ledger", "events.jsonl"), "utf8");
const pageArgs = ["page", "--pn", "K8 · s.7", "--title", "Ny <side>", "--body", "body.html"];

try {
  // (a) --pn is mandatory and is a usage error.
  const missingBed = bed(paper());
  const missing = run("paper-chapter.mjs", missingBed, ["page", "--body", "body.html"]);
  ok("(a) page uden --pn -> exit 64", missing.code === 64, `${missing.code}: ${missing.out.trim()}`);
  ok("(a) fejlteksten navngiver --pn", /--pn/u.test(missing.out), missing.out.trim());

  // (b) The insertion byte is inside PAPER-KORT: no paper, archive or ledger mutation is allowed.
  const fencedHtml = paper({
    inside: "<!-- PAPER-KORT START -->",
  }).replace("<!-- PAPER-KAPITEL-8-29-08 END -->", "<!-- PAPER-KAPITEL-8-29-08 END -->\n<!-- PAPER-KORT END -->");
  const fencedBed = bed(fencedHtml);
  const fencedBefore = readPaper(fencedBed);
  const fenced = run("paper-chapter.mjs", fencedBed, pageArgs);
  ok("(b) insertion i PAPER-KORT -> exit 65", fenced.code === 65, `${fenced.code}: ${fenced.out.trim()}`);
  ok("(b) hegnet navngives i fejlteksten", /genereret PAPER-KORT\/PAPER-BIND\/PAPER-NOW-blok/u.test(fenced.out), fenced.out.trim());
  ok("(b) rødt stop skriver intet papir", readPaper(fencedBed) === fencedBefore);
  ok("(b) rødt stop skriver intet event", readLedger(fencedBed) === "");
  ok("(b) rødt stop tager ingen før-kopi", !existsSync(join(fencedBed, ".nogra", "paper", "archive")));

  // (c) Normal insertion is first in the chapter, archived once and idempotent by normalized pn.
  const existing = '<section class="page" id="side-K8s0"><h2>Før</h2><p class="pn">K8 · s.0</p></section>';
  const normalBed = bed(paper().replace("<!-- PAPER-KAPITEL-8-29-08 END -->", `${existing}\n<!-- PAPER-KAPITEL-8-29-08 END -->`));
  const normalBefore = readPaper(normalBed);
  const first = run("paper-chapter.mjs", normalBed, pageArgs);
  ok("(c) normal page -> exit 0", first.code === 0, first.out.trim());
  const firstPaper = readPaper(normalBed);
  const startAt = firstPaper.indexOf("<!-- PAPER-KAPITEL-8-29-08 START -->") + "<!-- PAPER-KAPITEL-8-29-08 START -->".length;
  ok("(c) siden står umiddelbart efter START", firstPaper.slice(startAt).trimStart().startsWith('<section class="page" id="side-K8s7">'));
  ok("(c) normaliseret id, kolofon, titel og pn står på siden",
    firstPaper.includes('id="side-K8s7"') &&
    firstPaper.includes("genereret af paper-chapter page") &&
    firstPaper.includes("<h2>Ny &lt;side&gt;</h2>") &&
    firstPaper.includes('<p class="pn">K8 · s.7</p>'));
  ok("(c) ny side står før kapitlets hidtidige side", firstPaper.indexOf("side-K8s7") < firstPaper.indexOf("side-K8s0"));
  const archiveDir = join(normalBed, ".nogra", "paper", "archive");
  const archivesAfterFirst = readdirSync(archiveDir).filter((name) => /^papiret-foer-page-.*\.html$/u.test(name));
  ok("(c) præcis én før-kopi findes", archivesAfterFirst.length === 1, String(archivesAfterFirst.length));
  ok("(c) før-kopien er papiret før skrivning", readFileSync(join(archiveDir, archivesAfterFirst[0]), "utf8") === normalBefore);

  const second = run("paper-chapter.mjs", normalBed, pageArgs);
  const secondPaper = readPaper(normalBed);
  ok("(c) anden identiske kørsel -> exit 0", second.code === 0, second.out.trim());
  ok("(c) samme pn findes stadig præcis én gang", (secondPaper.match(/id="side-K8s7"/gu) || []).length === 1);
  ok("(c) identisk er byte-idempotent", secondPaper === firstPaper);
  ok("(c) identisk kørsel tager ingen ny før-kopi", readdirSync(archiveDir).length === 1);
  const pageEvents = readLedger(normalBed).split("\n").filter(Boolean).map(JSON.parse)
    .filter((event) => event.event === "paper-page-added");
  ok("(c) præcis ét paper-page-added event", pageEvents.length === 1, String(pageEvents.length));
  ok("(c) eventet bærer kun tal + pn + kapitel, aldrig prosa",
    JSON.stringify(pageEvents[0]?.metadata) === JSON.stringify({ count: 1, pn: "K8 · s.7", chapter: 8 }) &&
    pageEvents[0]?.message === undefined && pageEvents[0]?.summary === undefined && pageEvents[0]?.details === undefined,
    JSON.stringify(pageEvents[0] || {}));

  const appendBed = bed(paper().replace("<!-- PAPER-KAPITEL-8-29-08 END -->", `${existing}\n<!-- PAPER-KAPITEL-8-29-08 END -->`));
  const appended = run("paper-chapter.mjs", appendBed, [...pageArgs, "--append"]);
  const appendedPaper = readPaper(appendBed);
  ok("(c) --append -> exit 0 og efter sidste side", appended.code === 0 && appendedPaper.indexOf("side-K8s7") > appendedPaper.indexOf("side-K8s0"), appended.out.trim());

  // (d) open owns order generation; audit gates missing rules and duplicate ids independently.
  const openBed = bed("<!doctype html><html><head><style>.book{display:flex}</style></head><body><div class=\"book\"></div></body></html>");
  const opened = run("paper-chapter.mjs", openBed, ["open", "--chapter", "3", "--title", "Tredje kapitel"]);
  const openedPaper = readPaper(openBed);
  const orderSpan = openedPaper.slice(openedPaper.indexOf("<!-- PAPER-ORDER START -->"), openedPaper.indexOf("<!-- PAPER-ORDER END -->"));
  ok("(d) open -> exit 0", opened.code === 0, opened.out.trim());
  ok("(d) open skriver START, skille og én order-regel i samme greb",
    /PAPER-KAPITEL-3-\d{2}-\d{2} START/u.test(openedPaper) &&
    openedPaper.includes('<section id="skille-k3" class="skille">') &&
    (orderSpan.match(/#skille-k3, \.book>section\[id\^="side-K3"\]\{order:3\}/gu) || []).length === 1);
  ok("(d) open-order består audit", run("paper-chapter.mjs", openBed, ["audit"]).code === 0);

  const noOrderBed = bed(paper({ chapter: 2 }));
  const noOrder = run("paper-chapter.mjs", noOrderBed, ["audit"]);
  ok("(d) audit -> exit 3 på kapitel uden order", noOrder.code === 3 && /uden order-regel: K2/u.test(noOrder.out), `${noOrder.code}: ${noOrder.out.trim()}`);

  const canonicalOrder = '<!-- PAPER-ORDER START -->\n#skille-k2, .book>section[id^="side-K2"]{order:2}\n<!-- PAPER-ORDER END -->';
  const duplicateBed = bed(paper({ chapter: 2, order: canonicalOrder }).replace("</div>", '<div id="samme"></div><p id="samme"></p></div>'));
  const duplicate = run("paper-chapter.mjs", duplicateBed, ["audit"]);
  ok("(d) audit -> exit 3 på id-kollision", duplicate.code === 3 && /id-kollisioner: samme×2/u.test(duplicate.out), `${duplicate.code}: ${duplicate.out.trim()}`);

  // (e) NOW's decision total comes from the newest paper-bound event, never its own parse.
  const boundLedger = [
    { createdAt: "2026-08-29T20:00:00", eventType: "paper-bound", metadata: { decisions: 11 } },
    { createdAt: "2026-08-29T21:23:00", eventType: "paper-bound", metadata: { decisions: 73 } },
  ].map(JSON.stringify).join("\n") + "\n";
  const boundBed = bed("<!doctype html><html><head><style></style></head><body><div class=\"book\"></div></body></html>", boundLedger);
  const boundNow = run("paper-now.mjs", boundBed, ["--no-event", "--now", "29/08/2026 21:24"]);
  ok("(e) paper-now med paper-bound -> exit 0", boundNow.code === 0, boundNow.out.trim());
  ok("(e) NOW viser nyeste paper-bound-tal og klokkeslæt", readPaper(boundBed).includes("73 domme (bundet 21:23)"));
  ok("(e) NOW viser ikke sin egen DECISIONS-total", !readPaper(boundBed).includes("i DECISIONS.md"));

  const unboundBed = bed("<!doctype html><html><head><style></style></head><body><div class=\"book\"></div></body></html>");
  const unboundNow = run("paper-now.mjs", unboundBed, ["--no-event", "--now", "29/08/2026 21:24"]);
  ok("(e) paper-now uden paper-bound -> exit 0", unboundNow.code === 0, unboundNow.out.trim());
  ok("(e) NOW uden event siger UMÅLT ordret", readPaper(unboundBed).includes("domme: UMÅLT (intet paper-bound)"));
} finally {
  for (const root of beds) rmSync(root, { recursive: true, force: true });
}

console.log(fails ? `\nsmoke-paper-chapter: FAIL (${fails} check(s))` : "\nsmoke-paper-chapter: ok");
process.exit(fails ? 1 : 0);
