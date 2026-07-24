#!/usr/bin/env node
// Falsifiable smoke for the explicit, operator-gated TREE leg.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  treeFetch,
  treeState,
  ledgerCheck,
  treePlan,
  parseLedger,
  readRemoteLedger,
} from "../runtime/local/tree-sync.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(pluginRoot, "scripts", "sync-cli.mjs");
let checks = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
};

const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "smoke",
      GIT_AUTHOR_EMAIL: "smoke@example.test",
      GIT_COMMITTER_NAME: "smoke",
      GIT_COMMITTER_EMAIL: "smoke@example.test",
    },
  })
    .toString()
    .trim();

function runCli(root, args) {
  try {
    const output = execFileSync("node", [cli, ...args], {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        NOGRA_SYNC_TOKEN: "",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout || ""}${error.stderr || ""}`,
    };
  }
}

const event = (watermark, id, actor, type = "note") =>
  `${JSON.stringify({
    type,
    summary: `s${watermark}`,
    ts: "2026-07-18T00:00:00Z",
    actor,
    ledgerWatermark: watermark,
    eventId: id,
  })}\n`;

const base = mkdtempSync(join(tmpdir(), "nogra-tree-smoke-"));
const origin = join(base, "origin.git");
const house = join(base, "house");
const bench = join(base, "bench");
git(base, "init", "--bare", origin);
git(base, "clone", origin, house);
git(house, "checkout", "-b", "main");
mkdirSync(join(house, ".nogra", "ledger"), { recursive: true });
writeFileSync(
  join(house, ".nogra", "config.json"),
  JSON.stringify({ workspaceId: "smoke" }),
);
writeFileSync(
  join(house, ".nogra", "ledger", "events.jsonl"),
  event(1, "e1", "shared") + event(2, "e2", "shared"),
);
writeFileSync(join(house, "tool.mjs"), "export const a = 1;\n");
git(house, "add", "-A");
git(house, "commit", "-m", "shared ledger tail");
git(house, "push", "-u", "origin", "main");
git(base, "clone", origin, bench);
git(bench, "checkout", "main");

{
  treeFetch(bench);
  const state = treeState(bench);
  const check = ledgerCheck(
    readFileSync(join(bench, ".nogra/ledger/events.jsonl"), "utf8"),
    readRemoteLedger(bench, state.upstream),
  );
  ok("converged tree reports zero ahead and behind", state.behind === 0 && state.ahead === 0);
  ok("converged ledger is clean", check.verdict === "clean" && check.cures.length === 0);
  ok("converged plan is no-op", treePlan(state, check).move === "no-op");
}

{
  appendFileSync(
    join(house, ".nogra", "ledger", "events.jsonl"),
    event(3, "e3-house", "fable-house"),
  );
  writeFileSync(
    join(house, "tool.mjs"),
    "export const a = 2;\nexport function houseChange() {}\n",
  );
  git(house, "add", "-A");
  git(house, "commit", "-m", "house advances");
  git(house, "push");
  treeFetch(bench);
  const state = treeState(bench);
  const check = ledgerCheck(
    readFileSync(join(bench, ".nogra/ledger/events.jsonl"), "utf8"),
    readRemoteLedger(bench, state.upstream),
  );
  ok("bench reports one incoming commit", state.behind === 1 && state.ahead === 0);
  ok("incoming file list is the reading plan", state.incomingFiles.some((file) => file.includes("tool.mjs")));
  ok("remote-only event is counted", check.remoteOnly === 1 && check.verdict === "clean");
  ok("clean remote-ahead tree plans pull", treePlan(state, check).move === "pull" && !treePlan(state, check).gated);
  const result = runCli(bench, ["tree", "push"]);
  ok("push is denied while behind", result.code === 1 && /DENIED.*behind/i.test(result.output));
}

{
  const result = runCli(bench, ["tree", "pull"]);
  ok("explicit tree pull fast-forwards", result.code === 0 && /tree pull: ok/i.test(result.output));
  const state = treeState(bench);
  ok("tree converges after pull", state.behind === 0 && state.ahead === 0);
  const log = readFileSync(
    join(bench, ".nogra", "memory", "sync", "log.jsonl"),
    "utf8",
  );
  ok("tree pull writes a receipt", /"op":"tree-pull"/.test(log) && /"ok":true/.test(log));
}

{
  appendFileSync(
    join(bench, ".nogra", "ledger", "events.jsonl"),
    event(4, "e4-bench", "fable-bench"),
  );
  git(bench, "add", "-A");
  git(bench, "commit", "-m", "bench stamps watermark 4");
  appendFileSync(
    join(house, ".nogra", "ledger", "events.jsonl"),
    event(4, "e4-house", "fable-house", "decision"),
  );
  git(house, "add", "-A");
  git(house, "commit", "-m", "house stamps watermark 4");
  git(house, "push");
  treeFetch(bench);
  const state = treeState(bench);
  const check = ledgerCheck(
    readFileSync(join(bench, ".nogra/ledger/events.jsonl"), "utf8"),
    readRemoteLedger(bench, state.upstream),
  );
  ok("independent stamps produce a diverged tree", state.ahead === 1 && state.behind === 1);
  ok("watermark collision is named", check.verdict === "collision" && check.collisions[0].watermark === 4);
  ok("collision identifies both actors", check.collisions[0].local.actor === "fable-bench" && check.collisions[0].remote.actor === "fable-house");
  ok("restamp candidate uses the shared maximum", check.restampCandidates[0].suggest === 5);
  ok("cure requires restamp before merge", check.cures.some((cure) => cure.includes("#5 BEFORE merge")));
  ok("diverged plan requires consolidation", treePlan(state, check).move === "consolidate" && treePlan(state, check).gated);
  const pull = runCli(bench, ["tree", "pull"]);
  ok("pull is denied on divergence", pull.code === 1 && /DENIED/i.test(pull.output));
  const status = runCli(bench, ["tree"]);
  ok("status exits non-zero and prints cures", status.code === 1 && /COLLISION/.test(status.output) && /cure:/.test(status.output));
}

{
  const file = join(bench, ".nogra", "ledger", "events.jsonl");
  const events = parseLedger(readFileSync(file, "utf8")).map((item) =>
    item.eventId === "e4-bench" ? { ...item, ledgerWatermark: 5 } : item,
  );
  git(bench, "reset", "--hard", "origin/main");
  writeFileSync(
    file,
    `${parseLedger(readRemoteLedger(bench, "origin/main"))
      .map((item) => JSON.stringify(item))
      .join("\n")}\n`,
  );
  appendFileSync(
    file,
    `${JSON.stringify(events.find((item) => item.eventId === "e4-bench"))}\n`,
  );
  git(bench, "add", "-A");
  git(bench, "commit", "-m", "bench follows restamp cure");
  treeFetch(bench);
  const state = treeState(bench);
  const check = ledgerCheck(
    readFileSync(file, "utf8"),
    readRemoteLedger(bench, state.upstream),
  );
  ok("restamp cure restores a clean ledger", check.verdict === "clean");
  ok("clean ahead tree plans push", treePlan(state, check).move === "push" && !treePlan(state, check).gated);
  const result = runCli(bench, ["tree", "push"]);
  ok("explicit push succeeds after cure", result.code === 0 && /tree push: ok/i.test(result.output));
}

{
  const check = ledgerCheck(
    event(7, "a", "x") + event(7, "b", "x") + event(8, "c", "x"),
    "",
  );
  ok("local duplicate watermarks are reported", check.localDuplicates[7] === 2 && check.cures.some((cure) => cure.includes("duplicate")));
  ok("legacy duplicate-only behavior remains non-collision", check.verdict === "clean");
}

{
  const withoutId = (watermark, actor, summary) =>
    `${JSON.stringify({
      type: "decision",
      summary,
      ts: "t",
      actor,
      ledgerWatermark: watermark,
    })}\n`;
  const collision = ledgerCheck(
    withoutId(9, "fable-bench", "bench event"),
    withoutId(9, "fable-house", "house event"),
  );
  ok("fallback fingerprint detects legacy events without eventId", collision.verdict === "collision" && collision.collisions[0].watermark === 9);
  const identical = ledgerCheck(
    withoutId(9, "fable-bench", "same"),
    withoutId(9, "fable-bench", "same"),
  );
  ok("identical legacy content resolves to one identity", identical.verdict === "clean" && identical.localOnly === 0 && identical.remoteOnly === 0);
}

{
  const hooks = readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8");
  const client = readFileSync(
    join(pluginRoot, "runtime", "local", "sync-client.mjs"),
    "utf8",
  );
  ok("hooks never invoke the tree verb", !/sync-cli\.mjs\s+tree|tree-sync/.test(hooks));
  ok("automatic sync client never imports tree-sync", !/tree-sync/.test(client));
  ok("sync nudge still forbids automatic git movement", /Never pull or push git yourself/.test(client));
}

console.log(
  `\n${checks} checks passed — TREE remains read-first, deterministic and operator-gated.`,
);
