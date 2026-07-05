#!/usr/bin/env node
// Nogra — load the bounded, per-workspace memory into Claude Code at session start.
//
// Reads .nogra/memory/local/{USER,MEMORY}.md (created by /nogra:setup) and injects them as
// SessionStart additionalContext, so they ride in Claude's context EVERY session —
// deterministically, not deprioritized like CLAUDE.md. This deterministic load is the difference.
//
// The defining bound: USER.md 1375 chars, MEMORY.md 2200. Over the bound, the OLDEST content is
// dropped on read — "consolidate or lose it". Claude does the remembering (writes the files);
// Nogra owns the bound (enforces it here).
//
// Self-contained: node built-ins only, no deps, no Python. Fail-safe: any error → empty context,
// never breaks session start.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const LIMITS = { "USER.md": 1375, "MEMORY.md": 2200 };

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = join(root, ".nogra", "memory", "local");

  const read = (name) => {
    try {
      const p = join(dir, name);
      if (!existsSync(p)) return "";
      let t = readFileSync(p, "utf8").trim();
      if (t.length > LIMITS[name]) t = t.slice(-LIMITS[name]); // enforce the bound on read (drop oldest)
      return t ? `# ${name}\n${t}` : "";
    } catch {
      return "";
    }
  };

  const blocks = ["USER.md", "MEMORY.md"].map(read).filter(Boolean);
  emit(blocks.length ? `<nogra-memory>\n${blocks.join("\n\n")}\n</nogra-memory>` : "");
} catch {
  emit(""); // never break session start
}
