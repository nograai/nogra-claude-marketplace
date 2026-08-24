#!/usr/bin/env node

// nogra-pace — the operator's tempo as state (see runtime/local/pace.mjs).
//   node scripts/nogra-pace.mjs status|slow|normal [reason] [--root <dir>]
// The operator's own words in chat ("slow down" / "full speed") set it too; this is the hand.

import { findWorkspaceRoot } from "../runtime/local/delivery-gate.mjs";
import { readPace, readPaceConfig, writePace } from "../runtime/local/pace.mjs";

const args = process.argv.slice(2);
let rootArg = "";
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--root") { rootArg = args[i + 1] || ""; i += 1; } else positional.push(args[i]);
}
const [cmd = "status", ...reasonParts] = positional;
const root = findWorkspaceRoot([rootArg, process.env.CLAUDE_PROJECT_ROOT || "", process.cwd()]);
if (!root) {
  console.error("STOP: no Nogra workspace (.nogra/config.json) found");
  process.exit(64);
}
if (cmd === "status") {
  console.log(JSON.stringify(readPace(root)));
} else if (cmd === "slow" || cmd === "normal") {
  const config = readPaceConfig(root);
  const rec = writePace(root, cmd, "scripts/nogra-pace.mjs", reasonParts.join(" "), config.workspaceId);
  console.log(`PACE: ${rec.pace} (${rec.setAt})`);
} else {
  console.error("usage: nogra-pace status|slow|normal [reason] [--root <dir>]");
  process.exit(64);
}
