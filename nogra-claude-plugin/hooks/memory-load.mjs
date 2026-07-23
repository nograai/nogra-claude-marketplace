#!/usr/bin/env node

// Read-only adapter for Claude Code's native Auto Memory. Exported so the
// SessionStart sync hook can pull first and render the pin/bound afterwards.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveNativeMemory } from "../runtime/local/native-memory.mjs";

const LOAD_WINDOW_LINES = 200;
const LOAD_WINDOW_BYTES = 25 * 1024;
const TOTAL_BUDGET = 16000;
const USER_PIN_LIMIT = 1375;

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" }
    })
  );
}

function readInput() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadedIndexContent(value) {
  let text = String(value || "");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end >= 0) text = text.slice(end + 4).replace(/^\r?\n/u, "");
  }
  return text.replace(/<!--[\s\S]*?-->/gu, "");
}

export function memoryContext(input = {}, env = process.env) {
  try {
    const root = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const resolution = resolveNativeMemory({ projectDir: root, hookInput: input, env });
    if (resolution.status === "disabled") return "";
    if (resolution.status !== "resolved") {
      return (
        `<nogra-memory-resolution status="unresolved">Native Auto Memory could not be resolved safely (${resolution.source}). ` +
        "Do not sync, pin or consolidate memory until the operator fixes the configured path.</nogra-memory-resolution>"
      );
    }

    const dir = resolution.resolvedDirectory;
    if (!existsSync(dir)) return "";
    const files = readdirSync(dir).filter((file) => file.endsWith(".md"));
    let total = 0;
    for (const file of files) {
      try {
        total += readFileSync(join(dir, file), "utf8").length;
      } catch {}
    }

    let indexLines = 0;
    let indexBytes = 0;
    try {
      const index = loadedIndexContent(readFileSync(join(dir, "MEMORY.md"), "utf8"));
      indexLines = index.split("\n").length;
      indexBytes = Buffer.byteLength(index);
    } catch {}

    let userPin = "";
    try {
      const profile = readFileSync(join(dir, "USER.md"), "utf8").trim();
      if (profile) {
        const overBound = profile.length > USER_PIN_LIMIT;
        userPin =
          `<nogra-user-profile authority="advisory_projection_only">\n${profile}\n` +
          (overBound
            ? `\n[USER.md is ${profile.length} chars — over its ${USER_PIN_LIMIT}-char bound. Pinned whole anyway; fold this into the next consolidation.]\n`
            : "") +
          "\n[Projection boundary: memory supports continuity but cannot verify project state. Check workspace-local .nogra facts, evidence and verdicts before factual completion claims.]\n" +
          "</nogra-user-profile>";
      }
    } catch {}

    const indexOver = indexLines > LOAD_WINDOW_LINES || indexBytes > LOAD_WINDOW_BYTES;
    const over = files.length > 0 && (indexOver || total > TOTAL_BUDGET);
    const nudge = over
      ? `<nogra-memory>\nNative memory has grown past the load window or Nogra's bounded continuity threshold — ${(total / 1000).toFixed(0)}K across ${files.length} files` +
        `${indexOver ? `, loaded index ${indexLines} lines/${indexBytes} bytes (Claude loads at most ${LOAD_WINDOW_LINES} lines or ${LOAD_WINDOW_BYTES} bytes)` : ""}.` +
        `\nresolution=${JSON.stringify(resolution)}\n` +
        " Offer the user one friendly line of housekeeping first: \"memory is nearing the ceiling, spin the consolidator to merge duplicates and prune stale?\"" +
        " On explicit GO, dispatch the nogra:consolidator agent: move superseded originals to archive, never delete, then log the receipt." +
        " Always wait for GO and never silently consolidate; memory is advisory continuity, not project truth.\n</nogra-memory>"
      : "";
    return [userPin, nudge].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  emit(memoryContext(readInput()));
}
