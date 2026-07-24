#!/usr/bin/env node
// Deterministic Claude Code changelog watcher.
//
// This is an explicit diagnostic, not a SessionStart hook: Quality Pass boot is
// detection-only and must not introduce hidden network calls or state writes.
//
//   node changelog-loop.mjs
//   node changelog-loop.mjs --check
//   node changelog-loop.mjs --seed <version>

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CHANGELOG_URL =
  "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";

export function findWorkspaceRoot(start) {
  let directory = resolve(start);
  while (directory !== dirname(directory)) {
    if (existsSync(join(directory, ".nogra"))) return directory;
    directory = dirname(directory);
  }
  return resolve(start);
}

export function parseChangelog(text) {
  const entries = [];
  const parts = String(text || "").split(/^## /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    const version = part.slice(0, newline).trim();
    const body = part.slice(newline + 1).trim();
    if (version) entries.push({ version, body });
  }
  return entries;
}

export function localClaudeVersion(overrides = {}) {
  const runner = overrides.execFileSync || execFileSync;
  const candidates = [
    process.env.CLAUDE_CODE_BIN,
    "claude",
    join(homedir(), ".local", "bin", "claude"),
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      return runner(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split(/\s+/)[0];
    } catch {
      // Try the next explicit executable location.
    }
  }
  return null;
}

function readState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function writeState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export async function runChangelogLoop(options = {}) {
  const root = options.root || findWorkspaceRoot(process.cwd());
  const stateFile =
    options.stateFile ||
    join(root, ".nogra", "state", "claude-changelog-seen.json");
  const checkOnly = Boolean(options.checkOnly);
  const seedVersion = options.seedVersion || null;
  const now =
    options.now ||
    (() => new Date().toISOString());

  if (seedVersion) {
    writeState(stateFile, {
      lastSeenVersion: seedVersion,
      stampedAt: now(),
      seeded: true,
    });
    return {
      status: "seeded",
      exitCode: 0,
      lines: [
        `changelog-loop: baseline seeded at ${seedVersion}; the next run diffs from this version.`,
      ],
    };
  }

  const state = readState(stateFile);
  let text;
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(options.url || CHANGELOG_URL, {
      signal: options.signal || AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } catch (error) {
    return {
      status: "unreachable",
      exitCode: 0,
      lines: [
        `changelog-loop: source unavailable (${error.message}); nothing was stamped; last seen: ${state?.lastSeenVersion ?? "never"}.`,
      ],
    };
  }

  const entries = parseChangelog(text);
  if (entries.length === 0) {
    return {
      status: "unparseable",
      exitCode: 0,
      lines: [
        "changelog-loop: source fetched but no version entries were parsed; nothing was stamped.",
      ],
    };
  }

  const top = entries[0].version;
  const localVersion =
    options.localVersion === undefined
      ? localClaudeVersion(options)
      : options.localVersion;
  const lastSeen = state?.lastSeenVersion ?? null;

  if (!lastSeen) {
    if (!checkOnly) {
      writeState(stateFile, {
        lastSeenVersion: top,
        stampedAt: now(),
      });
    }
    return {
      status: "baseline",
      exitCode: 0,
      lines: [
        `changelog-loop: first pass; baseline ${checkOnly ? "would be" : "set to"} ${top} (local CLI: ${localVersion ?? "unknown"}).`,
      ],
    };
  }

  const seenIndex = entries.findIndex((entry) => entry.version === lastSeen);
  const fresh = seenIndex === -1 ? entries : entries.slice(0, seenIndex);
  if (fresh.length === 0) {
    return {
      status: "unchanged",
      exitCode: 0,
      lines: [
        `changelog-loop: no movement; upstream remains ${top} (last seen ${lastSeen}, local CLI: ${localVersion ?? "unknown"}).`,
      ],
    };
  }

  const lines = [
    `changelog-loop: Claude Code moved ${lastSeen} -> ${top}; ${fresh.length} new version(s), local CLI: ${localVersion ?? "unknown"}. Review this diff against Nogra before building:`,
    "",
  ];
  for (const entry of fresh) {
    lines.push(`## ${entry.version}`, entry.body, "");
  }
  if (seenIndex === -1) {
    lines.push(
      `honest note: last-seen version ${lastSeen} is no longer present; the entire visible list is shown.`,
    );
  }
  if (!checkOnly) {
    writeState(stateFile, {
      lastSeenVersion: top,
      previousVersion: lastSeen,
      stampedAt: now(),
    });
  }
  return {
    status: "moved",
    exitCode: 0,
    fresh,
    lines,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const seedIndex = args.indexOf("--seed");
  const seedVersion = seedIndex === -1 ? null : args[seedIndex + 1];
  if (seedIndex !== -1 && !seedVersion) {
    console.log("changelog-loop: --seed requires a version.");
    return 1;
  }
  const result = await runChangelogLoop({ checkOnly, seedVersion });
  console.log(result.lines.join("\n"));
  return result.exitCode;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) process.exit(await main());
