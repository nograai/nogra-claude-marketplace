#!/usr/bin/env node
// Task-deleted receipt (PostToolUse, matcher TaskUpdate): when a task is deleted, recover its subject/
// description from the session transcript and stamp them in the ledger — a pointer must never vanish
// with the list it lived on. Silent; fail-open.
import fs from "node:fs";
import path from "node:path";
import { findWorkspaceRoot, appendLedger, readWallsConfig } from "../runtime/local/walls.mjs";

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function recoverTask(transcriptPath, taskId) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return {};
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  let subject = "", description = "";
  for (const line of lines) {
    if (!line.includes("\"name\":\"Task")) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const content = e?.message?.content; if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type !== "tool_use" || !/^Task(Create|Update)$/u.test(c.name || "")) continue;
      const inp = c.input || {};
      if (c.name === "TaskUpdate" && String(inp.taskId) !== String(taskId)) continue;
      if (inp.subject) subject = inp.subject;
      if (inp.description) description = inp.description;
      if (c.name === "TaskCreate") { /* TaskCreate has no id in input; keep the latest created subject as a fallback */ }
    }
  }
  return { subject, description };
}
try {
  const input = JSON.parse(readStdin() || "{}");
  const ti = input.tool_input || {};
  if (String(ti.status) !== "deleted") process.exit(0);
  const root = findWorkspaceRoot([process.env.CLAUDE_PROJECT_ROOT || "", input.cwd || "", process.cwd()]);
  if (!root) process.exit(0);
  const config = readWallsConfig(root);
  const { subject, description } = recoverTask(input.transcript_path, ti.taskId);
  const now = new Date().toISOString();
  appendLedger(root, {
    schema: "nogra.event.v1", releaseVersion: "v1.0.0",
    eventId: `task-deleted-${now.replace(/[-:TZ.]/g, "").slice(0, 14)}-${String(ti.taskId)}`,
    createdAt: now, workspaceId: config.workspaceId, eventType: "task-deleted", source: "hooks/task-deleted.mjs",
    message: `task #${ti.taskId} deleted — ${subject ? `subject: ${subject}` : "subject: (not recovered from transcript)"}${description ? ` — description: ${String(description).slice(0, 600)}` : ""}`,
    metadata: { taskId: String(ti.taskId), subject, description: String(description || "").slice(0, 2000), sessionId: input.session_id || "" },
    briefId: "", runId: "", redactions: []
  });
} catch { /* fail-open */ }
process.exit(0);
