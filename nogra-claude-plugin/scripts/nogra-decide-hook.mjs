#!/usr/bin/env node
// nogra-decide-hook — the post-step of `/nogra:decide`: the projection follows the truth in the
// SAME grip. Run it immediately after the decision has been appended to DECISIONS.md.
//
//   node scripts/nogra-decide-hook.mjs [--root <dir>] [--json]
//
// It binds the Paper (scripts/paper-bind.mjs) and prints ONE operator line. It can never block a
// decision: a workspace with no `paper` key, a missing paper file, a broken anchor — each is one
// line and exit 0. The decision is already law; the projection catching up is a convenience.

import { bindPaper } from "./paper-bind.mjs";
import { findWorkspaceRoot } from "../runtime/local/walls.mjs";

const argv = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--json") options.json = true;
  else if (argv[i].startsWith("--")) {
    options[argv[i].slice(2)] = argv[i + 1] ?? "";
    i += 1;
  }
}

const root = findWorkspaceRoot([options.root || "", process.env.CLAUDE_PROJECT_ROOT || "", process.cwd()]);
if (!root) {
  console.log("Papiret ikke bundet: intet Nogra-workspace fundet — dommen står.");
  process.exit(0);
}

let result;
try {
  result = bindPaper({ root });
} catch (error) {
  result = { status: "error", error: error?.message || "unknown" };
}

const line = {
  ok: () => `Papiret opdateret (${result.decisions} domme) — republicér.`,
  "no-config": () =>
    "Papiret ikke bundet: `.nogra/config.json` har ingen `paper`-nøgle (`/nogra:paper bind` viser hvad der skal tilføjes) — dommen står.",
  "missing-paper": () => `Papiret ikke bundet: filen findes ikke (${result.paper}) — dommen står.`,
  "no-anchor": () => "Papiret ikke bundet: ankeret mangler i papiret — dommen står.",
  error: () => `Papiret ikke bundet (${result.error || "ukendt fejl"}) — dommen står.`
}[result.status] || (() => `Papiret ikke bundet (${result.status}) — dommen står.`);

if (options.json) console.log(JSON.stringify({ status: result.status, decisions: result.decisions ?? 0, line: line() }));
else console.log(line());
process.exit(0);
