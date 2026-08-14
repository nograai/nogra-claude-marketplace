#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseChangelog,
  localClaudeVersion,
  runChangelogLoop,
} from "./changelog-loop.mjs";

let checks = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
};

const root = mkdtempSync(join(tmpdir(), "nogra-changelog-smoke-"));
const stateFile = join(root, ".nogra", "state", "claude-changelog-seen.json");
const source = [
  "# Changelog",
  "",
  "## 2.1.218",
  "- Current",
  "",
  "## 2.1.217",
  "- Previous",
  "",
].join("\n");
const response = {
  ok: true,
  status: 200,
  text: async () => source,
};
const fetchImpl = async () => response;

const parsed = parseChangelog(source);
ok("parser returns newest-first entries", parsed.length === 2 && parsed[0].version === "2.1.218");
ok("parser preserves entry body", parsed[1].body === "- Previous");

const version = localClaudeVersion({
  execFileSync(command) {
    if (command === "claude") throw new Error("not on PATH");
    return "2.1.218 (Claude Code)\n";
  },
});
ok("CLI version lookup falls back to the managed local binary", version === "2.1.218");

const checkOnly = await runChangelogLoop({
  root,
  stateFile,
  checkOnly: true,
  fetchImpl,
  localVersion: "2.1.218",
});
ok("check-only first pass reports a baseline", checkOnly.status === "baseline");
ok("check-only never creates state", !existsSync(stateFile));

const seeded = await runChangelogLoop({
  root,
  stateFile,
  seedVersion: "2.1.217",
  now: () => "2026-07-24T00:00:00.000Z",
});
ok("seed writes an explicit baseline", seeded.status === "seeded");
ok("seed receipt records the chosen version", JSON.parse(readFileSync(stateFile, "utf8")).lastSeenVersion === "2.1.217");

const movedCheck = await runChangelogLoop({
  root,
  stateFile,
  checkOnly: true,
  fetchImpl,
  localVersion: "2.1.218",
});
ok("check-only detects one new version", movedCheck.status === "moved" && movedCheck.fresh.length === 1);
ok("check-only preserves the old watermark", JSON.parse(readFileSync(stateFile, "utf8")).lastSeenVersion === "2.1.217");

const moved = await runChangelogLoop({
  root,
  stateFile,
  fetchImpl,
  localVersion: "2.1.218",
  now: () => "2026-07-24T01:00:00.000Z",
});
const stamped = JSON.parse(readFileSync(stateFile, "utf8"));
ok("explicit normal run stamps the new version", moved.status === "moved" && stamped.lastSeenVersion === "2.1.218");
ok("stamp preserves the previous version", stamped.previousVersion === "2.1.217");

const unchanged = await runChangelogLoop({
  root,
  stateFile,
  fetchImpl,
  localVersion: "2.1.218",
});
ok("second run is a no-op", unchanged.status === "unchanged");

const unreachable = await runChangelogLoop({
  root,
  stateFile,
  fetchImpl: async () => {
    throw new Error("offline");
  },
  localVersion: "2.1.218",
});
ok("unreachable source is fail-open and never claims success", unreachable.status === "unreachable" && unreachable.exitCode === 0);

console.log(`\n${checks} checks passed — changelog watcher is explicit, deterministic and fail-open.`);
