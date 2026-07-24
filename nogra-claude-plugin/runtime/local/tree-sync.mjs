// tree-sync.mjs — the TREE leg: the house frame applied deterministically to git.
//
// Contract:
//   - fetch is read-only and never grants permission to move the tree;
//   - pull/push happen only on the operator's explicit command and after the check;
//   - ledger watermark collisions are detected before merge;
//   - the git diff is the reading plan; there is no parallel curated file list;
//   - this module is pure apart from the git reads explicitly requested by callers.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LEDGER_REL = ".nogra/ledger/events.jsonl";

export function gitRun(root, args, opts = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    timeout: opts.timeoutMs || 8000,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

// Fetch is a read. Failure is reported honestly but does not crash the status check.
export function treeFetch(root, overrides = {}) {
  const runner = overrides.gitRun || gitRun;
  try {
    runner(root, ["fetch", "--quiet"], { timeoutMs: overrides.timeoutMs || 15000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error && error.message) || String(error) };
  }
}

export function treeState(root, overrides = {}) {
  const runner = overrides.gitRun || gitRun;
  try {
    if (runner(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null;
    const upstream =
      overrides.upstream ||
      runner(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    const behind = Number(runner(root, ["rev-list", "--count", `HEAD..${upstream}`])) || 0;
    const ahead = Number(runner(root, ["rev-list", "--count", `${upstream}..HEAD`])) || 0;
    const lines = (output) => (output ? output.split("\n").filter(Boolean) : []);
    return {
      upstream,
      behind,
      ahead,
      incomingCommits: lines(
        behind ? runner(root, ["log", "--oneline", `HEAD..${upstream}`]) : "",
      ),
      outgoingCommits: lines(
        ahead ? runner(root, ["log", "--oneline", `${upstream}..HEAD`]) : "",
      ),
      incomingFiles: lines(
        behind ? runner(root, ["diff", "--name-status", `HEAD...${upstream}`]) : "",
      ),
      outgoingFiles: lines(
        ahead ? runner(root, ["diff", "--name-status", `${upstream}...HEAD`]) : "",
      ),
    };
  } catch {
    return null;
  }
}

export function parseLedger(text) {
  const events = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      // A malformed line must not hide healthy ledger events.
    }
  }
  return events;
}

export function readLocalLedger(root) {
  const file = join(root, LEDGER_REL);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function readRemoteLedger(root, upstream, overrides = {}) {
  const runner = overrides.gitRun || gitRun;
  try {
    return runner(root, ["show", `${upstream}:${LEDGER_REL}`], { timeoutMs: 5000 });
  } catch {
    return "";
  }
}

const watermarkOf = (event) =>
  Number.isInteger(event.ledgerWatermark) ? event.ledgerWatermark : null;

// eventId is preferred. Legacy hand-stamped events fall back to a stable fingerprint.
const identityOf = (event) =>
  String(event.eventId || "") ||
  `fp:${event.ts || event.generatedAt || ""}|${event.actor || ""}|${event.type || ""}|${String(
    event.summary || "",
  ).slice(0, 120)}`;

const eventBrief = (event) => ({
  watermark: watermarkOf(event),
  eventId: identityOf(event).slice(0, 60),
  actor: String(event.actor || event.workspaceId || "?"),
  type: String(event.type || "?"),
});

export function ledgerCheck(localText, remoteText) {
  const local = parseLedger(localText);
  const remote = parseLedger(remoteText);
  const duplicates = (events) => {
    const seen = new Map();
    for (const event of events) {
      const watermark = watermarkOf(event);
      if (watermark === null) continue;
      seen.set(watermark, (seen.get(watermark) || 0) + 1);
    }
    return Object.fromEntries([...seen].filter(([, count]) => count > 1));
  };
  const firstByWatermark = (events) => {
    const result = new Map();
    for (const event of events) {
      const watermark = watermarkOf(event);
      if (watermark !== null && !result.has(watermark)) result.set(watermark, event);
    }
    return result;
  };

  const localIds = new Set(local.map(identityOf).filter(Boolean));
  const remoteIds = new Set(remote.map(identityOf).filter(Boolean));
  const localByWatermark = firstByWatermark(local);
  const remoteByWatermark = firstByWatermark(remote);
  const collisions = [];

  for (const [watermark, localEvent] of localByWatermark) {
    const remoteEvent = remoteByWatermark.get(watermark);
    if (
      remoteEvent &&
      identityOf(localEvent) &&
      identityOf(remoteEvent) &&
      identityOf(localEvent) !== identityOf(remoteEvent)
    ) {
      collisions.push({
        watermark,
        local: eventBrief(localEvent),
        remote: eventBrief(remoteEvent),
      });
    }
  }
  collisions.sort((a, b) => a.watermark - b.watermark);

  const allWatermarks = [...local, ...remote]
    .map(watermarkOf)
    .filter((value) => value !== null);
  const maxWatermark = allWatermarks.length ? Math.max(...allWatermarks) : 0;
  const restampCandidates = collisions.map((collision, index) => ({
    watermark: collision.watermark,
    suggest: maxWatermark + 1 + index,
  }));
  const localOnly = local.filter(
    (event) => identityOf(event) && !remoteIds.has(identityOf(event)),
  ).length;
  const remoteOnly = remote.filter(
    (event) => identityOf(event) && !localIds.has(identityOf(event)),
  ).length;
  const localDuplicates = duplicates(local);
  const remoteDuplicates = duplicates(remote);
  const cures = [];

  for (const collision of collisions) {
    const candidate = restampCandidates.find(
      (item) => item.watermark === collision.watermark,
    );
    cures.push(
      `COLLISION watermark ${collision.watermark}: local ${collision.local.actor}/${collision.local.type} vs remote ${collision.remote.actor}/${collision.remote.type} — the seat that stamped against a stale tail must restamp to #${candidate ? candidate.suggest : maxWatermark + 1} BEFORE merge`,
    );
  }
  if (Object.keys(localDuplicates).length) {
    cures.push(
      `local duplicate watermarks (${Object.keys(localDuplicates).join(", ")}) — consolidation required; the ledger must not lie`,
    );
  }
  if (Object.keys(remoteDuplicates).length) {
    cures.push(
      `remote duplicate watermarks (${Object.keys(remoteDuplicates).join(", ")}) — report the peer's consolidation task; never mutate it locally`,
    );
  }

  return {
    verdict: collisions.length ? "collision" : "clean",
    collisions,
    restampCandidates,
    localDuplicates,
    remoteDuplicates,
    localOnly,
    remoteOnly,
    maxWatermark,
    cures,
  };
}

export function treePlan(state, check) {
  if (!state) {
    return {
      move: "unknown",
      reason: "no git tree or upstream; there is nothing to compare",
    };
  }
  const gated = check && check.verdict === "collision";
  if (state.behind === 0 && state.ahead === 0) {
    return {
      move: "no-op",
      reason: "local equals remote",
      gated: false,
    };
  }
  if (state.ahead > 0 && state.behind === 0) {
    return gated
      ? {
          move: "push",
          gated: true,
          reason: "local is ahead, but the ledger check found a collision",
        }
      : {
          move: "push",
          gated: false,
          reason: `local is ahead by ${state.ahead}; push only on the operator's command`,
        };
  }
  if (state.behind > 0 && state.ahead === 0) {
    return gated
      ? {
          move: "pull",
          gated: true,
          reason: "remote is ahead, but the ledger check found a collision",
        }
      : {
          move: "pull",
          gated: false,
          reason: `remote is ahead by ${state.behind}; review the diff before moving`,
        };
  }
  return {
    move: "consolidate",
    gated: true,
    reason: `tree diverged (ahead ${state.ahead}, behind ${state.behind}); operator judgment is required`,
  };
}
