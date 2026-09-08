#!/usr/bin/env node
// smoke-ledger-append — the plugin's ledger door follows the workspace rule.
//
// Pins (measured 02/09/2026 on the hub ledger: 5,507 lines, highest watermark
// 4,889, 4,299 legacy lines without a watermark):
//   1. next watermark = highest existing + 1, NEVER the line count;
//   2. a supplied watermark that collides or skips is refused;
//   3. idempotent by eventId;
//   4. N concurrent writers from separate processes never produce a duplicate
//      or a gap;
//   5. a stale lock (dead pid, old timestamp) is recovered, a live lock is waited on.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedgerEvent,
  highestLedgerWatermark,
  ledgerEventsFile,
  ledgerLockFile,
  nextLedgerWatermark,
  readLedgerLines
} from "../runtime/local/ledger-append.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(here, "..", "runtime", "local", "ledger-append.mjs");

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-ledger-append-"));
  fs.mkdirSync(path.join(root, ".nogra", "ledger"), { recursive: true });
  fs.writeFileSync(path.join(root, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke" }));
  return root;
}

// 1 + legacy lines: three watermarked events, two legacy lines without a watermark, one blank line.
{
  const root = tempWorkspace();
  const file = ledgerEventsFile(root);
  fs.writeFileSync(file, [
    JSON.stringify({ schema: "nogra.ledger.event.v1", eventId: "a", ledgerWatermark: 1, type: "note" }),
    JSON.stringify({ schema: "nogra.event.v1", eventId: "legacy-1", eventType: "wall", message: "no watermark" }),
    JSON.stringify({ schema: "nogra.ledger.event.v1", eventId: "b", ledgerWatermark: 2, type: "note" }),
    "",
    JSON.stringify({ schema: "nogra.event.v1", eventId: "legacy-2", eventType: "wall", message: "no watermark" }),
    JSON.stringify({ schema: "nogra.ledger.event.v1", eventId: "c", ledgerWatermark: 3, type: "note" })
  ].join("\n") + "\n");
  assert.equal(readLedgerLines(file).length, 5, "five non-empty lines");
  assert.equal(highestLedgerWatermark(file), 3, "highest watermark is 3");
  assert.equal(nextLedgerWatermark(file), 4, "next is highest+1 = 4, not lineCount+1 = 6");

  const applied = appendLedgerEvent(root, { type: "note", summary: "first", workspaceId: "smoke" });
  assert.equal(applied.status, "applied");
  assert.equal(applied.event.ledgerWatermark, 4, "door numbers the event 4");
  assert.equal(applied.event.schema, "nogra.ledger.event.v1");
  assert.match(applied.event.eventId, /^ledger-event-\d{14}-wm4$/u, "generated eventId carries the watermark");

  // 2: collision and skip are refused
  assert.throws(() => appendLedgerEvent(root, { type: "note", eventId: "x", ledgerWatermark: 4 }), /supplied watermark 4 != next 5/u, "collision refused");
  assert.throws(() => appendLedgerEvent(root, { type: "note", eventId: "y", ledgerWatermark: 9 }), /supplied watermark 9 != next 5/u, "skip refused");
  assert.equal(nextLedgerWatermark(file), 5, "a refused write changes nothing");
  const supplied = appendLedgerEvent(root, { type: "note", eventId: "z", ledgerWatermark: 5 });
  assert.equal(supplied.status, "applied");
  assert.equal(supplied.event.ledgerWatermark, 5, "a correct supplied watermark is accepted");

  // 3: idempotent by eventId
  const again = appendLedgerEvent(root, { type: "note", eventId: "z", summary: "different body" });
  assert.equal(again.status, "skipped");
  assert.equal(again.event.ledgerWatermark, 5, "existing event returned, nothing appended");
  assert.equal(readLedgerLines(file).length, 7, "seven non-empty lines after two applied writes");
  assert.ok(!fs.existsSync(ledgerLockFile(root)), "lock released after every call");
}

// 4: concurrent writers from separate processes — no duplicates, no gaps
{
  const root = tempWorkspace();
  const file = ledgerEventsFile(root);
  fs.writeFileSync(file, `${JSON.stringify({ schema: "nogra.ledger.event.v1", eventId: "seed", ledgerWatermark: 10, type: "note" })}\n`);
  const writer = path.join(root, "writer.mjs");
  fs.writeFileSync(writer, [
    `import { appendLedgerEvent } from ${JSON.stringify(helper)};`,
    "const [root, n] = process.argv.slice(2);",
    "for (let i = 0; i < Number(n); i += 1) {",
    "  const r = appendLedgerEvent(root, { type: 'note', summary: `p${process.pid}-${i}`, workspaceId: 'smoke' });",
    "  process.stdout.write(`${r.event.ledgerWatermark}\\n`);",
    "}"
  ].join("\n"));
  const procs = 6;
  const perProc = 8;
  const results = [];
  // spawnSync runs sequentially per call; use detached async spawns via a tiny orchestrator process instead
  const orchestrator = path.join(root, "orchestrate.mjs");
  fs.writeFileSync(orchestrator, [
    "import { spawn } from 'node:child_process';",
    "const [writer, root, procs, perProc] = process.argv.slice(2);",
    "const children = [];",
    "for (let i = 0; i < Number(procs); i += 1) {",
    "  const child = spawn(process.execPath, [writer, root, perProc], { stdio: ['ignore', 'pipe', 'inherit'] });",
    "  let out = '';",
    "  child.stdout.on('data', (d) => { out += d; });",
    "  children.push(new Promise((resolve) => child.on('close', (code) => resolve({ code, out }))));",
    "}",
    "const done = await Promise.all(children);",
    "if (done.some((d) => d.code !== 0)) { console.error('writer failed'); process.exit(1); }",
    "process.stdout.write(done.map((d) => d.out).join(''));"
  ].join("\n"));
  const run = spawnSync(process.execPath, [orchestrator, writer, root, String(procs), String(perProc)], { encoding: "utf8" });
  assert.equal(run.status, 0, `orchestrator exit 0 (stderr: ${run.stderr})`);
  const numbers = run.stdout.split("\n").filter(Boolean).map(Number).sort((a, b) => a - b);
  assert.equal(numbers.length, procs * perProc, "every writer wrote every event");
  const expected = Array.from({ length: procs * perProc }, (_, i) => 11 + i);
  assert.deepEqual(numbers, expected, "watermarks 11..58 exactly once each — no duplicate, no gap");
  const lines = readLedgerLines(file);
  assert.equal(lines.length, 1 + procs * perProc, "file holds seed + every event, no torn line");
  for (const line of lines) JSON.parse(line);
  assert.ok(!fs.existsSync(ledgerLockFile(root)), "no lock left behind by concurrent writers");
  results.push(numbers.length);
}

// 5: stale lock recovered; live lock waited on then refused
{
  const root = tempWorkspace();
  const lock = ledgerLockFile(root);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, createdAt: "2020-01-01T00:00:00.000Z" }));
  // Staleness is judged by mtime (a fresh file is LIVE even with old content) — age the file itself.
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  const r = appendLedgerEvent(root, { type: "note", eventId: "after-stale" });
  assert.equal(r.status, "applied", "stale lock (dead pid, old) is recovered");
  assert.equal(r.event.ledgerWatermark, 1);

  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  process.env.NOGRA_LEDGER_LOCK_WAIT_MS = "400";
  const started = Date.now();
  assert.throws(() => appendLedgerEvent(root, { type: "note", eventId: "while-live" }), /another ledger writer holds/u, "a live lock is refused, not stolen");
  assert.ok(Date.now() - started >= 350, "the refusal came after waiting the configured budget, not immediately");
  delete process.env.NOGRA_LEDGER_LOCK_WAIT_MS;
  fs.unlinkSync(lock);
  // A fresh lock with UNREADABLE content (holder mid-write) is live too — never stolen.
  fs.writeFileSync(lock, "");
  process.env.NOGRA_LEDGER_LOCK_WAIT_MS = "200";
  assert.throws(() => appendLedgerEvent(root, { type: "note", eventId: "while-fresh-empty" }), /another ledger writer holds/u, "a fresh empty lock is treated as live");
  delete process.env.NOGRA_LEDGER_LOCK_WAIT_MS;
  fs.unlinkSync(lock);
}

console.log("smoke-ledger-append: ok (workspace rule: highest+1, refusal, idempotency, 48 concurrent writes, lock recovery)");
