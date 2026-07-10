#!/usr/bin/env node
// Falsifiable smoke for the Path B memory-load SessionStart hook.
// Proves: it reads Claude's NATIVE memory folder (~/.claude/projects/<slug>/memory/), injects
// NOTHING when the folder is absent or within the bound, and injects exactly one consolidate-NUDGE
// when it drifts over the bound (index > 200 lines, or > 16K chars total). Never breaks — always
// valid JSON. Every check can FAIL if the claim it makes were wrong.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "memory-load.mjs");
let fails = 0;
const ok = (n, c) => { console.log((c ? "  ok   " : "  FAIL ") + n); if (!c) fails++; };

// The hook resolves ~/.claude/projects/<slug>/memory from homedir()+CLAUDE_PROJECT_DIR.
// We drive a fake HOME so we own the native folder, and a fixed project dir → deterministic slug.
function run(files) {
  const home = mkdtempSync(join(tmpdir(), "noghome-"));
  const projectDir = "/tmp/fake-proj"; // slug = -tmp-fake-proj
  if (files) {
    const memDir = join(home, ".claude", "projects", projectDir.replace(/\//g, "-"), "memory");
    mkdirSync(memDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(memDir, name), content);
  }
  const out = execFileSync("node", [HOOK], {
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
  rmSync(home, { recursive: true, force: true });
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

// 1. absent native memory -> empty context, valid JSON, never breaks session start
ok("absent native memory -> empty context (valid JSON)", run(null) === "");

// 2. under-budget native -> quiet (no nudge, no double-loading what Claude already loads)
ok("under-budget native -> no nudge", run({ "MEMORY.md": "- one small memory\n" }) === "");

// 3. over TOTAL budget -> exactly one consolidate nudge
const big = run({ "project-huge.md": "x".repeat(17000) });
ok("over-budget native -> nudge injected + wrapped", big.startsWith("<nogra-memory>") && /consolidat/i.test(big));
ok("nudge names the drift (past load window)", /past the load window/i.test(big));

// 4. index over the 200-line load cutoff -> nudge (important stuff now below Claude's cutoff)
const longIdx = run({ "MEMORY.md": Array.from({ length: 260 }, (_, i) => `- line ${i}`).join("\n") });
ok("index > 200 lines -> nudge (below load cutoff)", /index 2\d\d lines/i.test(longIdx));

// 5. THE PIN (Layer 1): USER.md in the native home -> pinned into context every session
const pinned = run({ "MEMORY.md": "- small\n", "USER.md": "Prefers Danish. Direct tone. Verify with facts." });
ok("USER.md present -> profile pinned", pinned.startsWith("<nogra-user-profile>") && pinned.includes("Prefers Danish"));
ok("pin without drift -> no nudge attached", !pinned.includes("<nogra-memory>"));

// 6. no USER.md -> no pin block invented (native index alone stays quiet)
ok("no USER.md -> no pin block", !run({ "MEMORY.md": "- small\n" }).includes("<nogra-user-profile>"));

// 7. over-bound profile -> still pinned WHOLE (forcing function, not a shredder) + flagged
const overPin = run({ "USER.md": "u".repeat(1500) });
ok("over-bound USER.md -> pinned whole", overPin.includes("u".repeat(1500)));
ok("over-bound USER.md -> flagged for consolidation", /over its 1375-char bound/i.test(overPin));

// 8. pin + drift together -> both blocks, pin first
const both = run({ "USER.md": "The user profile.", "project-huge.md": "x".repeat(17000) });
ok("pin + over-budget -> profile first, then nudge",
  both.indexOf("<nogra-user-profile>") === 0 && both.indexOf("<nogra-memory>") > both.indexOf("</nogra-user-profile>"));

// 9. empty USER.md -> no empty pin block
ok("empty USER.md -> no pin block", !run({ "USER.md": "   \n" }).includes("<nogra-user-profile>"));

console.log(fails ? `\nsmoke-memory-load: FAIL (${fails} check(s))` : "\nsmoke-memory-load: ok");
process.exit(fails ? 1 : 0);
