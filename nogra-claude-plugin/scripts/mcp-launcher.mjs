#!/usr/bin/env node

// Nogra MCP launcher.
//
// Claude Code's .mcp.json spawns this script (Node is already a plugin
// prerequisite) as a small, self-explaining bridge to Nogra's MCP server.
// The server is published two ways: as `@nograai/mcp` on npm (standalone
// Node binaries, no Python needed) and as `nogra-mcp` on PyPI (uv-managed).
// Node/`npx` is always present wherever Claude Code runs, so it is tried
// first; `uv`/`pipx` remain as fallbacks for anyone who prefers the Python
// package. Neither is a plugin prerequisite, so without this launcher a
// missing runner would fail the MCP layer silently.
//
// Contract:
//   1. If `npx` is on PATH, spawn `npx -y @nograai/mcp` with full stdio
//      passthrough (stdin/stdout/stderr all `inherit`) and forward its exit
//      code.
//   2. Else if `uvx` is on PATH, spawn `uvx nogra-mcp` the same way.
//   3. Else if `pipx` is on PATH, spawn `pipx run nogra-mcp` the same way.
//   4. Else write exactly ONE instruction line to stderr and exit non-zero.
//   5. This launcher NEVER installs anything and NEVER makes a network call
//      itself -- it only execs a tool that is already present on PATH.
//      (`npx`/`uvx`/`pipx` may themselves fetch the published package once
//      invoked; that is their job, not this launcher's.)
//   6. SIGTERM/SIGINT received by this launcher are forwarded to the child
//      so Claude Code can stop the MCP server cleanly.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const INSTRUCTION_LINE =
  "Nogra's MCP server needs Node/npx (or uv/pipx) on PATH: reinstall Node from https://nodejs.org/ (or install uv from https://docs.astral.sh/uv/, macOS: brew install uv), then restart Claude Code.\n";

const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143 };

// Resolve a binary on PATH using Node built-ins only (no shelling out to
// `which`/`where`). Returns the absolute path or null.
function resolveOnPath(bin) {
  const pathEnv = process.env.PATH || "";
  const isWin = process.platform === "win32";
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(path.delimiter) : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not found in this dir, keep looking
      }
    }
  }
  return null;
}

function runChild(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });

  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("SIGINT", () => forwardSignal("SIGINT"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(SIGNAL_EXIT_CODE[signal] || 1);
    }
    process.exit(code === null ? 1 : code);
  });

  child.on("error", (err) => {
    process.stderr.write(`Nogra MCP launcher: failed to start ${command}: ${err.message}\n`);
    process.exit(1);
  });
}

const npx = resolveOnPath("npx");
const uvx = npx ? null : resolveOnPath("uvx");
const pipx = npx || uvx ? null : resolveOnPath("pipx");

if (npx) {
  runChild(npx, ["-y", "@nograai/mcp"]);
} else if (uvx) {
  runChild(uvx, ["nogra-mcp"]);
} else if (pipx) {
  runChild(pipx, ["run", "nogra-mcp"]);
} else {
  process.stderr.write(INSTRUCTION_LINE);
  process.exit(1);
}
