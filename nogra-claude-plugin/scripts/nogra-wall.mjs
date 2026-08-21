#!/usr/bin/env node
// nogra-wall — record | list | match "<text>" | project   [--root <dir>]
//   record --symptom "…" --cause "…" --cure "…" --who "…" --durable "…" [--status open|closed] [--ref "…"]
import { findWorkspaceRoot, matchWalls, openWalls, projectWalls, readWallsConfig, recordWall } from "../runtime/local/walls.mjs";

const args = process.argv.slice(2);
const opts = {}; const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith("--")) { opts[args[i].slice(2)] = args[i + 1] ?? ""; i += 1; } else positional.push(args[i]);
}
const root = findWorkspaceRoot([opts.root || "", process.env.CLAUDE_PROJECT_ROOT || "", process.cwd()]);
if (!root) { console.error("STOP: no Nogra workspace (.nogra/config.json) found"); process.exit(64); }
const config = readWallsConfig(root);
const cmd = positional[0] || "list";
if (cmd === "record") {
  if (!opts.symptom) { console.error("usage: nogra-wall record --symptom ... --cause ... --cure ... --who ... --durable ... [--status open|closed] [--ref ...]"); process.exit(64); }
  const ev = recordWall(root, { symptom: opts.symptom, cause: opts.cause, cureNow: opts.cure, whoClicks: opts.who, durableFix: opts.durable, status: opts.status || "open", ref: opts.ref, workspaceId: config.workspaceId });
  console.log(`WALL recorded: ${ev.eventId} (${opts.status || "open"}) → .nogra/state/WALLS.md`);
} else if (cmd === "list") {
  const walls = openWalls(root);
  if (walls.length === 0) console.log("no open walls");
  for (const w of walls) console.log(`- ${w.ts.slice(0, 16)} · ${w.symptom} · cure now: ${w.cureNow} · who: ${w.whoClicks} · durable: ${w.durableFix}`);
} else if (cmd === "match") {
  const text = positional.slice(1).join(" ");
  const r = matchWalls(root, text, { config });
  console.log(JSON.stringify({ terms: r.terms, repeats: r.repeats, hasWallRecord: !!r.hasWallRecord, matches: r.matches }, null, 2));
} else if (cmd === "project") {
  console.log(projectWalls(root));
} else { console.error("usage: nogra-wall record|list|match|project"); process.exit(64); }
