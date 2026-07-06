// native-memory.mjs — Nogra's Path B: bound + sync Claude Code's NATIVE Auto Memory.
//
// Claude Code writes durable memories to ~/.claude/projects/<slug>/memory/ (a MEMORY.md index plus
// typed topic files: user-/feedback-/project-/reference-*.md, each with frontmatter). It self-learns
// and loads them natively — but it is UNBOUNDED. Nogra's 30% is the bound + the cross-machine sync.
//
// This module is READ-ONLY: it resolves the native folder and reports its state. Consolidation (the
// bound) and sync build on top — and any WRITE path must treat this folder as Claude's own state:
// merge/prune deliberately, never corrupt.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Claude Code derives the per-project memory folder by replacing every "/" in the project path with "-".
// e.g. /Users/patricklarsen/y26dev -> -Users-patricklarsen-y26dev
export function nativeMemoryDir(projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  const slug = projectDir.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug, "memory");
}

const TYPES = ["user", "feedback", "project", "reference"];

function typeOf(name) {
  if (name === "MEMORY.md") return "index";
  const m = name.match(/^([a-z]+)[-_]/);
  return m && TYPES.includes(m[1]) ? m[1] : "other";
}

// Read the native folder. Returns its shape without mutating anything.
export function readNativeMemory(dir = nativeMemoryDir()) {
  if (!existsSync(dir)) {
    return { dir, exists: false, files: [], totalChars: 0, byType: {} };
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const content = readFileSync(join(dir, f), "utf8");
      return { name: f, type: typeOf(f), chars: content.length };
    })
    .sort((a, b) => b.chars - a.chars);

  const totalChars = files.reduce((s, f) => s + f.chars, 0);
  const byType = {};
  for (const f of files) byType[f.type] = (byType[f.type] || 0) + f.chars;
  return { dir, exists: true, files, totalChars, byType };
}

// CLI: `node native-memory.mjs [projectDir]` → report the native memory state.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ? join(process.argv[2]) : nativeMemoryDir();
  const s = readNativeMemory(dir);
  if (!s.exists) {
    console.log(`native memory: NOT FOUND at ${s.dir}`);
  } else {
    console.log(`native memory: ${s.dir}`);
    console.log(`  files: ${s.files.length} · total: ${s.totalChars} chars`);
    console.log(`  by type: ${Object.entries(s.byType).map(([t, c]) => `${t}=${c}`).join(" · ")}`);
    console.log(`  largest:`);
    for (const f of s.files.slice(0, 5)) console.log(`    ${f.chars.toString().padStart(5)}  ${f.name}`);
  }
}
