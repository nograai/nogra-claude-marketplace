#!/usr/bin/env node
// Falsifiable smoke for the brain VALVE in the plugin's SessionEnd hook (drawing §6a, dom 34).
//
// Proves, against a throwaway workspace and a throwaway HOME (never the real ones):
//   1. under the margin            -> nothing: no ledger line, no note in inbox/out
//   2. over the margin             -> exactly ONE `consolidation_due` event + ONE note line
//   3. second run, same day        -> still exactly ONE event (no duplicate per workspace per day)
//   4. checkpoint alone over 150   -> fires (the house's own window, not Claude's)
//   5. the numbers in the event    -> equal the numbers the test wrote (wc -l semantics)
//   6. SessionStart                -> ONE warning line while the due is unanswered, silence after
//   7. fail-open                   -> a read-only ledger never makes the hook exit non-zero
//   8. the consolidation receipt   -> `consolidated` refuses a non-archive path, stamps ONCE,
//                                     appends exactly ONE MEMORY.md footer line, is idempotent,
//                                     and the SessionStart warning goes quiet afterwards
// Every check can FAIL if the claim it makes were wrong.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSION_END = join(HERE, "..", "hooks", "session-end.mjs");
const MEMORY_LOAD = join(HERE, "..", "hooks", "memory-load.mjs");

let fails = 0;
const ok = (name, condition, detail = "") => {
  console.log((condition ? "  ok   " : "  FAIL ") + name + (condition || !detail ? "" : ` — ${detail}`));
  if (!condition) fails += 1;
};

const beds = [];
function bed({ indexLines = 10, indexPad = 0, checkpointLines = 10, user = "" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "nogvalve-home-"));
  const root = mkdtempSync(join(tmpdir(), "nogvalve-ws-"));
  beds.push(home, root);
  mkdirSync(join(root, ".nogra", "ledger"), { recursive: true });
  writeFileSync(join(root, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke-valve" }), "utf8");
  writeFileSync(join(root, ".nogra", "ledger", "events.jsonl"), "", "utf8");
  // Same derivation native-memory.mjs uses when no setting and no transcript names a directory.
  const memDir = join(home, ".claude", "projects", resolve(root).replace(/[\\/]/gu, "-"), "memory");
  mkdirSync(memDir, { recursive: true });
  // Exactly `indexLines` newline characters -> `wc -l` reports exactly `indexLines`.
  const index = `${Array.from({ length: indexLines }, (_, i) => `- memory line ${i}`).join("\n")}\n`;
  writeFileSync(join(memDir, "MEMORY.md"), index + "x".repeat(indexPad), "utf8");
  writeFileSync(
    join(memDir, "project_checkpoint.md"),
    `${Array.from({ length: checkpointLines }, (_, i) => `- checkpoint line ${i}`).join("\n")}\n`,
    "utf8"
  );
  if (user) writeFileSync(join(memDir, "USER.md"), user, "utf8");
  return { home, root, memDir };
}

function env(place) {
  return {
    ...process.env,
    HOME: place.home,
    USERPROFILE: place.home,
    CLAUDE_CONFIG_DIR: join(place.home, ".claude"),
    CLAUDE_PROJECT_ROOT: place.root,
    CLAUDE_PROJECT_DIR: place.root,
    NOGRA_NATIVE_MEMORY_DIR: "",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: ""
  };
}

function endSession(place) {
  const payload = JSON.stringify({
    hook_event_name: "SessionEnd",
    session_id: "smoke-valve",
    cwd: place.root,
    workspace_roots: [place.root],
    reason: "other"
  });
  try {
    execFileSync("node", [SESSION_END], { input: payload, env: env(place), encoding: "utf8" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

function startSession(place) {
  const payload = JSON.stringify({ hook_event_name: "SessionStart", cwd: place.root, source: "startup" });
  const out = execFileSync("node", [MEMORY_LOAD], { input: payload, env: env(place), encoding: "utf8" });
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

function dueEvents(place) {
  const file = join(place.root, ".nogra", "ledger", "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((event) => (event.eventType || event.type) === "consolidation_due");
}

function noteFiles(place) {
  const dir = join(place.root, "inbox", "out");
  if (!existsSync(dir)) return [];
  return execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter(Boolean);
}

// ---------------------------------------------------------------- 1. under the margin -> silence
const quiet = bed({ indexLines: 10, checkpointLines: 10 });
ok("under margin -> hook exits 0", endSession(quiet) === 0);
ok("under margin -> no consolidation_due in the ledger", dueEvents(quiet).length === 0, `${dueEvents(quiet).length} events`);
ok("under margin -> no note written", noteFiles(quiet).length === 0, noteFiles(quiet).join(","));

// ------------------------------------------------- 2. over the LINE margin -> one event, one note
const loud = bed({ indexLines: 260, checkpointLines: 20 });
ok("over margin -> hook exits 0 (never blocks session end)", endSession(loud) === 0);
const loudEvents = dueEvents(loud);
ok("over margin -> exactly one consolidation_due", loudEvents.length === 1, `${loudEvents.length} events`);
ok("over margin -> written by the PLUGIN hook", loudEvents[0]?.source === "hooks/session-end.mjs", String(loudEvents[0]?.source));
ok("over margin -> plugin event shape (no guessed watermark)",
  loudEvents[0]?.schema === "nogra.event.v1" && !("ledgerWatermark" in (loudEvents[0] || {})));
const loudNotes = noteFiles(loud);
ok("over margin -> exactly one note in inbox/out", loudNotes.length === 1, loudNotes.join(","));
ok("over margin -> note is named for the day", /^consolidation-due-\d{4}-\d{2}-\d{2}\.md$/u.test(loudNotes[0] || ""), loudNotes[0]);
const noteText = loudNotes.length ? readFileSync(join(loud.root, "inbox", "out", loudNotes[0]), "utf8") : "";
ok("over margin -> the note is ONE line", noteText.trimEnd().split("\n").length === 1, `${noteText.trimEnd().split("\n").length} lines`);
ok("over margin -> the note points at the skill", noteText.includes("/nogra:brain consolidate"));

// ---------------------------------------------------------------- 5. the numbers are measurements
const meta = loudEvents[0]?.metadata || {};
ok("measured index lines == what the test wrote (wc -l)", meta.indexLines === 260, String(meta.indexLines));
ok("measured checkpoint lines == what the test wrote", meta.checkpointLines === 20, String(meta.checkpointLines));
ok("measured file count == files on disk", meta.files === 2, String(meta.files));
// native-memory.mjs realpaths what it resolves (/var -> /private/var on macOS); compare realpaths.
ok("measured memory dir == the resolved native dir", meta.memoryDir === realpathSync.native(loud.memDir), String(meta.memoryDir));
ok("window is dom 34 (200 lines / 25 KB, margin 150 / 15 KB, checkpoint 150)",
  meta.window?.indexLines === 200 && meta.window?.indexBytes === 25 * 1024 &&
  meta.window?.marginLines === 150 && meta.window?.marginBytes === 15 * 1024 &&
  meta.window?.checkpointLines === 150, JSON.stringify(meta.window));

// ------------------------------------------------------ 3. second run the same day -> no duplicate
ok("second run same day -> hook exits 0", endSession(loud) === 0);
ok("second run same day -> still exactly one consolidation_due", dueEvents(loud).length === 1, `${dueEvents(loud).length} events`);
ok("second run same day -> still exactly one note", noteFiles(loud).length === 1);

// ------------------------------------------------------------- 2b. byte margin alone also fires
const fat = bed({ indexLines: 10, indexPad: 16 * 1024, checkpointLines: 10 });
endSession(fat);
ok("MEMORY.md over 15 KB margin (few lines) -> fires", dueEvents(fat).length === 1, `${dueEvents(fat).length} events`);
ok("byte breach names bytes, not lines", /bytes > margin 15360/u.test(dueEvents(fat)[0]?.message || ""), dueEvents(fat)[0]?.message);

// ---------------------------------------------------- 4. checkpoint alone over its window -> fires
const heavyCheckpoint = bed({ indexLines: 10, checkpointLines: 200 });
endSession(heavyCheckpoint);
ok("project_checkpoint.md over 150 lines -> fires", dueEvents(heavyCheckpoint).length === 1, `${dueEvents(heavyCheckpoint).length} events`);

// ------------------------------------------------- 6. SessionStart says it once, then goes quiet
const startContext = startSession(loud);
const dueLines = startContext.split("\n").filter((line) => line.startsWith("⚠ consolidation due since "));
ok("SessionStart -> exactly ONE due warning line", dueLines.length === 1, `${dueLines.length} lines`);
ok("the line states the measurement", /MEMORY\.md 260 lines \/ [\d.]+ KB/u.test(dueLines[0] || ""), dueLines[0]);
ok("the line offers the skill, never asks", (dueLines[0] || "").endsWith("offer /nogra:brain consolidate") && !(dueLines[0] || "").includes("?"));

// an answering receipt closes it: `brain-consolidated` (and the pre-plugin `consolidation_done`)
for (const answer of ["brain-consolidated", "consolidation_done"]) {
  const place = bed({ indexLines: 260 });
  endSession(place);
  const before = startSession(place).split("\n").filter((line) => line.startsWith("⚠ consolidation due")).length;
  const ledger = join(place.root, ".nogra", "ledger", "events.jsonl");
  writeFileSync(ledger, `${readFileSync(ledger, "utf8")}${JSON.stringify({
    schema: "nogra.event.v1", eventId: `answer-${answer}`, createdAt: new Date(Date.now() + 60000).toISOString(),
    workspaceId: "smoke-valve", eventType: answer, message: "receipt"
  })}\n`, "utf8");
  const after = startSession(place).split("\n").filter((line) => line.startsWith("⚠ consolidation due")).length;
  ok(`${answer} answers the due -> warning goes quiet`, before === 1 && after === 0, `before=${before} after=${after}`);
}

// ------------------------------------------------- 8. the consolidation receipt closes the loop
const cons = bed({ indexLines: 260 });
const BRAIN = join(HERE, "nogra-brain.mjs");
const archive = join(cons.memDir, "archive");
mkdirSync(archive, { recursive: true });
const receiptPath = join(archive, "consolidation-run-42-2026-08-23.md");
writeFileSync(receiptPath, [
  "# Consolidation run 42 — 2026-08-23",
  "",
  "## Målt FØR → EFTER",
  "",
  "| | FØR | EFTER |",
  "|---|---|---|",
  "| live .md-filer (ekskl. MEMORY.md) | 62 | **41** |",
  "| bytes, ekskl. MEMORY.md | 309.912 | 240.100 (−69.812 B) |",
  "| MEMORY.md | 15.295 B / 260 linjer | **8.192 B / 96 linjer** |",
  ""
].join("\n"), "utf8");

function consolidated(place, receipt) {
  try {
    return { code: 0, out: execFileSync("node", [BRAIN, "consolidated", "--receipt", receipt, "--memory-dir", place.memDir, "--root", place.root], { env: env(place), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}
const indexPath = join(cons.memDir, "MEMORY.md");
const indexLinesOf = () => readFileSync(indexPath, "utf8").split("\n").length;
const consolidatedEvents = () => readFileSync(join(cons.root, ".nogra", "ledger", "events.jsonl"), "utf8")
  .split("\n").filter((line) => line.includes('"brain-consolidated"'));

endSession(cons);
const warnedBefore = startSession(cons).split("\n").filter((line) => line.startsWith("⚠ consolidation due")).length;
ok("8. the valve warned before the receipt", warnedBefore === 1, `${warnedBefore}`);

// a receipt that is not in archive/ is refused — the archive IS the evidence, not a loose file
const loose = join(cons.memDir, "loose-receipt.md");
writeFileSync(loose, readFileSync(receiptPath, "utf8"), "utf8");
const refused = consolidated(cons, loose);
ok("8. receipt outside archive/ -> refused, exit 2", refused.code === 2 && /archive/u.test(refused.out), `exit ${refused.code}`);
ok("8. refusal wrote nothing", consolidatedEvents().length === 0);

const missing = consolidated(cons, join(archive, "consolidation-run-99-2026-01-01.md"));
ok("8. missing receipt -> refused, nothing written", missing.code !== 0 && consolidatedEvents().length === 0, `exit ${missing.code}`);

const linesBefore = indexLinesOf();
const stamped = consolidated(cons, receiptPath);
ok("8. real receipt -> exit 0", stamped.code === 0, stamped.out.trim());
ok("8. exactly one brain-consolidated event", consolidatedEvents().length === 1, `${consolidatedEvents().length}`);
const consMeta = consolidatedEvents().length ? JSON.parse(consolidatedEvents()[0]).metadata : {};
ok("8. the event carries the receipt's numbers",
  consMeta.run === 42 && consMeta.filesBefore === 62 && consMeta.filesAfter === 41 && consMeta.indexBytes === 8192,
  JSON.stringify(consMeta));
ok("8. the event names the receipt under archive/", consMeta.receipt === "archive/consolidation-run-42-2026-08-23.md", String(consMeta.receipt));
ok("8. MEMORY.md gained exactly ONE line", indexLinesOf() === linesBefore + 1, `${linesBefore} -> ${indexLinesOf()}`);
const footer = readFileSync(indexPath, "utf8").trimEnd().split("\n").pop();
ok("8. the footer line has the drawn form",
  /^\*Run 42 \(2026-08-23\): 62 → 41 filer · indeks [\d,]+ KB · receipt archive\/consolidation-run-42-2026-08-23\.md\*$/u.test(footer),
  footer);

// idempotent: the ledger is the guard, not a local flag
const again = consolidated(cons, receiptPath);
ok("8. second call with the same receipt -> exit 0, nothing written",
  again.code === 0 && consolidatedEvents().length === 1 && indexLinesOf() === linesBefore + 1, again.out.trim());
ok("8. the second call says so in one line", /allerede kvitteret/u.test(again.out));

const warnedAfter = startSession(cons).split("\n").filter((line) => line.startsWith("⚠ consolidation due")).length;
ok("8. brain-consolidated closes the alarm -> SessionStart quiet", warnedAfter === 0, `${warnedAfter}`);

// ------------------------------------------------------------------------------ 7. fail-open
const locked = bed({ indexLines: 260 });
const lockedLedgerDir = join(locked.root, ".nogra", "ledger");
chmodSync(lockedLedgerDir, 0o500);
const lockedStatus = endSession(locked);
chmodSync(lockedLedgerDir, 0o700);
ok("unwritable ledger -> hook still exits 0 (fail-open)", lockedStatus === 0, `exit ${lockedStatus}`);

// a workspace with no native memory at all must stay silent, not crash
const bare = mkdtempSync(join(tmpdir(), "nogvalve-bare-"));
beds.push(bare);
mkdirSync(join(bare, ".nogra", "ledger"), { recursive: true });
writeFileSync(join(bare, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke-bare" }), "utf8");
writeFileSync(join(bare, ".nogra", "ledger", "events.jsonl"), "", "utf8");
const bareHome = mkdtempSync(join(tmpdir(), "nogvalve-barehome-"));
beds.push(bareHome);
const bareStatus = endSession({ home: bareHome, root: bare });
ok("no native memory -> hook exits 0 and stays silent",
  bareStatus === 0 && dueEvents({ root: bare }).length === 0 && noteFiles({ root: bare }).length === 0);

for (const dir of beds) rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\nsmoke-brain-valve: FAIL (${fails} check(s))` : "\nsmoke-brain-valve: ok");
process.exit(fails ? 1 : 0);
