import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;

function now() {
  return new Date().toISOString();
}

function cleanInline(value, maxLength = 240) {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function cleanPath(value) {
  return cleanInline(value, 500);
}

function transcriptIdFromPath(value) {
  return basename(cleanPath(value)).replace(/\.jsonl$/u, "");
}

function pathTarget(input = {}) {
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  return cleanPath(toolInput.file_path || toolInput.path || input.file_path || input.path);
}

function commandHead(input = {}) {
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const command = cleanInline(toolInput.command || input.command, 500);
  if (!command) return "";
  const match = command.match(/^\s*(?:env\s+)?([A-Za-z0-9_./:-]+)/u);
  return cleanInline(match?.[1] || "command", 80);
}

function eventSummary(input = {}, extra = {}) {
  const eventName = cleanInline(extra.eventName || input.hook_event_name || input.hookEventName || "unknown", 80);
  const parts = [eventName];
  const toolName = cleanInline(input.tool_name || input.toolName, 80);
  const target = pathTarget(input);
  const command = commandHead(input);
  const source = cleanInline(input.source || input.trigger || input.load_reason || input.notification_type, 80);
  const decision = cleanInline(extra.decision || input.decision || "", 80);
  const instruction = cleanPath(input.file_path);
  if (toolName) parts.push(`tool=${toolName}`);
  if (target) parts.push(`path=${target}`);
  if (command) parts.push(`cmd=${command}`);
  if (instruction && eventName === "InstructionsLoaded") parts.push(`file=${instruction}`);
  if (source) parts.push(`source=${source}`);
  if (decision) parts.push(`decision=${decision}`);
  return parts.join(" ");
}

function eventPayload(root, input = {}, extra = {}) {
  const eventName = cleanInline(extra.eventName || input.hook_event_name || input.hookEventName || "unknown", 80);
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const toolResponse = input.tool_response && typeof input.tool_response === "object" ? input.tool_response : {};
  const payload = {
    schema: "nogra.liveHookEvent.v1",
    timestamp: now(),
    eventName,
    sessionId: cleanInline(input.session_id || input.sessionId, 160),
    transcriptId: transcriptIdFromPath(input.transcript_path || input.transcriptPath),
    transcriptPath: cleanPath(input.transcript_path || input.transcriptPath),
    cwd: cleanPath(input.cwd),
    workspaceRoot: cleanPath(root),
    permissionMode: cleanInline(input.permission_mode || input.permissionMode, 80),
    summary: eventSummary(input, { ...extra, eventName })
  };

  const toolName = cleanInline(input.tool_name || input.toolName, 80);
  if (toolName) {
    payload.tool = {
      name: toolName,
      useId: cleanInline(input.tool_use_id || input.toolUseId, 120),
      targetPath: pathTarget(input),
      commandHead: commandHead(input),
      durationMs: Number.isFinite(Number(input.duration_ms)) ? Number(input.duration_ms) : undefined,
      success: Object.hasOwn(toolResponse, "success") ? Boolean(toolResponse.success) : undefined
    };
  }

  if (eventName === "InstructionsLoaded") {
    payload.instruction = {
      filePath: cleanPath(input.file_path),
      memoryType: cleanInline(input.memory_type, 80),
      loadReason: cleanInline(input.load_reason, 80),
      triggerFilePath: cleanPath(input.trigger_file_path),
      parentFilePath: cleanPath(input.parent_file_path),
      globsCount: Array.isArray(input.globs) ? input.globs.length : 0
    };
  }

  const notificationType = cleanInline(input.notification_type, 80);
  if (notificationType) {
    payload.notification = {
      type: notificationType,
      title: cleanInline(input.title, 120)
    };
  }

  const agentType = cleanInline(input.agent_type || input.subagent_type, 120);
  if (agentType || input.agent_id) {
    payload.agent = {
      id: cleanInline(input.agent_id, 120),
      type: agentType
    };
  }

  if (extra.decision || extra.action || extra.reason) {
    payload.nogra = {
      decision: cleanInline(extra.decision, 80),
      action: cleanInline(extra.action, 120),
      reason: cleanInline(extra.reason, 240)
    };
  }

  if (input.error) {
    payload.error = cleanInline(input.error, 240);
  }

  // Never persist prompt bodies, tool outputs, file contents, or full shell commands here.
  if (toolInput.description) {
    payload.tool.description = cleanInline(toolInput.description, 160);
  }

  return payload;
}

function writeLatest(file, payload) {
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function liveLogMaxBytes() {
  const configured = Number(process.env.NOGRA_LIVE_HOOK_LOG_MAX_BYTES || "");
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LOG_MAX_BYTES;
}

function rotateIfNeeded(file, maxBytes = liveLogMaxBytes()) {
  if (!existsSync(file)) return;
  if (statSync(file).size <= maxBytes) return;
  const backup = `${file}.1`;
  if (existsSync(backup)) {
    rmSync(backup, { force: true });
  }
  renameSync(file, backup);
}

export function captureLiveHookEvent(root, input = {}, extra = {}) {
  try {
    if (!root || !existsSync(join(root, ".nogra", "config.json"))) return null;
    const runtimeDir = join(root, ".nogra", "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    const payload = eventPayload(root, input, extra);
    const jsonlPath = join(runtimeDir, "live-hooks.jsonl");
    const textPath = join(runtimeDir, "live-hooks.log");
    rotateIfNeeded(jsonlPath);
    rotateIfNeeded(textPath);
    appendFileSync(jsonlPath, `${JSON.stringify(payload)}\n`, "utf8");
    appendFileSync(textPath, `${payload.timestamp} ${payload.summary}\n`, "utf8");
    writeLatest(join(runtimeDir, "live-hooks.latest.json"), payload);
    return payload;
  } catch {
    return null;
  }
}
