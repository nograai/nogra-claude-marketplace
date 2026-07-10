#!/usr/bin/env node
// Nogra Path B — Claude Code's NATIVE Auto Memory is the store, and Claude loads it itself.
//
// Claude writes + loads its own memory at ~/.claude/projects/<slug>/memory/ (a MEMORY.md index plus
// typed topic files). Nogra does NOT keep a second copy and does NOT re-inject what Claude already
// loads. Nogra owns two things here, both read-only:
//
// 1. THE PIN (Layer 1): if the native folder holds a USER.md (the bounded user profile — who the
//    user is), pin it into context every session. Native auto-load carries the MEMORY.md index;
//    topic files surface on recall — the profile alone must never be one recall away. USER.md
//    lives IN the native home (one home, no parallel store); the hook only guarantees it is loaded.
//    The bound (1375 chars, engine parity) is a forcing function, not a shredder: an over-bound
//    profile is still pinned whole, and flagged to consolidate.
// 2. THE BOUND: when the folder grows past what Claude actually loads, inject one small nudge to
//    consolidate (never silently, never a hard cap).
//
// The consolidate WRITE is a separate, deliberate step. Self-contained (node built-ins only).
// Fail-safe: any error → empty context, never breaks start.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOAD_WINDOW_LINES = 200; // Claude auto-loads ~the first 200 lines of the native MEMORY.md index
const TOTAL_BUDGET = 16000;    // curated ceiling across the folder — a theory of you, not an archive
const USER_PIN_LIMIT = 1375;   // Layer-1 profile bound (engine parity) — forcing function, not a shredder

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

    let userPin = "";
    try {
      const userFile = join(dir, "USER.md");
      if (existsSync(userFile)) {
        const profile = readFileSync(userFile, "utf8").trim();
        if (profile) {
          const overBound = profile.length > USER_PIN_LIMIT;
          userPin =
            `<nogra-user-profile>\n${profile}\n` +
            (overBound
              ? `\n[USER.md is ${profile.length} chars — over its ${USER_PIN_LIMIT}-char bound. Pinned whole anyway; fold this into the next consolidation.]\n`
              : "") +
            `</nogra-user-profile>`;
        }
      }
    } catch {}

    const over = files.length > 0 && (indexLines > LOAD_WINDOW_LINES || total > TOTAL_BUDGET);
    const nudge = over
      ? `<nogra-memory>\nYour memory has grown past the load window — ${(total / 1000).toFixed(0)}K across ${files.length} files` +
          `${indexLines > LOAD_WINDOW_LINES ? `, index ${indexLines} lines (Claude loads ~${LOAD_WINDOW_LINES})` : ""}.` +
          ` What matters may now sit below the cutoff. Offer the user one friendly line of housekeeping first:` +
          ` "memory is nearing the ceiling, spin the consolidator to merge duplicates and prune stale?" On GO,` +
          ` dispatch the nogra:consolidator agent (promote durable to brain, prune stale to archive, never` +
          ` delete, then log consolidation_done). Do not silently consolidate and do not ignore: one line, then` +
          ` wait for GO, so the theory of you stays in view, not an archive.\n</nogra-memory>`
      : "";
    emit([userPin, nudge].filter(Boolean).join("\n"));
  }
} catch {
  emit(""); // never break session start
}
