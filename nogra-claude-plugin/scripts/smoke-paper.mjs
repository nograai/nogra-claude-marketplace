#!/usr/bin/env node
// Falsifiable smoke for the Paper bindings (drawing §6 d/e/f).
//
// Proves, against throwaway workspaces built from real fixtures:
//   (d) decide -> paper bind in the same grip: one new dom in DECISIONS.md -> the paper gains
//       exactly ONE more <details>, with no manual edit; and a workspace without a `paper` key
//       gets one line and exit 0 — a decision is NEVER blocked by its projection.
//   (e) paper now: measures, writes between its markers ONCE, is idempotent, stays inside the
//       line budget, reuses only the paper's own classes, and never injects command output as markup.
//   (f) the one-line status form has the shape /nogra:status prints, writes no event.
// Every check can FAIL if the claim it makes were wrong.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = "/Users/patricklarsen/y26dev";
const PAPER_FIXTURE = "/Users/patricklarsen/.claude/jobs/fbc1ef84/tmp/papiret-2026-08-21-22.html";

let fails = 0;
let skipped = 0;
const ok = (name, condition, detail = "") => {
  console.log((condition ? "  ok   " : "  FAIL ") + name + (condition || !detail ? "" : ` — ${detail}`));
  if (!condition) fails += 1;
};

const beds = [];
function bed({ paperKey = true, doors = null, sql = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nogpaper-"));
  beds.push(root);
  mkdirSync(join(root, ".nogra", "ledger"), { recursive: true });
  mkdirSync(join(root, ".nogra", "state"), { recursive: true });
  cpSync(PAPER_FIXTURE, join(root, "papiret.html"));
  cpSync(join(HUB, ".nogra", "state", "DECISIONS.md"), join(root, ".nogra", "state", "DECISIONS.md"));
  cpSync(join(HUB, ".nogra", "state", "FUND-INDEKS.md"), join(root, ".nogra", "state", "FUND-INDEKS.md"));
  writeFileSync(join(root, ".nogra", "ledger", "events.jsonl"), "", "utf8");
  const config = { workspaceId: "smoke-paper" };
  if (paperKey) {
    config.paper = {
      file: "papiret.html",
      artifactUrl: "https://claude.ai/code/artifact/smoke",
      decisions: ".nogra/state/DECISIONS.md",
      ledger: ".nogra/ledger/events.jsonl"
    };
    if (doors) config.paper.doors = doors;
    if (sql) config.paper.sql = sql;
  }
  writeFileSync(join(root, ".nogra", "config.json"), JSON.stringify(config), "utf8");
  return root;
}

function run(script, args) {
  try {
    return { code: 0, out: execFileSync("node", [join(HERE, script), ...args], { encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

const paperOf = (root) => readFileSync(join(root, "papiret.html"), "utf8");
const countDetails = (root) => (paperOf(root).match(/<details><summary><b>/gu) || []).length;
const ledgerLines = (root) =>
  readFileSync(join(root, ".nogra", "ledger", "events.jsonl"), "utf8").split("\n").filter((line) => line.trim()).length;

if (!existsSync(PAPER_FIXTURE)) {
  console.log(`  skip  paper fixture missing (${PAPER_FIXTURE}) — (d)/(e) not measured`);
  skipped += 1;
} else {
  // ------------------------------------------------------------------ (d) decide -> paper bind
  const decideBed = bed();
  run("nogra-decide-hook.mjs", ["--root", decideBed]);
  const before = countDetails(decideBed);
  ok("(d) baseline bind produced a block", before > 0, `${before} details`);

  const decisions = join(decideBed, ".nogra", "state", "DECISIONS.md");
  writeFileSync(
    decisions,
    `${readFileSync(decisions, "utf8")}\n- Date: 2026-08-23T15:45:00Z\n  **99 · Smoke-dom:** en dom skrevet af smoken.\n`,
    "utf8"
  );
  const hook = run("nogra-decide-hook.mjs", ["--root", decideBed]);
  const after = countDetails(decideBed);
  ok("(d) new dom -> exactly one more <details>, no manual edit", after === before + 1, `${before} -> ${after}`);
  ok("(d) the new dom is in the paper", paperOf(decideBed).includes("<b>99</b>"));
  ok("(d) operator line names the count and the republish",
    /Papiret opdateret \(\d+ domme\) — republicér\./u.test(hook.out), hook.out.trim());
  ok("(d) post-step exits 0", hook.code === 0);

  const noKey = bed({ paperKey: false });
  const blocked = run("nogra-decide-hook.mjs", ["--root", noKey]);
  ok("(d) no `paper` key -> one line, exit 0, decision never blocked",
    blocked.code === 0 && /dommen står\./u.test(blocked.out) && blocked.out.trim().split("\n").length === 1,
    blocked.out.trim());
  ok("(d) no `paper` key -> nothing written to the ledger", ledgerLines(noKey) === 0);

  // ------------------------------------------------------------------------------ (e) paper now
  const nowBed = bed({ doors: ["https://example.invalid"], sql: "printf '<b>not markup</b> 42'" });
  const first = run("paper-now.mjs", ["--root", nowBed, "--now", "23/08/2026 15:50"]);
  ok("(e) paper now exits 0", first.code === 0, first.out.trim());
  const page = paperOf(nowBed);
  ok("(e) markers appear exactly once",
    (page.match(/<!-- PAPER-NOW START -->/gu) || []).length === 1 &&
    (page.match(/<!-- PAPER-NOW END -->/gu) || []).length === 1);

  const section = page.slice(page.indexOf("<!-- PAPER-NOW START -->"), page.indexOf("<!-- PAPER-NOW END -->") + 22);
  const sectionLines = section.split("\n").length;
  ok("(e) section is within the 40-line budget", sectionLines <= 40, `${sectionLines} lines`);
  ok("(e) reuses the paper's own classes only",
    /class="page"/u.test(section) && /class="ed"/u.test(section) && /class="lead"/u.test(section) &&
    !/style=/u.test(section) && !/<style/u.test(section));
  ok("(e) the open-decision heuristic is stated on the page",
    /heuristik: overskriften nævner/u.test(section));
  ok("(e) a door that cannot be reached is measured, not guessed", /000<\/span>/u.test(section), "expected a 000 code");
  ok("(e) command output is embedded as TEXT, never as markup",
    section.includes("&lt;b&gt;not markup&lt;/b&gt; 42") && !section.includes("<b>not markup</b>"));

  run("paper-now.mjs", ["--root", nowBed, "--now", "23/08/2026 15:50", "--no-event"]);
  const twice = paperOf(nowBed);
  run("paper-now.mjs", ["--root", nowBed, "--now", "23/08/2026 15:50", "--no-event"]);
  ok("(e) idempotent: same stamp -> identical file", twice === paperOf(nowBed));
  ok("(e) still exactly one section after three runs",
    (paperOf(nowBed).match(/<!-- PAPER-NOW START -->/gu) || []).length === 1);

  const nowEvents = readFileSync(join(nowBed, ".nogra", "ledger", "events.jsonl"), "utf8")
    .split("\n").filter((line) => line.includes('"paper-now"'));
  ok("(e) exactly one paper-now receipt for one measured run", nowEvents.length === 1, `${nowEvents.length}`);
  const meta = nowEvents.length ? JSON.parse(nowEvents[0]).metadata : {};
  ok("(e) the receipt carries numbers only",
    Object.values(meta).every((value) => typeof value === "number"), JSON.stringify(meta));
  ok("(e) the receipt's html line count matches the page", meta.htmlLines === sectionLines,
    `${meta.htmlLines} vs ${sectionLines}`);

  // ---------------------------------------------------------------------------- (f) the one line
  const lineBed = decideBed;
  const beforeLines = ledgerLines(lineBed);
  const line = run("nogra-brain.mjs", ["line", "--root", lineBed]);
  ok("(f) line exits 0", line.code === 0, line.out.trim());
  ok("(f) shape: brain: <window> · brain-gap <n> · paper: <state>",
    /^brain: (inden for vinduet|over margin|over vinduet) · brain-gap .+ · paper: .+$/u.test(line.out.trim()),
    line.out.trim());
  ok("(f) line names a real bind time after decide bound the paper",
    /paper: bundet \d{2}:\d{2}$/u.test(line.out.trim()), line.out.trim());
  ok("(f) line writes no event", ledgerLines(lineBed) === beforeLines);

  const last = run("paper-bind.mjs", ["--last", "--root", lineBed]);
  ok("(f) --last reports the newest paper-bound", /^paper: bundet \d{2}:\d{2} · \d+ domme$/u.test(last.out.trim()),
    last.out.trim());
  ok("(f) --last on a never-bound workspace says so", /aldrig bundet/u.test(run("paper-bind.mjs", ["--last", "--root", noKey]).out));
}

for (const dir of beds) rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\nsmoke-paper: FAIL (${fails} check(s))` : `\nsmoke-paper: ok${skipped ? ` (${skipped} skipped)` : ""}`);
process.exit(fails ? 1 : 0);
