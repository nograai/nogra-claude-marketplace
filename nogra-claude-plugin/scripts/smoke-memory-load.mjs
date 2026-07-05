#!/usr/bin/env node
// Falsifiable smoke for the memory-load SessionStart hook.
// Proves: injects per-workspace bounded memory, ENFORCES the 2200/1375 bound (drops OLDEST,
// keeps NEWEST), and never breaks (missing files → empty context, always valid JSON).
// Every check can FAIL if the thing it claims were wrong.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "memory-load.mjs");
let fails = 0;
const ok = (n, c) => {
  console.log((c ? "  ok   " : "  FAIL ") + n);
  if (!c) fails++;
};
const run = (root) =>
  JSON.parse(
    execFileSync("node", [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: "utf8" }),
  ).hookSpecificOutput.additionalContext;
const memOf = (ctx) => {
  const a = ctx.split("# MEMORY.md\n")[1];
  return a ? a.replace(/\n<\/nogra-memory>\s*$/, "") : "";
};

// 1. missing memory → empty context, valid JSON, never breaks session start
const empty = mkdtempSync(join(tmpdir(), "nogmem-"));
ok("missing memory -> empty context (valid JSON, never breaks)", run(empty) === "");

// 2-4. both files present -> both injected, wrapped
const ws = mkdtempSync(join(tmpdir(), "nogmem-"));
mkdirSync(join(ws, ".nogra", "memory", "local"), { recursive: true });
writeFileSync(join(ws, ".nogra/memory/local/USER.md"), "Patti — builder");
writeFileSync(join(ws, ".nogra/memory/local/MEMORY.md"), "fact A\nfact B");
let ctx = run(ws);
ok("USER.md injected", ctx.includes("# USER.md") && ctx.includes("Patti — builder"));
ok("MEMORY.md injected", ctx.includes("# MEMORY.md") && ctx.includes("fact A"));
ok("wrapped in <nogra-memory>", ctx.startsWith("<nogra-memory>") && ctx.endsWith("</nogra-memory>"));

// 5-7. bound: content > 2200 -> keep NEWEST 2200, drop OLDEST (the defining bet, enforced)
writeFileSync(join(ws, ".nogra/memory/local/MEMORY.md"), "OLDEST-MARKER " + "x".repeat(2300) + " NEWEST-MARKER");
const mem = memOf(run(ws));
ok("bound enforced: MEMORY <= 2200 chars", mem.length <= 2200);
ok("bound drops OLDEST content", !mem.includes("OLDEST-MARKER"));
ok("bound keeps NEWEST content", mem.includes("NEWEST-MARKER"));

rmSync(empty, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
console.log(fails ? `\nsmoke-memory-load: FAIL (${fails} check(s))` : "\nsmoke-memory-load: ok");
process.exit(fails ? 1 : 0);
