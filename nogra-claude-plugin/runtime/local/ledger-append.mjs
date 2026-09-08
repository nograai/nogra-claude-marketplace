// ledger-append — the ONE door into a workspace ledger from plugin code.
//
// Born 02/09/2026 after a measured split: the plugin numbered events as
// `nonEmptyLineCount + 1` while the workspace's own door (`bin/uret-append`,
// CEO-GO 05/08/2026 after duplicate watermarks #134/#135) numbers them as
// `highest ledgerWatermark + 1`. In the hub ledger that was 5508 vs 4890 on
// the same file (4,299 legacy lines carry no watermark). Two authorities,
// two sequences. This module mirrors the workspace rule exactly:
//
//   - one writer at a time (exclusive lock file, stale-lock recovery),
//   - next watermark = highest existing `ledgerWatermark` + 1 (never line count),
//   - a supplied watermark that collides or skips is REFUSED, never repaired,
//   - idempotent by `eventId` (an existing id returns the existing event),
//   - append-only: this module can never rewrite history.
//
// Every plugin path that appends a `nogra.ledger.event.v1` event goes through
// `appendLedgerEvent` below.

import fs from "node:fs";
import path from "node:path";

// Defaults: a live holder is waited on for up to 10 s (48 fsync'ed appends from
// six processes finish in ~1 s; hooks carry a 10 s timeout), a lock older than
// 30 s with a dead pid is stale. Both are env-overridable so tests can shorten
// them — read at call time, never frozen at import.
const LOCK_POLL_MS = 15;
function lockStaleMs() {
  const v = Number(process.env.NOGRA_LEDGER_LOCK_STALE_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}
function lockWaitMs() {
  const v = Number(process.env.NOGRA_LEDGER_LOCK_WAIT_MS);
  return Number.isFinite(v) && v >= 0 ? v : 10_000;
}

export function ledgerEventsFile(root) {
  return path.join(root, ".nogra", "ledger", "events.jsonl");
}

export function ledgerLockFile(root) {
  return path.join(root, ".nogra", "runtime", "ledger-append.lock");
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, ".000Z");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJsonIfValid(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLedgerLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).filter((line) => line.trim());
}

/** Highest `ledgerWatermark` present in the file (0 for an empty or missing ledger). */
export function highestLedgerWatermark(file) {
  let last = 0;
  for (const line of readLedgerLines(file)) {
    try {
      const wm = JSON.parse(line)?.ledgerWatermark;
      if (Number.isInteger(wm) && wm > last) last = wm;
    } catch {
      // a line that is not JSON cannot carry a watermark — skip, never count
    }
  }
  return last;
}

/** The workspace rule: next = highest + 1. Never the line count. */
export function nextLedgerWatermark(file) {
  return highestLedgerWatermark(file) + 1;
}

export function findLedgerEvent(file, field, key) {
  const wanted = String(key ?? "");
  if (!wanted) return null;
  for (const line of readLedgerLines(file)) {
    try {
      const item = JSON.parse(line);
      if (String(item?.[field] ?? "") === wanted) return item;
    } catch {
      // skip unparsable lines
    }
  }
  return null;
}

/**
 * Run `operation` while holding the workspace's ledger lock. Waits briefly for
 * a live holder, recovers a stale lock (dead pid, older than LOCK_STALE_MS),
 * and otherwise throws — a caller must never proceed unlocked.
 */
export function withLedgerLock(root, operation) {
  const lock = ledgerLockFile(root);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const started = Date.now();
  let handle;
  for (;;) {
    try {
      handle = fs.openSync(lock, "wx");
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: nowIso() }));
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      // Staleness is judged by the lock file's mtime, never by its content: a
      // holder that has just created the file and not yet written its pid must
      // read as LIVE. (Measured 02/09: content-based judgment let a second
      // writer unlink a fresh lock and produced duplicate watermark #28.)
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; } // vanished → retry
      const existing = readJsonIfValid(lock);
      const stale = ageMs > lockStaleMs() && !pidAlive(existing?.pid);
      if (stale) {
        try { fs.unlinkSync(lock); } catch {}
        continue;
      }
      if (Date.now() - started > lockWaitMs()) {
        throw new Error(`ledger-append: another ledger writer holds ${lock}; retry after it finishes`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return operation();
  } finally {
    try { fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

/**
 * Append one `nogra.ledger.event.v1` event under the workspace rule.
 * Returns `{ status: "applied" | "skipped", event }`. Throws when a supplied
 * `ledgerWatermark` does not equal the next watermark (collision or skip).
 */
export function appendLedgerEvent(root, event, { idempotencyField = "eventId" } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("ledger-append: event must be a JSON object");
  }
  const file = ledgerEventsFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLedgerLock(root, () => {
    const existing = findLedgerEvent(file, idempotencyField, event[idempotencyField]);
    if (existing) return { status: "skipped", event: existing };
    const next = nextLedgerWatermark(file);
    const supplied = event.ledgerWatermark;
    if (supplied !== undefined && supplied !== null && supplied !== next) {
      throw new Error(`ledger-append: supplied watermark ${supplied} != next ${next} (highest is ${next - 1}); omit the field and let the door number it`);
    }
    const at = nowIso();
    const stamped = {
      schema: "nogra.ledger.event.v1",
      ...event,
      ledgerWatermark: next,
      generatedAt: event.generatedAt || at,
      createdAt: event.createdAt || at
    };
    if (!stamped.eventId) {
      stamped.eventId = `ledger-event-${at.replace(/[-:T]/gu, "").slice(0, 14)}-wm${next}`;
    }
    const fd = fs.openSync(file, "a");
    try {
      fs.writeSync(fd, `${JSON.stringify(stamped)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return { status: "applied", event: stamped };
  });
}
