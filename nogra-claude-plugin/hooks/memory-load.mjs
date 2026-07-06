#!/usr/bin/env node
// Nogra Path B — Claude Code's NATIVE Auto Memory is the store, and Claude loads it itself.
//
// Claude writes + loads its own memory at ~/.claude/projects/<slug>/memory/ (a MEMORY.md index plus
// typed topic files). Nogra does NOT keep a second copy and does NOT re-inject what Claude already
// loads. Nogra owns the BOUND: at session start this read-only checks the native folder and, ONLY
// when it has grown past what Claude actually loads, injects one small nudge to consolidate.
//
// Read-only here — the folder is Claude's own state; the consolidate WRITE is a separate, deliberate
// step. Self-contained (node built-ins only). Fail-safe: any error → empty context, never breaks start.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOAD_WINDOW_LINES = 200; // Claude auto-loads ~the first 200 lines of the native MEMORY.md index
const TOTAL_BUDGET = 16000;    // curated ceiling across the folder — a theory of you, not an archive

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = join(homedir(), ".claude", "projects", root.replace(/\//g, "-"), "memory");

  if (!existsSync(dir)) {
    emit(""); // no native memory yet — nothing to bound
  } else {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    let total = 0;
    for (const f of files) {
      try { total += readFileSync(join(dir, f), "utf8").length; } catch {}
    }
    let indexLines = 0;
    try {
      if (existsSync(join(dir, "MEMORY.md"))) {
        indexLines = readFileSync(join(dir, "MEMORY.md"), "utf8").split("\n").length;
      }
    } catch {}

    const over = files.length > 0 && (indexLines > LOAD_WINDOW_LINES || total > TOTAL_BUDGET);
    emit(
      over
        ? `<nogra-memory>\nYour memory has grown past the load window — ${(total / 1000).toFixed(0)}K across ${files.length} files` +
            `${indexLines > LOAD_WINDOW_LINES ? `, index ${indexLines} lines (Claude loads ~${LOAD_WINDOW_LINES})` : ""}.` +
            ` What matters may now sit below the cutoff. Consolidate it — merge duplicates, prune stale —` +
            ` so the theory of you stays in view, not an archive.\n</nogra-memory>`
        : "",
    );
  }
} catch {
  emit(""); // never break session start
}
