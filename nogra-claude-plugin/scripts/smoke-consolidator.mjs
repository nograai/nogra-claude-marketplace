#!/usr/bin/env node
// Evidence smoke for write-loop v1 (memory housekeeping). Two guards:
//   (A) the shipped detector (hooks/memory-load.mjs) drives the Manager-middleman flow —
//       over-window emits the one-line ask + nogra:consolidator dispatch + wait-for-GO;
//       under-window stays silent.
//   (B) the nogra:consolidator agent contract holds its non-negotiable invariants.
// Sabotage-tested: remove "never delete", drop the ask, or let the agent self-start, and
// this smoke goes red. Isolated fixtures under ~/.claude/projects/<temp slug>/memory (the
// path memory-load resolves from CLAUDE_PROJECT_DIR); every fixture is cleaned up. Real
// memory is untouched (unique temp slugs never collide with a real project).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const memoryLoadPath = path.join(pluginRoot, "hooks", "memory-load.mjs");
const consolidatorPath = path.join(pluginRoot, "agents", "consolidator.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runMemoryLoad(projectDir) {
  return execFileSync(process.execPath, [memoryLoadPath], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    input: "",
    encoding: "utf8",
  });
}

function nudge(output) {
  try {
    return JSON.parse(output).hookSpecificOutput.additionalContext || "";
  } catch {
    return null;
  }
}

// Build a fake native-memory folder that memory-load.mjs will resolve from
// CLAUDE_PROJECT_DIR: ~/.claude/projects/<slugified project dir>/memory.
function makeFixture(files) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-consolidator-smoke-"));
  const slug = projectDir.replace(/\//g, "-");
  const projectSlugDir = path.join(homedir(), ".claude", "projects", slug);
  const memDir = path.join(projectSlugDir, "memory");
  fs.mkdirSync(memDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(memDir, name), body, "utf8");
  }
  return {
    projectDir,
    cleanup() {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(projectSlugDir, { recursive: true, force: true });
    },
  };
}

function main() {
  const fixtures = [];
  try {
    // (A1) OVER window -> the Manager-middleman nudge fires with the full flow.
    const over = makeFixture({
      "MEMORY.md": "# Memory Index\n" + "- pointer line\n".repeat(30),
      "a.md": "x".repeat(9000),
      "b.md": "y".repeat(9000),
    });
    fixtures.push(over);
    const overCtx = nudge(runMemoryLoad(over.projectDir));
    assert(overCtx !== null, "over-window: memory-load must emit valid JSON");
    assert(/grown past the load window/.test(overCtx), "over-window: the load-window nudge must fire");
    assert(/nogra\.memory\.resolution\.v1/.test(overCtx), "over-window: nudge must carry the exact native-memory resolution contract");
    assert(/spin the consolidator/.test(overCtx), "over-window: nudge must OFFER the one-line housekeeping ask");
    assert(/nogra:consolidator agent/.test(overCtx), "over-window: nudge must delegate to the nogra:consolidator agent");
    assert(/wait for GO/.test(overCtx), "over-window: nudge must wait for GO (Manager-middleman, never silent-fire)");
    assert(/never\s+delete/.test(overCtx), "over-window: nudge must carry the never-delete rule");

    // (A2) UNDER window -> silent (empty context, no nudge).
    const under = makeFixture({ "MEMORY.md": "# Memory Index\n- one small pointer\n" });
    fixtures.push(under);
    const underCtx = nudge(runMemoryLoad(under.projectDir));
    assert(underCtx === "", "under-window: memory-load must stay silent (empty context)");

    // (B) the nogra:consolidator agent contract holds its non-negotiable invariants.
    const contract = fs.readFileSync(consolidatorPath, "utf8");
    assert(/^name:\s*consolidator\s*$/m.test(contract), "contract: name must be 'consolidator'");
    assert(/tools:.*\bWrite\b/.test(contract) && /tools:.*\bBash\b/.test(contract), "contract: must grant Write + Bash");
    assert(/maxTurns:\s*\d+/.test(contract), "contract: must set maxTurns");
    assert(/never self-start|never decide on your own/i.test(contract), "contract: must forbid self-start (Manager offer + user GO only)");
    assert(/[Pp]romote[- ]before[- ]prune/.test(contract), "contract: must require promote-before-prune");
    assert(/never\s+`?rm`?|[Mm]ove-not-delete|MOVE .*archive/.test(contract), "contract: must require move-not-delete (never delete a memory file)");
    assert(/[Aa]rchive the full original before any in-place rewrite/.test(contract), "contract: must require archive-full before in-place rewrites (compression is never the only copy)");
    assert(/[Mm]aintain USER\.md/.test(contract) && /CREATE it by distilling/.test(contract), "contract: must maintain USER.md (create-if-missing, bounded pinned profile)");
    assert(/boligscout/.test(contract), "contract: must fence out boligscout/customer scope");
    assert(/# Consolidator Report/.test(contract), "contract: must define the receipt return shape");

    console.log(
      "smoke-consolidator: ok — detector drives the Manager-middleman ask + delegate to nogra:consolidator (over) / silent (under); contract holds self-start, promote-before-prune, never-delete, scope-fence and receipt invariants (sabotage-tested)",
    );
  } finally {
    for (const f of fixtures) {
      try { f.cleanup(); } catch {}
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`smoke-consolidator: FAIL - ${error.message}`);
  process.exitCode = 1;
}
