#!/usr/bin/env node
// Generic, deterministic coverage for the installation delta's "Learned today" unit.
import assert from "node:assert/strict";
import { learnedToday, buildBlock } from "./paper-bind.mjs";

const now = new Date("2026-09-08T12:00:00.000Z");
const recent = "2026-09-08T11:00:00.000Z";
const event = (extra = {}) => ({ type: "fund", createdAt: recent, summary: "A measured lesson.", ...extra });
let passed = 0, failed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`ok - ${name}`); }
  catch (error) { failed++; console.error(`FAIL - ${name}: ${error.message}`); }
}

check("only the four learning event types are selected", () => {
  const types = ["fund", "rettelse", "kur", "kur-stop", "candidate-built", "note"];
  assert.deepEqual(learnedToday(types.map(type => event({ type })), { now }).map(e => e.type), types.slice(0, 4));
});
check("the last 24 hours includes its boundaries and excludes old and future events", () => {
  const times = ["2026-09-07T11:59:59.999Z", "2026-09-07T12:00:00.000Z", now.toISOString(), "2026-09-08T12:00:00.001Z"];
  assert.deepEqual(learnedToday(times.map((createdAt, i) => event({ createdAt, ledgerWatermark: i + 10 })), { now }).map(e => e.index), [11, 12]);
});
check("invalid timestamps and empty lessons stay absent", () => {
  assert.deepEqual(learnedToday([event({ createdAt: "invalid" }), event({ summary: " \n " })], { now }), []);
});
check("generatedAt and ts legacy timestamps are supported", () => {
  assert.equal(learnedToday([event({ createdAt: undefined, generatedAt: recent }), event({ createdAt: undefined, ts: recent })], { now }).length, 2);
});
check("watermarks remain event identity and legacy entries use their parsed index", () => {
  assert.deepEqual(learnedToday([event({ ledgerWatermark: 700 }), event()], { now }).map(e => e.index), [700, 2]);
});
check("projection leaves the ledger objects unchanged", () => {
  const events = [event({ summary: "One\n measured   lesson." })];
  const before = JSON.stringify(events);
  assert.equal(learnedToday(events, { now })[0].text, "One measured lesson.");
  assert.equal(JSON.stringify(events), before);
});
check("emoji text below 320 code points does not gain an ellipsis", () => {
  const text = "🌟".repeat(200);
  assert.equal(learnedToday([event({ summary: text })], { now })[0].text, text);
});
check("text longer than 320 code points is shortened without splitting emoji", () => {
  assert.equal(learnedToday([event({ summary: "🌟".repeat(321) })], { now })[0].text, "🌟".repeat(320) + "…");
});
check("non-object legacy ledger values do not break the learning projection", () => {
  assert.equal(learnedToday([null, 0, "legacy", [], event()], { now }).length, 1);
});
check("learned markup is escaped and the open section is omitted when no lessons match", () => {
  const args = { decisions: "", now: "08/09/2026 12:00", nowDate: now, marker: "PAPER-BIND", generator: "fixture" };
  const { block } = buildBlock({ ...args, ledger: JSON.stringify(event({ summary: '<script>alert("x")</script>', ledgerWatermark: 91 })) });
  assert.ok(block.includes('<details open><summary><b>Lært i dag</b>'));
  assert.ok(block.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(block.includes('#91'));
  assert.ok(block.includes('2026-09-08 11:00 UTC'));
  assert.ok(!block.includes('<script>'));
  assert.ok(!buildBlock({ ...args, ledger: JSON.stringify(event({ type: "note" })) }).block.includes("Lært i dag"));
  const legacy = buildBlock({ ...args, ledger: "not JSON\n" + JSON.stringify(event()) }).block;
  assert.ok(legacy.includes('legacy 1'));
  assert.ok(!legacy.includes('>#1<'));
});
console.log(`learned-today smoke: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
