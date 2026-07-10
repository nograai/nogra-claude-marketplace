import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function now() {
  return new Date().toISOString();
}

function transcriptIdFromPath(value) {
  return basename(cleanInline(value)).replace(/\.jsonl$/u, "");
}

function writeJsonAtomic(file, payload) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function readPreviousAnchor(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

export function captureSessionAnchor(root, input = {}, hookEventName = "") {
  if (!existsSync(join(root, ".nogra", "config.json"))) return null;
  const sessionId = cleanInline(input.session_id || input.sessionId);
  const transcriptPath = cleanInline(input.transcript_path || input.transcriptPath);
  if (!sessionId && !transcriptPath) return null;

  const file = join(root, ".nogra", "runtime", "session-anchor.json");
  const previous = readPreviousAnchor(file);
  const next = {
    schema: "nogra.sessionAnchor.v1",
    updatedAt: now(),
    sessionId: sessionId || cleanInline(previous.sessionId),
    transcriptId: transcriptIdFromPath(transcriptPath) || cleanInline(previous.transcriptId),
    transcriptPath: transcriptPath || cleanInline(previous.transcriptPath),
    cwd: cleanInline(input.cwd || previous.cwd),
    hookEventName: cleanInline(hookEventName || input.hook_event_name || input.hookEventName),
    permissionMode: cleanInline(input.permission_mode || input.permissionMode || previous.permissionMode)
  };
  const source = cleanInline(input.source || previous.source);
  const model = cleanInline(input.model || previous.model);
  if (source) next.source = source;
  if (model) next.model = model;
  writeJsonAtomic(file, next);
  return next;
}
