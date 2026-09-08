#!/usr/bin/env node
// Walls smoke: the known facits (21/08/2026). Temp workspace only; never touches a real workspace.
//   1. symptom "Security error … /cdn-cgi/access/authorized" matches the earlier ledger event (the Safe Browsing wall)
//   2. two earlier hits and no wall record -> NAG in the recall block
//   3. record a wall -> WALLS.md projection lists it; recall now shows WALL first, no nag
//   4. plain text without a wall signal -> hook silent
//   5. task-deleted hook recovers subject/description from a fixture transcript and stamps the ledger
//   6. garbage stdin -> hooks exit 0 silently (fail-open)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const RECALL = path.join(pluginRoot, "hooks", "wall-recall.mjs");
const TASKDEL = path.join(pluginRoot, "hooks", "task-deleted.mjs");
const CLI = path.join(pluginRoot, "scripts", "nogra-wall.mjs");
function assert(c, m) { if (!c) throw new Error(m); }
function ws() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-walls-"));
  fs.mkdirSync(path.join(root, ".nogra", "ledger"), { recursive: true });
  fs.writeFileSync(path.join(root, ".nogra", "config.json"), JSON.stringify({ schema: "nogra.workspace.config.v1", workspaceId: "walls-smoke", installMode: "plugin", connectionMode: "local" }));
  const ev = (d, type, message) => JSON.stringify({ schema: "nogra.event.v1", eventId: `e-${type}-${d}`, createdAt: d, workspaceId: "walls-smoke", eventType: type, message });
  fs.writeFileSync(path.join(root, ".nogra", "ledger", "events.jsonl"), [
    ev("2026-08-19T20:07:00Z", "koe-safe-browsing", "CEO finding: Chrome shows a Dangerous warning on boligscout.y26.dev (Safe Browsing, likely brand-on-foreign-domain = deceptive flag)."),
    ev("2026-08-20T22:59:00Z", "safe-browsing-wall-back", "Chrome Dangerous site on boligscout.y26.dev/cdn-cgi/access/authorized again: the 24h Access cookie expired -> SSO re-login -> callback flagged (Google heuristic, not our page). The extension cannot touch the interstitial (Cannot attach / showing error page) -> CEO clicks Details -> visit (new cookie). Durable cure: Search Console review."),
    ev("2026-08-21T02:50:00Z", "safe-browsing-report-sent", "Root found: the flagged URL is /cdn-cgi/access/authorized?nonce=... Cloudflare Access standard SSO callback judged as phishing. FIX: Google false-positive form submitted."),
    ev("2026-08-21T10:00:00Z", "unrelated", "lbm floor 0->80, fence exit 0.")
  ].join("\n") + "\n");
  return root;
}
function hook(script, root, input) {
  const r = spawnSync(process.execPath, [script], { input: JSON.stringify({ cwd: root, ...input }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert(r.status === 0, `${path.basename(script)} exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const now = Date.parse("2026-08-21T17:30:00Z");
process.env.NOGRA_WALLS_NOW = String(now);
const root = ws();
const symptom = "actions[11] (computer:screenshot) failed: Error capturing screenshot: Frame with ID 0 is showing error page — tab title Security error — url https://boligscout.y26.dev/cdn-cgi/access/authorized?nonce=abc";
// 1
let r = hook(RECALL, root, { hook_event_name: "PostToolUse", tool_name: "mcp__claude-in-chrome__browser_batch", tool_response: symptom });
const ctx = r?.hookSpecificOutput?.additionalContext || "";
assert(ctx.includes("NOGRA_WALL_RECALL") && ctx.includes("/cdn-cgi/access/authorized") && ctx.includes("Details"), `1: recall must surface the Safe Browsing wall event, got: ${ctx.slice(0, 300)}`);
// 2
assert(/NAG:/u.test(ctx), "2: two earlier hits without a wall record must NAG");
// 3
const out = execFileSync(process.execPath, [CLI, "record", "--symptom", "Security error on /cdn-cgi/access/authorized (Safe Browsing flags the Access SSO callback)", "--cause", "Google heuristic: brand clone + login flow on unknown domain", "--cure", "CEO clicks Details -> visit in the QA browser", "--who", "CEO", "--durable", "Google false-positive review (submitted 21/08) + Search Console verification", "--ref", "ledger 20/08 22:59", "--root", root], { encoding: "utf8" });
assert(/WALL recorded/u.test(out), `3: record: ${out}`);
const walls = fs.readFileSync(path.join(root, ".nogra", "state", "WALLS.md"), "utf8");
assert(walls.includes("Safe Browsing") && walls.includes("CEO clicks"), "3: WALLS.md must list the wall with its cure");
r = hook(RECALL, root, { hook_event_name: "UserPromptSubmit", prompt: "the preview tab shows Security error on /cdn-cgi/access/authorized again — error page" });
const ctx2 = r?.hookSpecificOutput?.additionalContext || "";
assert(ctx2.includes("WALL") && !/NAG:/u.test(ctx2), `3b: with a wall record the recall leads with WALL and stops nagging: ${ctx2.slice(0, 300)}`);
// 4
r = hook(RECALL, root, { hook_event_name: "UserPromptSubmit", prompt: "please summarise the morning numbers" });
assert(r === null, "4: plain prompt must be silent");
// 5
const transcript = path.join(root, "transcript.jsonl");
fs.writeFileSync(transcript, [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "TaskCreate", input: { subject: "Safe Browsing durable cure", description: "Search Console verification + review request" } }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "TaskUpdate", input: { taskId: "18", description: "Search Console verification (CEO Google login) + TXT in CF DNS + request review" } }] } })
].join("\n") + "\n");
hook(TASKDEL, root, { hook_event_name: "PostToolUse", tool_name: "TaskUpdate", tool_input: { taskId: "18", status: "deleted" }, transcript_path: transcript });
const ledger = fs.readFileSync(path.join(root, ".nogra", "ledger", "events.jsonl"), "utf8");
assert(/"eventType":"task-deleted"/u.test(ledger) && /Search Console verification/u.test(ledger), "5: task-deleted must stamp the recovered description");
// 6
let g = spawnSync(process.execPath, [RECALL], { input: "not json at all", encoding: "utf8" });
assert(g.status === 0 && !g.stdout.trim(), "6: garbage must be silent, exit 0");
g = spawnSync(process.execPath, [TASKDEL], { input: "{{", encoding: "utf8" });
assert(g.status === 0, "6b: task-deleted garbage must exit 0");
console.log("smoke-walls: 6/6 facits green (recall x2, nag, record+project, silent, task-deleted, fail-open)");
