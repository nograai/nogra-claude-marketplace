#!/usr/bin/env node
// Nogra Sync CLI — the human handle on the sync edges (backs the /nogra:sync skill).
//
// Verbs: status (default) · run · pull · push · bind <endpoint> · off
//
// Contract (binding):
// - The token NEVER passes through this tool: not as an argument, not in output. Status
//   reports token PRESENCE (env / file / missing), never a value. Storing the token is the
//   operator's own hand — env NOGRA_SYNC_TOKEN or the gitignored .nogra/memory/sync/token.
// - bind/off touch ONLY the `sync` block of .nogra/config.json; the rest of the file is
//   preserved byte-for-byte in spirit (parsed, updated, re-serialized).
// - Every verb leaves a receipt in .nogra/memory/sync/log.jsonl (pull/push write their own
//   inside the client; bind/off write theirs here). Silent state changes are a lie.
// - Fail-open, informative: a missing config is a report, not a crash.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { syncPull, syncPush, syncDir } from "../runtime/local/sync-client.mjs";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rawArgs = process.argv.slice(2);
const homeFlag = rawArgs.includes("--home");
const [verb = "status", arg] = rawArgs.filter((a) => a !== "--home");
const configPath = join(root, ".nogra", "config.json");
const dir = syncDir(root);

function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function receipt(entry) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function tokenPresence() {
  if (process.env.NOGRA_SYNC_TOKEN) return "env NOGRA_SYNC_TOKEN";
  if (existsSync(join(dir, "token"))) return "file .nogra/memory/sync/token";
  return "MISSING";
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function tailReceipts(n) {
  try {
    const lines = readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n");
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null; // a corrupt receipt line must not hide the healthy ones
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function inboxCount() {
  try {
    return readFileSync(join(dir, "inbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function fmtReceipt(r) {
  const bits = [r.ts, r.op, r.ok === false ? `FAIL ${r.error || ""}`.trim() : "ok"];
  if (r.skipped) bits.push(`skipped:${r.skipped}`);
  if (r.changed && r.changed.length) bits.push(`merged:${r.changed.join("+")}`);
  if (r.newTurns) bits.push(`turns:+${r.newTurns}`);
  if (typeof r.cursor === "number") bits.push(`cursor:${r.cursor}`);
  if (r.overBudget && r.overBudget.length) bits.push(`OVER-BUDGET:${r.overBudget.join("+")}`);
  if (r.endpoint) bits.push(r.endpoint);
  if (typeof r.ms === "number") bits.push(`${r.ms}ms`);
  return bits.join(" · ");
}

async function main() {
  const config = readConfig();

  if (verb === "status") {
    if (!config) {
      console.log(`sync: Nogra is not initialized here (no .nogra/config.json at ${root})`);
      return 0;
    }
    const sync = config.sync || null;
    const state = readJson(join(dir, "state.json"), {});
    console.log(`enabled:  ${sync && sync.enabled === true ? "yes" : "no (off by default)"}`);
    console.log(`endpoint: ${sync && sync.endpoint ? sync.endpoint : "(not set)"}`);
    let seatMode = "";
    try { seatMode = readFileSync(join(dir, "mode"), "utf8").trim(); } catch {}
    const effectiveMode = seatMode ? seatMode : (sync && sync.mode === "replace" ? "replace" : "union");
    console.log(`mode:     ${effectiveMode === "replace" ? "home (replace — this seat's push hands the cloud its consolidated state)" : "remote (union — append-safe)"}${seatMode ? " · seat file" : sync && sync.mode ? " · LEGACY config (move to seat file: bind --home)" : ""}`);
    console.log(`token:    ${tokenPresence()}`);
    console.log(`lastPull: ${state.lastPullAt || "never"}${typeof state.lastCursor === "number" ? ` · cursor ${state.lastCursor}` : ""}`);
    console.log(`lastPush: ${state.lastPushAt || "never"}`);
    console.log(`inbox:    ${inboxCount()} remote turn(s) awaiting consolidation`);
    const receipts = tailReceipts(5);
    if (receipts.length) {
      console.log(`receipts (last ${receipts.length}):`);
      for (const r of receipts) console.log(`  ${fmtReceipt(r)}`);
    } else {
      console.log("receipts: none yet");
    }
    return 0;
  }

  if (verb === "run") {
    // The single door: pull → push in ONE call — the function you CALL. Same engine as the
    // hooks and the tick; one aggregate receipt on top of the client's own.
    const note = await syncPull(root);
    console.log(note || "pull: no changes (or sync disabled — run status)");
    const res = await syncPush(root);
    if (res.skipped) console.log(`push: skipped (${res.skipped})`);
    else if (res.error) console.log(`push: FAILED — ${res.error} (receipt logged; session state untouched)`);
    else
      console.log(
        `push: ok${res.overBudget && res.overBudget.length ? ` · OVER BUDGET: ${res.overBudget.join(" + ")} — the home should consolidate` : ""}`,
      );
    receipt({ op: "run", ok: !res.error, push: res.skipped ? `skipped:${res.skipped}` : res.error ? "FAIL" : "ok" });
    return res.error ? 1 : 0;
  }

  if (verb === "pull") {
    const note = await syncPull(root);
    console.log(note || "pull: no changes (or sync disabled — run status)");
    return 0;
  }

  if (verb === "push") {
    const res = await syncPush(root);
    if (res.skipped) console.log(`push: skipped (${res.skipped})`);
    else if (res.error) console.log(`push: FAILED — ${res.error} (receipt logged; session state untouched)`);
    else
      console.log(
        `push: ok${res.overBudget && res.overBudget.length ? ` · OVER BUDGET: ${res.overBudget.join(" + ")} — the home should consolidate` : ""}`,
      );
    return 0;
  }

  if (verb === "bind") {
    if (!config) {
      console.error("bind: Nogra is not initialized here — run /nogra:setup first.");
      return 1;
    }
    const endpoint = String(arg || "").replace(/\/+$/, "");
    if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(endpoint)) {
      console.error("bind: endpoint must be https:// (or loopback http for tests). Refused.");
      return 1;
    }
    config.sync = { ...(config.sync || {}), enabled: true, endpoint };
    delete config.sync.mode; // mode is seat-local (gitignored seat file), never in the shared config
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    mkdirSync(dir, { recursive: true });
    // The law "home never travels via git": token and seat file live under .nogra/memory/sync/,
    // so bind GUARANTEES the ignore entry instead of assuming the init bundle wrote it
    // (retrofit for workspaces initialized before sync existed).
    const giPath = join(root, ".nogra", ".gitignore");
    let gi = "";
    try { gi = readFileSync(giPath, "utf8"); } catch {}
    let gitignored = false;
    if (!gi.split("\n").some((l) => l.trim() === "memory/sync/")) {
      writeFileSync(giPath, gi + (gi && !gi.endsWith("\n") ? "\n" : "") + "memory/sync/\n");
      gitignored = true;
    }
    if (homeFlag) writeFileSync(join(dir, "mode"), "replace\n");
    receipt({ op: "bind", ok: true, endpoint, ...(gitignored ? { gitignored: true } : {}), ...(homeFlag ? { mode: "replace" } : {}) });
    console.log(`bind: sync enabled → ${endpoint}${homeFlag ? " [HOME seat: replace mode via seat file — requires a memory:replace token]" : ""}`);
    const presence = tokenPresence();
    if (presence === "MISSING") {
      console.log(
        "token: MISSING — store it with YOUR OWN hand (never through the assistant):\n" +
          "  either export NOGRA_SYNC_TOKEN in your shell profile,\n" +
          "  or write it to .nogra/memory/sync/token (chmod 600; the directory is gitignored).",
      );
    } else {
      console.log(`token: ${presence}`);
    }
    return 0;
  }

  if (verb === "off") {
    if (!config) {
      console.error("off: Nogra is not initialized here — nothing to disable.");
      return 1;
    }
    config.sync = { ...(config.sync || {}), enabled: false };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    receipt({ op: "off", ok: true });
    console.log("off: sync disabled (endpoint kept; re-enable with bind)");
    return 0;
  }

  console.error(`unknown verb: ${verb} — use status | run | pull | push | bind <endpoint> | off`);
  return 1;
}

process.exit(await main());
