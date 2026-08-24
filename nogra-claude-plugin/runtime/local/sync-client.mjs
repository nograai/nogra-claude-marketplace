// Nogra Sync — the local edges (pull at session start, push at session end).
//
// The cloud side is a per-user Durable Object that owns the clock: it stores the two bounded
// files (MEMORY.md 2200 / USER.md 1375), union-merges every push line-by-line, and answers
// pull with the full state plus remote turns. Append-then-consolidate is the conflict
// resolver — the bound IS the sync engine. This client mirrors the DO's merge semantics
// exactly (same unionMerge), so both sides converge on the same line set.
//
// Contract (binding):
// - OFF by default. No `sync.enabled` in .nogra/config.json → zero behavior, zero latency.
// - The token is NEVER in config or git: env NOGRA_SYNC_TOKEN, or .nogra/memory/sync/token
//   (that directory is gitignored by the init bundle).
// - Fail-open, always: a broken network, bad token or malformed reply must never break a
//   session. Every run — success, skip or failure — leaves a receipt line in
//   .nogra/memory/sync/log.jsonl. Silent failure is a lie; quiet failure with a receipt is not.
// - Push pays only for change: an unchanged local state (same hash as last push) is skipped.
// - Remote turns land in .nogra/memory/sync/inbox.jsonl (cursor-gated, append-only), as raw
//   material for the next consolidation — remote surfaces may remember; only the home cleans up.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveNativeMemory } from "./native-memory.mjs";

export const SYNC_TIMEOUT_MS = 2500;
const MAX_REPLY_BYTES = 512 * 1024; // a brain snapshot is small; bigger replies are refused

export function syncDir(root) {
  return join(root, ".nogra", "memory", "sync");
}

function memoryResolution(root, overrides = {}) {
  if (overrides.memoryDir) {
    return {
      status: "resolved",
      resolvedDirectory: resolve(overrides.memoryDir),
      source: "test-or-explicit-override"
    };
  }
  return resolveNativeMemory({
    projectDir: root,
    hookInput: overrides.hookInput,
    transcriptPath: overrides.transcriptPath,
    env: overrides.env
  });
}

// Exact mirror of the worker's unionMerge: keep local lines and order, append remote lines
// whose trimmed form is unseen. Both sides run this, so push/pull converge.
export function unionMerge(local, remote) {
  const seen = new Set(String(local).split("\n").map((l) => l.trim()).filter(Boolean));
  const merged = String(local).split("\n");
  for (const ln of String(remote).split("\n")) {
    if (ln.trim() && !seen.has(ln.trim())) {
      merged.push(ln);
      seen.add(ln.trim());
    }
  }
  const out = merged.join("\n").trim();
  return out ? out + "\n" : "";
}

// The adopt-merge (DECISIONS #43/#57 + RAMMEN): when the HOME has consolidated, a union seat
// must ADOPT that truth — not union-merge its stale local in. unionMerge is add-only and can
// never propagate a home line-REMOVAL, so an unconditional merge regrows the seat monotonically
// (the 3653 ghost, 17/07). This is the three-way: the home's consolidated state is the base
// (remote wins), and only the lines this seat GENUINELY authored since it last adopted — local
// minus the last adopted base — are re-contributed, and only where the home does not already
// carry them. A line the home discarded lives in `base`, so it is never an "addition" and never
// comes back. A clean seat (local === base) yields the remote verbatim: the pure adopt.
export function adoptMerge(base, local, remote) {
  const baseSeen = new Set(
    String(base).split("\n").map((l) => l.trim()).filter(Boolean),
  );
  const additions = String(local)
    .split("\n")
    .filter((l) => l.trim() && !baseSeen.has(l.trim()));
  return unionMerge(String(remote), additions.join("\n"));
}

function hashOf(memory, user) {
  // "\0" is deliberate domain separation. Keep the two-character escape in
  // source: a raw NUL makes the module appear binary to forensic text tools.
  return createHash("sha256").update(memory).update("\0").update(user).digest("hex").slice(0, 16);
}

export function resolveSyncContext(root, overrides = {}) {
  const configPath = overrides.configPath || join(root, ".nogra", "config.json");
  let sync = null;
  try {
    sync = JSON.parse(readFileSync(configPath, "utf8")).sync || null;
  } catch {
    return null;
  }
  if (!sync || sync.enabled !== true) return null;
  const endpoint = String(sync.endpoint || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(endpoint)) {
    return null; // TLS only, except loopback for tests
  }
  let token = process.env.NOGRA_SYNC_TOKEN || "";
  if (!token) {
    try {
      token = readFileSync(overrides.tokenPath || join(syncDir(root), "token"), "utf8").trim();
    } catch {
      token = "";
    }
  }
  if (!token) return null;
  // mode "replace" marks the HOME seat: its push hands the cloud the consolidated state
  // verbatim instead of union-merging. The server enforces it (memory:replace scope) —
  // this flag only asks; a seat without the scope gets an honest 403 receipt.
  // The mode lives in a SEAT FILE (.nogra/memory/sync/mode — gitignored), never in the
  // shared config: a committed config travels to every seat via git, and "home" is a
  // property of ONE seat, not of the tree. (Learned live 13/07: the house pulled a config
  // that marked it home; only the scope fence caught it.) config.sync.mode is honored as
  // a legacy fallback when no seat file exists.
  let mode = sync.mode === "replace" ? "replace" : "union";
  try {
    const seat = readFileSync(overrides.modePath || join(syncDir(root), "mode"), "utf8").trim();
    if (seat) mode = seat === "replace" ? "replace" : "union";
  } catch {}
  return { endpoint, token, mode };
}

function readState(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeState(dir, state) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

function receipt(dir, entry) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry, authority: "advisory_projection_only" }) + "\n");
  } catch {}
}

function readLocal(memoryDir) {
  const read = (name) => {
    try {
      return readFileSync(join(memoryDir, name), "utf8");
    } catch {
      return "";
    }
  };
  return { memory: read("MEMORY.md"), user: read("USER.md") };
}

async function call(ctx, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(ctx.endpoint + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    if (text.length > MAX_REPLY_BYTES) throw new Error("reply too large");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`malformed reply (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}${body && body.error ? ` ${body.error}` : ""}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Session start: pull the cloud state, union-merge into the native home, land new remote
// turns in the inbox. Returns a short human note ("" when there is nothing worth saying).
export async function syncPull(root, overrides = {}) {
  const ctx = overrides.ctx || resolveSyncContext(root, overrides);
  if (!ctx) return "";
  const dir = overrides.syncDir || syncDir(root);
  const memory = memoryResolution(root, overrides);
  if (memory.status !== "resolved") {
    const problem = `native memory ${memory.status} (${memory.source})`;
    receipt(dir, { op: "pull", ok: memory.status === "disabled", skipped: problem });
    return memory.status === "disabled"
      ? ""
      : `<nogra-sync>Sync pull skipped — ${problem}; receipt logged.</nogra-sync>`;
  }
  const memoryDir = memory.resolvedDirectory;
  const started = Date.now();
  try {
    // The seat's honest report (D2): dirty = local changes the clock has not seen pushed.
    // The fingerprint machinery already knows — this is one hash compare, then one bit on
    // the wire. The clock stamps it on the sæde-tavle; other seats' knocks read it there.
    const preState = readState(dir);
    const preLocal = readLocal(memoryDir);
    const dirty = (preLocal.memory || preLocal.user) ? hashOf(preLocal.memory, preLocal.user) !== preState.lastPushHash : false;
    const remote = await call(ctx, `/sync/pull?dirty=${dirty ? 1 : 0}`);
    const local = readLocal(memoryDir);
    const remoteMemory = String(remote.memory || "");
    const remoteUser = String(remote.user || "");

    // ADOPT vs MERGE (DECISIONS #43/#57). A union seat ADOPTS the home's consolidated truth
    // once the sky has advanced — but only when a baseline sky is already known (a seat's
    // FIRST contact still merges: never blindly discard local before we have ever seen the
    // sky). The home (replace) IS the truth and never adopts. Everything else stays merge.
    const prevWm = Number(preState.lastSeenWm);
    const wmNum = Number(remote.wm);
    const wmAdvanced = Number.isFinite(prevWm) && Number.isFinite(wmNum) && wmNum > prevWm;
    const remoteHasContent = remoteMemory.trim() !== "" || remoteUser.trim() !== "";
    const doAdopt = ctx.mode !== "replace" && wmAdvanced && remoteHasContent;

    let nextMemory, nextUser, adopted = false;
    if (doAdopt && !dirty) {
      // clean seat: the home's truth is the whole truth — take it verbatim (line-removals land).
      nextMemory = remoteMemory;
      nextUser = remoteUser;
      adopted = true;
    } else if (doAdopt && preState.base && typeof preState.base === "object") {
      // diverged (dirty + advanced): adopt the home base, re-contribute only the seat's genuine
      // additions (local minus the last adopted base); a home-discarded line is never revived.
      nextMemory = adoptMerge(String(preState.base.memory || ""), local.memory, remoteMemory);
      nextUser = adoptMerge(String(preState.base.user || ""), local.user, remoteUser);
      adopted = true;
    } else {
      // merge: first contact, wm-less/older server, the home seat, or a dirty seat with no
      // stored base yet (mid-upgrade) — the honest union-merge; the base recorded below turns
      // the NEXT advanced pull into a clean three-way adopt. Named, self-healing gap.
      nextMemory = unionMerge(local.memory, remoteMemory);
      nextUser = unionMerge(local.user, remoteUser);
    }

    const changed = [];
    mkdirSync(memoryDir, { recursive: true });
    if (nextMemory !== local.memory) {
      writeFileSync(join(memoryDir, "MEMORY.md"), nextMemory);
      changed.push("MEMORY.md");
    }
    if (nextUser !== local.user) {
      writeFileSync(join(memoryDir, "USER.md"), nextUser);
      changed.push("USER.md");
    }
    const state = readState(dir);
    const lastCursor = Number(state.lastCursor || 0);
    const turns = Array.isArray(remote.turns) ? remote.turns.filter((t) => Number(t.rowid || 0) > lastCursor) : [];
    if (turns.length) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "inbox.jsonl"), turns.map((t) => JSON.stringify(t)).join("\n") + "\n");
    }
    const cursor = Number(remote.cursor || lastCursor);
    writeState(dir, {
      ...state,
      lastCursor: cursor,
      // The seat remembers which sky it saw — the front 6-guard's base_wm on next push.
      ...(Number.isFinite(wmNum) ? { lastSeenWm: wmNum } : {}),
      lastPullAt: new Date().toISOString(),
      memoryAuthority: "advisory_projection_only",
      // The adopted sky is the base for the next three-way adopt (client-only, bounded).
      ...(remoteHasContent ? { base: { memory: remoteMemory, user: remoteUser } } : {}),
      // On adopt the sky's content IS the new push-baseline: a clean adopt then never
      // spuriously re-pushes, and a diverged adopt still pushes exactly the seat's additions.
      ...(adopted ? { lastPushHash: hashOf(remoteMemory, remoteUser) } : {}),
      // Sæde-tavlen rejser med hjem (kun metadata) — stall-signalets føde.
      ...(remote.seat_board && typeof remote.seat_board === "object" ? { seatBoard: remote.seat_board, you: String(remote.you || "ukendt") } : {}),
    });
    receipt(dir, { op: "pull", ok: true, changed, adopted, newTurns: turns.length, cursor, ms: Date.now() - started });
    if (!changed.length && !turns.length) return "";
    return (
      `<nogra-sync authority="advisory_projection_only">Pulled from the cloud brain: ` +
      `${changed.length ? `${adopted ? "adopted the home's consolidated" : "merged"} ${changed.join(" + ")}` : "files unchanged"}` +
      `${turns.length ? ` · ${turns.length} remote turn${turns.length === 1 ? "" : "s"} landed in the sync inbox (raw material for the next consolidation)` : ""}.` +
      `</nogra-sync>`
    );
  } catch (err) {
    receipt(dir, { op: "pull", ok: false, error: String(err && err.message || err), ms: Date.now() - started });
    return `<nogra-sync>Sync pull failed (${String(err && err.message || err)}) — session continues on local state; receipt logged.</nogra-sync>`;
  }
}

// Session end: push the two bounded files — but only when they changed since the last push.
export async function syncPush(root, overrides = {}) {
  const ctx = overrides.ctx || resolveSyncContext(root, overrides);
  if (!ctx) return { skipped: "disabled" };
  const dir = overrides.syncDir || syncDir(root);
  const memory = memoryResolution(root, overrides);
  if (memory.status !== "resolved") {
    const problem = `native memory ${memory.status} (${memory.source})`;
    receipt(dir, { op: "push", ok: memory.status === "disabled", skipped: problem });
    return memory.status === "disabled"
      ? { skipped: "memory-disabled" }
      : { error: problem, skipped: "memory-unresolved" };
  }
  const memoryDir = memory.resolvedDirectory;
  const started = Date.now();
  try {
    const local = readLocal(memoryDir);
    if (!local.memory && !local.user) {
      receipt(dir, { op: "push", ok: true, skipped: "empty", ms: Date.now() - started });
      return { skipped: "empty" };
    }
    const hash = hashOf(local.memory, local.user);
    const state = readState(dir);
    if (state.lastPushHash === hash) {
      receipt(dir, { op: "push", ok: true, skipped: "unchanged", ms: Date.now() - started });
      return { skipped: "unchanged" };
    }
    const replace = ctx.mode === "replace";
    const pushOnce = async () => {
      const st = readState(dir);
      const bw = Number.isFinite(Number(st.lastSeenWm)) ? Number(st.lastSeenWm) : undefined;
      const loc = readLocal(memoryDir);
      const r = await call(ctx, replace ? "/sync/replace" : "/sync/push", {
        method: "POST",
        body: JSON.stringify(
          replace
            ? { memory: loc.memory, user: loc.user }
            : { memory: loc.memory, user: loc.user, turns: [], ...(bw !== undefined ? { base_wm: bw } : {}) },
        ),
      });
      return { r, loc };
    };
    // Budget-vagten (17/07): the sky refuses a union that would grow a bounded file past its
    // limit — the morning ghost (06:29) was exactly such a merge, STORED with only a warning.
    // A retry can never help here: pulling only makes the local union BIGGER. Honest stop —
    // the cure is consolidation at the HOME (replace), never a stubborn re-push.
    const overBudgetRefusal = (msg) => {
      receipt(dir, { op: "push", ok: false, refused: "over_budget", error: msg, ms: Date.now() - started });
      return {
        refused: "over_budget",
        error: msg,
        note: "the sky refused: this union would grow a bounded file past its limit — consolidate at the home and replace",
      };
    };
    let res, pushedLocal;
    try {
      ({ r: res, loc: pushedLocal } = await pushOnce());
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/HTTP 409 over_budget/.test(msg)) return overBudgetRefusal(msg);
      // Front 6-vagten bed: the sky moved since our last look. The cure IS the law:
      // pull (union-merge the fresh sky in), then push the re-based file — once.
      if (!replace && /HTTP 409 stale_base/.test(msg)) {
        await syncPull(root, overrides);
        try {
          ({ r: res, loc: pushedLocal } = await pushOnce());
        } catch (err2) {
          const msg2 = String(err2 && err2.message || err2);
          if (/HTTP 409 over_budget/.test(msg2)) return overBudgetRefusal(msg2);
          throw err2;
        }
      } else {
        throw err;
      }
    }
    // Re-read state at write time: the retry's inner pull may have moved lastSeenWm —
    // spreading the STALE top-of-function object here would clobber it (the same
    // step-order sin the guard exists to catch; the client shall not sin it itself).
    writeState(dir, {
      ...readState(dir),
      lastPushHash: hashOf(pushedLocal.memory, pushedLocal.user),
      lastPushAt: new Date().toISOString(),
    });
    const overBudget = Array.isArray(res && res.over_budget) ? res.over_budget : [];
    receipt(dir, { op: "push", ok: true, mode: ctx.mode, overBudget, ms: Date.now() - started });
    return { pushed: true, mode: ctx.mode, overBudget };
  } catch (err) {
    receipt(dir, { op: "push", ok: false, error: String(err && err.message || err), ms: Date.now() - started });
    return { error: String(err && err.message || err) };
  }
}

// The knock-knock (operatørens idé 14/07, dømt DONE på stedet — udvidet samme aften på
// operatørens diff-spørgsmål): sync is ONE system with two legs and one law per leg —
//
//   ① THE BRAIN rides the Cloudflare clock (the drawing's own caption: "Nogra BOUNDER +
//     SYNCER den. Ét memory-hjem") — automatic, never-manual: pull/push/tick.
//   ② THE TREE (the workspace form) rides GIT — curated commits, operator-gated pushes.
//     The engine never touches it; but the knock WATCHES it, because a seat building on
//     a tree that is behind its remote is building on stale ground.
//
// When either leg couldn't keep its promise — unpushed memory, a failing receipt, a
// tokenless seat, a silent seat, a tree behind/ahead of its upstream — the session gets
// ONE honest fact-line offering the matching move. The hook emits FACTS; the Manager
// delivers them in the operator's own register (the covenant's line, not ours). NOTHING
// here ever auto-pulls or auto-pushes git: hands stay the operator's where the law
// demands them. Runs BEFORE the session-start pull so "diff" means truth, not merge
// noise. Silent when sync is off (a choice, not a fault) and when everything converged.
export const NUDGE_STALE_MS = 24 * 60 * 60 * 1000; // a seat silent for a day earns a knock

// The tree-watch: behind/ahead vs the upstream AS OF THE LAST FETCH (a hook never goes
// to the network). No git, no upstream, or any error → null → silence. Facts only.
export function readGitTreeState(root) {
  const run = (args) =>
    execFileSync("git", ["-C", root, ...args], {
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
      // Optional locks off: a hook read must never take index.lock under a live seat.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
    })
      .toString()
      .trim();
  try {
    if (run(["rev-parse", "--is-inside-work-tree"]) !== "true") return null;
    const upstream = run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    const behind = Number(run(["rev-list", "--count", `HEAD..${upstream}`])) || 0;
    const ahead = Number(run(["rev-list", "--count", `${upstream}..HEAD`])) || 0;
    return { upstream, behind, ahead };
  } catch {
    return null;
  }
}

export function syncNudge(root, overrides = {}) {
  const dir = overrides.syncDir || syncDir(root);
  const memory = memoryResolution(root, overrides);
  const memoryDir = memory.status === "resolved" ? memory.resolvedDirectory : "";
  const ctx = overrides.ctx || resolveSyncContext(root, overrides);
  const facts = [];
  const moves = new Set();

  // ── leg ①: the brain (Cloudflare clock) ────────────────────────────────────
  if (!ctx) {
    // Bound-but-broken is knockworthy; unbound/disabled is a choice and stays silent.
    let sync = null;
    try {
      sync = JSON.parse(readFileSync(overrides.configPath || join(root, ".nogra", "config.json"), "utf8")).sync || null;
    } catch {}
    if (sync && sync.enabled === true) {
      facts.push("sync is bound on this seat but produced no context — most likely the token is MISSING (status shows presence; wiring it is the operator's own hand)");
      moves.add("wire the token");
    }
  } else {
    if (memory.status !== "resolved") {
      facts.push(`native memory is ${memory.status} (${memory.source}) — sync cannot safely select a memory home`);
      moves.add("fix the native memory path");
    }
    const state = readState(dir);
    const now = overrides.now ? overrides.now() : Date.now();
    const local = memoryDir ? readLocal(memoryDir) : { memory: "", user: "" };
    if ((local.memory || local.user) && state.lastPushHash && hashOf(local.memory, local.user) !== state.lastPushHash) {
      facts.push("local memory has UNPUSHED changes (diff vs last push)");
      moves.add('a "/nogra:sync run"');
    }
    try {
      const lines = readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n");
      const lastReceipt = JSON.parse(lines[lines.length - 1]);
      if (lastReceipt && lastReceipt.ok === false) {
        facts.push(`the last sync receipt FAILED (${lastReceipt.op}: ${lastReceipt.error || "unknown"})`);
        moves.add('a "/nogra:sync run"');
      }
    } catch {}
    const lastTouch = Math.max(Date.parse(state.lastPullAt || "") || 0, Date.parse(state.lastPushAt || "") || 0);
    const staleMs = overrides.staleMs ?? NUDGE_STALE_MS;
    if (lastTouch && now - lastTouch > staleMs) {
      facts.push(`this seat has not synced for ~${Math.round((now - lastTouch) / 3600000)}h`);
      moves.add('a "/nogra:sync run"');
    }

    // ── STALL-SIGNALET (D2/D3, 15/07): another seat is active with UNPUSHED state ──
    // The sæde-tavle rode home on the last pull. A dirty flag on a seat that is not us
    // means the freshest thoughts exist SOMEWHERE ELSE and no pull here can fetch them
    // until that seat pushes. Facts only — the Manager weaves the honest line into
    // answers where the staleness touches them (never blocks, never waits).
    const board = state.seatBoard;
    const you = state.you || "ukendt";
    if (board && typeof board === "object") {
      for (const [name, s] of Object.entries(board)) {
        if (name !== you && s && s.dirty === true) {
          facts.push(`STALL: seat "${name}" was active ${s.last_seen || "recently"} with UNPUSHED state — this brain may lag it, and a pull here cannot fetch what they have not pushed`);
          moves.add("weave an honest staleness line into answers it touches (never block)");
        }
      }
    }
  }

  // ── leg ②: the tree (git — watched, never driven) ──────────────────────────
  // Only a nogra workspace earns a tree-knock; a bare directory is none of our business.
  let isNogra = false;
  try {
    JSON.parse(readFileSync(overrides.configPath || join(root, ".nogra", "config.json"), "utf8"));
    isNogra = true;
  } catch {}
  if (isNogra) {
    const tree = overrides.readTreeState ? overrides.readTreeState(root) : readGitTreeState(root);
    if (tree && tree.behind > 0) {
      facts.push(`the workspace TREE is ${tree.behind} commit(s) BEHIND ${tree.upstream} (as of the last fetch) — building here is building on stale ground`);
      moves.add("a git pull");
    }
    if (tree && tree.ahead > 0) {
      facts.push(`the TREE is ${tree.ahead} commit(s) AHEAD of ${tree.upstream} — other seats cannot see them yet`);
      moves.add("a curated push (operator's call)");
    }
  }

  if (!facts.length) return "";
  return `<nogra-sync-nudge>brain/tree says diff: ${facts.join(" · ")}. Offer the operator the matching move (${[...moves].join(" · ")}) before the day continues — one line, their register, their call. Never pull or push git yourself without their word.</nogra-sync-nudge>`;
}

// The RAMMEN tick — the third trigger (push on write · pull on session-start · tick):
// debounced, diff-gated, fail-open. Runs mid-session (PostToolBatch, async) so a long day
// never leaves the seats stale and push/pull is never a manual act. A write to either
// bounded file since the last tick beats the debounce (push-on-write); otherwise the
// interval gates. Pull/push pay their own way (cursor-gated pull, hash-gated push), so a
// converged tick costs one cheap GET. The stamp is written BEFORE the network calls: a
// failing endpoint debounces too — no hot loop, and the failure still leaves receipts.
export const TICK_MIN_INTERVAL_MS = 20 * 60 * 1000; // operatørens interval-markør (14/07): 20 min

export async function syncTick(root, overrides = {}) {
  const ctx = overrides.ctx || resolveSyncContext(root, overrides);
  if (!ctx) return { skipped: "disabled" };
  const dir = overrides.syncDir || syncDir(root);
  const memory = memoryResolution(root, overrides);
  if (memory.status !== "resolved") {
    receipt(dir, {
      op: "tick",
      ok: memory.status === "disabled",
      skipped: `native memory ${memory.status} (${memory.source})`
    });
    return { skipped: memory.status === "disabled" ? "memory-disabled" : "memory-unresolved" };
  }
  const memoryDir = memory.resolvedDirectory;
  const interval = overrides.minIntervalMs ?? TICK_MIN_INTERVAL_MS;
  const now = overrides.now ? overrides.now() : Date.now();
  const state = readState(dir);
  const lastTickMs = Date.parse(state.lastTickAt || "") || 0;
  // Write-detection never compares the file clock to the wall clock — they are two
  // DIFFERENT clocks and they skew (measured 14/07: tmpfs mtime ~4ms behind Date.now(),
  // which silently swallowed push-on-write). Instead each tick remembers the files'
  // fingerprints (mtime + size) and a write is "any fingerprint we haven't seen".
  // The debounce interval below stays wall-clock vs wall-clock — same source, sound.
  const seen = state.tickMtimes || {};
  const nowMtimes = {};
  let wroteSince = false;
  for (const name of ["MEMORY.md", "USER.md"]) {
    try {
      const st = statSync(join(memoryDir, name));
      nowMtimes[name] = `${st.mtimeMs}:${st.size}`;
      if (nowMtimes[name] !== seen[name]) wroteSince = true;
    } catch {}
  }
  if (!wroteSince && now - lastTickMs < interval) return { skipped: "debounced" };
  writeState(dir, { ...state, lastTickAt: new Date(now).toISOString(), tickMtimes: nowMtimes });
  const started = Date.now();
  // RACE-STREGEN (17/07, GO efter tre beviste race-hits — 16/07 "3098c -> 3098c", hus-Fables
  // to kur-tab, bænkens 12-min re-infektion): "Skriver kronen, taler kronen. Lytter kronen,
  // kun når den intet har at sige." På HOME-sædet (replace) er den lokale fil SANDHEDEN —
  // et pull før push union-merger himlen ind i en nyrenset fil og genopliver præcis det,
  // konsolideringen fjernede. Kronen har ingen base at rebase mod; kronen ER basen. Derfor:
  // home + write-tick = PUSH ALENE (kuren når himlen urørt) · home + stille tick = PULL alene
  // (lyt/ingest — sikkert nu hvor budget- og stale-vagten holder himlen ren). Union-sæder
  // beholder pull-før-push uændret: dét ER front 6-loven for sæder uden kronen.
  const home = ctx.mode === "replace";
  const pullNote = home && wroteSince ? "" : await syncPull(root, overrides);
  const push = home && !wroteSince ? { skipped: "home-listens" } : await syncPush(root, overrides);
  receipt(dir, {
    op: "tick",
    ok: !push.error,
    trigger: wroteSince ? "write" : "interval",
    ...(home ? { crown: wroteSince ? "speaks" : "listens" } : {}),
    pull: home && wroteSince ? "skipped:crown-speaks" : pullNote ? "changes" : "clean",
    push: push.skipped ? `skipped:${push.skipped}` : push.error ? "FAIL" : "ok",
    ms: Date.now() - started,
  });
  return { ticked: true, trigger: wroteSince ? "write" : "interval", pull: pullNote, push };
}
