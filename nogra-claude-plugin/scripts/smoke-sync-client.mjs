#!/usr/bin/env node
// Smoke: the Nogra Sync edges (runtime/local/sync-client.mjs).
// A local stub stands in for the cloud DO; every scenario runs against real files in temp dirs.
// Coverage mirrors the reference lab's test design: happy paths over the real wire format,
// plus the negatives (bad token, offline, malformed, disabled) — all fail-open.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unionMerge, resolveSyncContext, syncPull, syncPush, syncTick } from "../runtime/local/sync-client.mjs";

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function freshDirs() {
  const base = mkdtempSync(join(tmpdir(), "nogra-sync-smoke-"));
  const memoryDir = join(base, "memory");
  const sync = join(base, "sync");
  mkdirSync(memoryDir, { recursive: true });
  return { base, memoryDir, sync };
}

// ---- stub cloud ------------------------------------------------------------
const state = { memory: "- cloud line one\n", user: "cloud user fact\n", turns: [{ rowid: 1, ts: "t", role: "user", text: "hello from chat" }], cursor: 1, hits: [], pushes: [], replaces: [], pullDirty: [], board: null, you: null };
const server = createServer((req, res) => {
  state.hits.push(req.url);
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer good-token") {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (req.url.startsWith("/sync/pull")) {
    state.pullDirty.push(new URL(req.url, "http://x").searchParams.get("dirty")); // record the seat's honest report
    if (state.malformNext) {
      state.malformNext = false; // one-shot: the NEXT pull gets garbage, everything after heals
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("this is not json");
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      memory: state.memory, user: state.user, turns: state.turns, cursor: state.cursor,
      ...(state.board ? { seat_board: state.board, you: state.you } : {}), // seat-aware server when configured
    }));
  }
  if (req.url === "/sync/push") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.pushes.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ imported_turns: 0, memory_chars: 10, user_chars: 5, over_budget: ["MEMORY.md"] }));
    });
    return;
  }
  if (req.url === "/sync/replace") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.replaces.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ changed: true, memory_chars: 20, user_chars: 0, imported_turns: 0, over_budget: [] }));
    });
    return;
  }
  if (req.url === "/sync/malformed") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("this is not json");
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const good = { endpoint, token: "good-token" };

// 1. disabled → no-op, zero network
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: false, endpoint } }));
  const ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json") });
  const before = state.hits.length;
  const note = await syncPull(d.base, { ctx, memoryDir: d.memoryDir, syncDir: d.sync });
  const push = await syncPush(d.base, { ctx, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("disabled config resolves to null context", ctx === null);
  ok("disabled sync is a silent no-op with zero network calls", note === "" && push.skipped === "disabled" && state.hits.length === before);
}

// 2. TLS guard: non-loopback http endpoint refused
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint: "http://evil.example.com" } }));
  writeFileSync(join(d.base, "token"), "good-token");
  const ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token") });
  ok("plain-http non-loopback endpoint is refused (TLS only)", ctx === null);
}

// 3. token resolution: config+token file arms the context
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token\n");
  const ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token") });
  ok("enabled config + token file resolves context (loopback allowed for tests)", ctx && ctx.token === "good-token" && ctx.endpoint === endpoint);
}

// 4. pull merges remote lines into local files and lands turns in the inbox
{
  const d = freshDirs();
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- local line\n");
  const note = await syncPull(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  const memory = readFileSync(join(d.memoryDir, "MEMORY.md"), "utf8");
  const user = readFileSync(join(d.memoryDir, "USER.md"), "utf8");
  ok("pull union-merges remote MEMORY.md after local lines (worker-canon semantics, inner blank kept)", memory === "- local line\n\n- cloud line one\n");
  ok("pull creates USER.md from cloud when local is absent", user === "cloud user fact\n");
  ok("pull lands remote turns in the sync inbox", readFileSync(join(d.sync, "inbox.jsonl"), "utf8").includes("hello from chat"));
  ok("pull note names the merge and the inbox", note.includes("MEMORY.md") && note.includes("1 remote turn"));
  const st = JSON.parse(readFileSync(join(d.sync, "state.json"), "utf8"));
  ok("pull records the cursor", st.lastCursor === 1);

  // second pull: same cloud state → converged, nothing changes, no duplicate turns
  const note2 = await syncPull(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  const inboxLines = readFileSync(join(d.sync, "inbox.jsonl"), "utf8").trim().split("\n").length;
  ok("second pull is silent and cursor-gated (no duplicate inbox turns)", note2 === "" && inboxLines === 1);
}

// 5. push sends only on change, then skips unchanged
{
  const d = freshDirs();
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- push me\n");
  writeFileSync(join(d.memoryDir, "USER.md"), "profile\n");
  const first = await syncPush(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("push sends the two bounded files", first.pushed === true && state.pushes.at(-1).memory === "- push me\n" && state.pushes.at(-1).user === "profile\n");
  ok("push surfaces the cloud over-budget verdict", Array.isArray(first.overBudget) && first.overBudget.includes("MEMORY.md"));
  const before = state.pushes.length;
  const second = await syncPush(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("unchanged state skips the push entirely (never pay for unchanged state)", second.skipped === "unchanged" && state.pushes.length === before);
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- push me\n- new line\n");
  const third = await syncPush(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("a changed file pushes again", third.pushed === true && state.pushes.length === before + 1);
}

// 6. empty home never pushes emptiness over the cloud
{
  const d = freshDirs();
  const res = await syncPush(d.base, { ctx: good, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("an empty local home is never pushed", res.skipped === "empty");
}

// 7. bad token fails open with a receipt
{
  const d = freshDirs();
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- x\n");
  const note = await syncPull(d.base, { ctx: { endpoint, token: "wrong" }, memoryDir: d.memoryDir, syncDir: d.sync });
  const log = readFileSync(join(d.sync, "log.jsonl"), "utf8");
  ok("bad token fails open: note admits the failure, session continues", note.includes("failed") && note.includes("401"));
  ok("bad token leaves an error receipt", log.includes('"ok": false') || log.includes('"ok":false'));
  ok("bad token never mutates local files", readFileSync(join(d.memoryDir, "MEMORY.md"), "utf8") === "- x\n");
}

// 8. offline endpoint fails open
{
  const d = freshDirs();
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- something to push\n");
  const res = await syncPush(d.base, { ctx: { endpoint: "http://127.0.0.1:1", token: "good-token" }, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("offline cloud fails open on push", typeof res.error === "string");
}

// 9. malformed reply fails open — the stub REALLY serves garbage for one pull
{
  const d = freshDirs();
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- local stays\n");
  state.malformNext = true;
  const note = await syncPull(d.base, { ctx: { endpoint, token: "good-token" }, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("malformed reply fails open: note admits the malformed reply", note.includes("failed") && note.includes("malformed reply"));
  ok("malformed reply never mutates local files", readFileSync(join(d.memoryDir, "MEMORY.md"), "utf8") === "- local stays\n");
  ok("malformed reply leaves an error receipt", /"op":"pull","ok":false/.test(readFileSync(join(d.sync, "log.jsonl"), "utf8")));
  ok("unionMerge mirrors the worker: dedupes trimmed lines, keeps order, trailing newline",
    unionMerge("- a\n- b\n", "- b\n- c\n") === "- a\n- b\n\n- c\n" && unionMerge("", "") === "");
}

// 10. the home verb: mode "replace" routes to /sync/replace, no turns ride along
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint, mode: "replace" } }));
  writeFileSync(join(d.base, "token"), "good-token");
  const ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token") });
  ok("config mode:replace resolves to a home-seat context", ctx && ctx.mode === "replace");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- consolidated truth\n");
  const before = state.hits.length;
  const res = await syncPush(d.base, { ctx, memoryDir: d.memoryDir, syncDir: d.sync });
  ok("home push hits /sync/replace, never /sync/push", state.hits.slice(before).includes("/sync/replace") && !state.hits.slice(before).includes("/sync/push"));
  ok("replace body carries the two files and NO turns", state.replaces.length === 1 && state.replaces[0].memory === "- consolidated truth\n" && !("turns" in state.replaces[0]));
  ok("home push reports its mode in the result", res.pushed === true && res.mode === "replace");
  const log = readFileSync(join(d.sync, "log.jsonl"), "utf8");
  ok("home push receipt names the mode", log.includes('"mode":"replace"') || log.includes('"mode": "replace"'));
}

// 11. default mode stays union — no accidental homes
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token");
  const ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token") });
  ok("no mode in config resolves to union (off-by-default for the strong verb)", ctx && ctx.mode === "union");
}

// 12. the seat file is canonical: it grants home without config, and DEMOTES a legacy config-home
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token");
  writeFileSync(join(d.base, "mode"), "replace\n");
  let ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token"), modePath: join(d.base, "mode") });
  ok("seat file alone marks the home seat (config stays clean for git)", ctx && ctx.mode === "replace");
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint, mode: "replace" } }));
  writeFileSync(join(d.base, "mode"), "union\n");
  ctx = resolveSyncContext(d.base, { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token"), modePath: join(d.base, "mode") });
  ok("seat file OVERRIDES a legacy config mode (a pulled config can never make a seat home)", ctx && ctx.mode === "union");
}

// 13. the RAMMEN tick — debounced, write-beats-debounce, converged is cheap, receipts on all
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- local truth\n");
  const ov = { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token"), syncDir: d.sync, memoryDir: d.memoryDir, minIntervalMs: 60_000 };
  let r = await syncTick(d.base, ov);
  ok("first tick fires (fresh files beat the debounce — push-on-write)", r.ticked === true && r.trigger === "write");
  r = await syncTick(d.base, ov);
  ok("converged re-tick is cheap (pull merged at tick 1 → push skips unchanged)", r.ticked === true && r.push && r.push.skipped === "unchanged");
  r = await syncTick(d.base, ov);
  ok("third tick debounces (no writes since stamp, interval not passed)", r.skipped === "debounced");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), readFileSync(join(d.memoryDir, "MEMORY.md"), "utf8") + "- a brand new line\n");
  r = await syncTick(d.base, ov);
  ok("a bounded-file write beats the debounce (push-on-write, trigger named)", r.ticked === true && r.trigger === "write" && r.push && r.push.pushed === true);
  const log = readFileSync(join(d.sync, "log.jsonl"), "utf8");
  ok("the tick leaves its own receipt (op:tick, trigger named)", log.includes('"op":"tick"') && log.includes('"trigger":"write"'));
  const disabled = await syncTick(d.base, { ...ov, configPath: join(d.base, "missing.json") });
  ok("tick is off-by-default (no sync config → skipped:disabled)", disabled.skipped === "disabled");
}

// 14. the knock-knock — facts only, no noise, silent when off/converged
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- converged truth\n");
  const ov = { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token"), syncDir: d.sync, memoryDir: d.memoryDir };
  const { syncNudge } = await import("../runtime/local/sync-client.mjs");
  await syncPush(d.base, ov); // converge the seat first
  ok("converged seat gets NO knock (silence is the default)", syncNudge(d.base, ov) === "");
  const behindKnock = syncNudge(d.base, { ...ov, readTreeState: () => ({ upstream: "origin/main", behind: 3, ahead: 0 }) });
  ok("a tree BEHIND its upstream earns the knock (stale ground named, pull offered)",
    behindKnock.includes("BEHIND origin/main") && behindKnock.includes("git pull"));
  const aheadKnock = syncNudge(d.base, { ...ov, readTreeState: () => ({ upstream: "origin/main", behind: 0, ahead: 2 }) });
  ok("a tree AHEAD earns the knock — and git hands stay the operator's",
    aheadKnock.includes("AHEAD") && aheadKnock.includes("operator's call") && aheadKnock.includes("Never pull or push git yourself"));
  ok("a converged tree stays silent", syncNudge(d.base, { ...ov, readTreeState: () => ({ upstream: "origin/main", behind: 0, ahead: 0 }) }) === "");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- converged truth\n- a line the cloud never saw\n");
  const diffKnock = syncNudge(d.base, ov);
  ok("unpushed local changes earn the knock (brain says diff)", diffKnock.includes("nogra-sync-nudge") && diffKnock.includes("UNPUSHED"));
  ok("the knock hands the door to the OPERATOR (register + call are theirs)", diffKnock.includes("/nogra:sync run") && diffKnock.includes("their call"));
  await syncPush(d.base, ov); // converge again
  // change memory FIRST — otherwise the hash-gate skips before the network can fail
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- converged truth\n- a line the cloud never saw\n- and one more\n");
  const res = await syncPush(d.base, { ...ov, ctx: { endpoint: "http://127.0.0.1:1", token: "good-token" } });
  ok("(setup) offline push failed and left a FAIL receipt", typeof res.error === "string");
  const failKnock = syncNudge(d.base, ov);
  ok("a failing last receipt earns the knock with the op named", failKnock.includes("FAILED") && failKnock.includes("push"));
  const staleKnock = syncNudge(d.base, { ...ov, now: () => Date.now() + 30 * 60 * 60 * 1000 });
  ok("a long-silent seat earns the knock with the hours named", staleKnock.includes("not synced for"));
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  const tokenless = syncNudge(d.base, { ...ov, tokenPath: join(d.base, "no-such-token") });
  ok("bound-but-tokenless seat earns the wiring knock", tokenless.includes("token is MISSING"));
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: false, endpoint } }));
  ok("sync OFF stays silent (off is a choice, not a fault)", syncNudge(d.base, ov) === "");
}

// 15. SÆDE-TAVLEN + STALL-SIGNALET (D1-D5, 15/07) — the seat reports honestly, the board
// rides home, and the knock calls out another seat's unpushed thoughts. Facts only.
{
  const d = freshDirs();
  writeFileSync(join(d.base, "config.json"), JSON.stringify({ sync: { enabled: true, endpoint } }));
  writeFileSync(join(d.base, "token"), "good-token");
  writeFileSync(join(d.memoryDir, "MEMORY.md"), "- fresh local thought\n");
  const ov = { configPath: join(d.base, "config.json"), tokenPath: join(d.base, "token"), syncDir: d.sync, memoryDir: d.memoryDir };
  const { syncNudge } = await import("../runtime/local/sync-client.mjs");

  state.board = { sbx: { last_seen: "t9", last_pushed: null, dirty: true }, "stub-seat": { last_seen: "t9", last_pushed: "t8", dirty: false } };
  state.you = "stub-seat";
  const before = state.pullDirty.length;
  await syncPull(d.base, ov);
  ok("pull reports dirty=1 honestly (unpushed local, no lastPushHash yet)", state.pullDirty[before] === "1");
  const st = JSON.parse(readFileSync(join(d.sync, "state.json"), "utf8"));
  ok("the sæde-tavle + you persisted from the pull response", st.you === "stub-seat" && st.seatBoard && st.seatBoard.sbx.dirty === true);

  const knock = syncNudge(d.base, ov);
  ok("STALL-signalet fires: another seat is dirty — named, with the honest-line move",
    knock.includes('STALL: seat "sbx"') && knock.includes("UNPUSHED") && knock.includes("weave an honest staleness line"));
  ok("own seat's flag never knocks itself (stub-seat clean in board)", !knock.includes('seat "stub-seat"'));

  await syncPush(d.base, ov); // converge → next pull reports clean
  const b2 = state.pullDirty.length;
  await syncPull(d.base, ov);
  ok("pull reports dirty=0 after a landed push (converged is honest too)", state.pullDirty[b2] === "0");

  state.board.sbx.dirty = false; // sbx pushed elsewhere; board comes home clean on next pull
  await syncPull(d.base, ov);
  const calm = syncNudge(d.base, ov);
  ok("stall clears when the other seat's push lands — no stall-fact remains", !calm.includes("STALL:"));

  state.board = null; state.you = null; // old server without a board
  await syncPull(d.base, ov);
  ok("a board-less (older) server degrades gracefully — pull fine, no crash", true);
}

server.close();
console.log(`\n${passed} checks passed — sync edges hold. EXIT=0`);
