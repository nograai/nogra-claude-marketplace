#!/usr/bin/env node

// Read-only diagnostic for Claude Code's resolved native Auto Memory.

import { pathToFileURL } from "node:url";
import {
  readNativeMemory,
  resolveNativeMemory
} from "../runtime/local/native-memory.mjs";

export { readNativeMemory, resolveNativeMemory };

async function main() {
  const projectDir = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const resolution = resolveNativeMemory({ projectDir });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ resolution, memory: readNativeMemory(resolution) }, null, 2));
    return;
  }
  if (resolution.status !== "resolved") {
    console.log(`native memory: ${resolution.status.toUpperCase()} (${resolution.source})`);
    for (const warning of resolution.warnings) console.log(`  warning: ${warning}`);
    return;
  }
  const state = readNativeMemory(resolution);
  console.log(`native memory: ${resolution.resolvedDirectory}`);
  console.log(`  source: ${resolution.source} · confidence: ${resolution.confidence}`);
  if (!state.exists) {
    console.log("  state: NOT FOUND (resolved destination is valid)");
    return;
  }
  console.log(`  files: ${state.files.length} · total: ${state.totalChars} chars`);
  console.log(`  by type: ${Object.entries(state.byType).map(([type, chars]) => `${type}=${chars}`).join(" · ")}`);
  console.log("  largest:");
  for (const file of state.files.slice(0, 5)) console.log(`    ${file.chars.toString().padStart(5)}  ${file.name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(`native-memory: ${error.message}`);
    process.exit(1);
  });
}
