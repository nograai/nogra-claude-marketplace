#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const TERMINAL_STATUSES = new Set(["ok", "partial", "blocked", "failed", "cancelled"]);
const TERMINAL_EVENT_TYPES = new Set([
  "transport_run_returned",
  "transport_run_cancelled",
  "local_verification_recorded",
  "transport_acknowledged"
]);
const VALID_PHASES = new Set(["queued", "running", "returning", "returned", "acknowledged"]);
const VALID_OPERATIONS = new Set(["write_json", "write_text", "append_jsonl"]);

function usage() {
  return [
    "Usage:",
    "  node scripts/nogra-ledger.mjs apply-local-writes [--root <dir>] [--input <file>] [--json]",
    "  node scripts/nogra-ledger.mjs finalize-run [--root <dir>] [--input <file>] [--json] [--allow-overwrite] [--allow-status-change]",
    "  node scripts/nogra-ledger.mjs check-run [--root <dir>] --run-id <runId> [--json]",
    "",
    "Input for apply-local-writes is either an array of localWrites or an object with localWrites.",
    "Input for finalize-run is a JSON object with runId, status, optional phase, summary, reportText, outputText, stopReason, returnReason and pendingState."
  ].join("\n");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      out._.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals > -1) {
      out[value.slice(2, equals)] = value.slice(equals + 1);
      continue;
    }
    const name = value.slice(2);
    if (["json", "allow-overwrite", "allow-status-change"].includes(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    out[name] = next;
    index += 1;
  }
  return out;
}

function now() {
  return new Date().toISOString();
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function roleDisplayName(scopedRole) {
  const role = cleanInline(scopedRole).split(":").pop() || "";
  return role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : "Role";
}

function statusDisplayName(status) {
  const cleaned = cleanInline(status);
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "";
}

function runtimeDisplayName(runtime) {
  const cleaned = cleanInline(runtime)
    .replace(/^anthropic:/, "")
    .replace(/^claude-/, "")
    .replace(/-/g, " ");
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part, index) => (/^\d+$/.test(part) && index > 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ")
    .replace(/\b(\d)\s+(\d)\b/g, "$1.$2");
}

function roleRuntimePair(record, status = "") {
  const executionRole = cleanInline(record.executionRole || record.metadata?.executionRole || "");
  const executionRuntime = cleanInline(record.executionRuntime || record.metadata?.executionRuntime || record.targetModel || "");
  const executionRuntimeSource = cleanInline(record.executionRuntimeSource || record.metadata?.executionRuntimeSource || "");
  const executionLabel = [roleDisplayName(executionRole), runtimeDisplayName(executionRuntime), statusDisplayName(status)]
    .filter(Boolean)
    .join(" · ");
  return { executionRole, executionRuntime, executionRuntimeSource, executionLabel };
}

function verificationRoleRuntimePair(record, input = {}) {
  const verificationRole = cleanInline(input.verificationRole || record.verificationRole || record.metadata?.verificationRole || "");
  const verificationRuntime = cleanInline(input.verificationRuntime || record.verificationRuntime || record.metadata?.verificationRuntime || "");
  const verificationRuntimeSource = cleanInline(input.verificationRuntimeSource || record.verificationRuntimeSource || record.metadata?.verificationRuntimeSource || "");
  const verificationStatus = cleanInline(input.verificationStatus || record.verificationStatus || record.metadata?.verificationStatus || "");
  const verificationLabel = [roleDisplayName(verificationRole), runtimeDisplayName(verificationRuntime), statusDisplayName(verificationStatus)]
    .filter(Boolean)
    .join(" · ");
  if (!verificationRole && !verificationRuntime && !verificationStatus) {
    return null;
  }
  return { verificationRole, verificationRuntime, verificationRuntimeSource, verificationStatus, verificationLabel };
}

function defaultReturnReason(stopReason) {
  if (stopReason === "maxTurns_exhausted") {
    return "Work stopped before completion while tool work was still pending.";
  }
  return "";
}

function continuationFields(input = {}) {
  const stopReason = cleanInline(input.stopReason || "");
  const returnReason = cleanInline(input.returnReason || input.reason || defaultReturnReason(stopReason));
  const pendingState = input.pendingState && typeof input.pendingState === "object" && !Array.isArray(input.pendingState)
    ? input.pendingState
    : null;
  const out = {};
  if (stopReason) out.stopReason = stopReason;
  if (returnReason) out.returnReason = returnReason;
  if (pendingState) out.pendingState = pendingState;
  return out;
}

function safeRunId(runId) {
  const cleaned = cleanInline(runId);
  if (!/^transport-[A-Za-z0-9._-]+$/.test(cleaned)) {
    throw new Error(`invalid run id: ${cleaned || "(empty)"}`);
  }
  return cleaned;
}

function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  return fs.readFileSync(0, "utf8");
}

function readInput(options, required = true) {
  const file = options.input ? path.resolve(String(options.input)) : "";
  const text = file ? fs.readFileSync(file, "utf8") : readStdin();
  if (!text.trim()) {
    if (required) {
      throw new Error("JSON input required via --input or stdin");
    }
    return {};
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("JSON input must be an object or array");
  }
  return parsed;
}

function directoryExists(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function normalizeDirectory(value) {
  const resolved = path.resolve(String(value || process.cwd()));
  if (!fs.existsSync(resolved)) return resolved;
  const stat = fs.statSync(resolved);
  const directory = stat.isDirectory() ? resolved : path.dirname(resolved);
  return fs.realpathSync(directory);
}

function nearestNograWorkspaceRoot(start) {
  let current = normalizeDirectory(start);
  while (true) {
    if (directoryExists(path.join(current, ".nogra"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return "";
    }
    current = parent;
  }
}

function workspaceRoot(options) {
  const requested = options.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const fallback = normalizeDirectory(requested);
  return nearestNograWorkspaceRoot(fallback) || fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf8");
    if (current === content) {
      return "noop";
    }
  }
  atomicWrite(file, content);
  return "applied";
}

function normalizeLocalWritePath(pathValue) {
  const raw = String(pathValue ?? "").replaceAll("\\", "/").trim();
  if (!raw) {
    throw new Error("local write path is empty");
  }
  if (raw.startsWith("/") || raw.startsWith("~") || raw.includes("\0")) {
    throw new Error(`local write path must be relative under .nogra/: ${raw}`);
  }
  if ([...raw].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new Error("local write path contains a control character");
  }
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`local write path escapes .nogra/: ${raw}`);
  }
  const normalized = parts.join("/");
  if (!normalized.startsWith(".nogra/")) {
    throw new Error(`local write path must stay under .nogra/: ${raw}`);
  }
  return normalized;
}

function nearestExistingParent(file) {
  let current = path.dirname(file);
  const missing = [];
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return { existingParent: current, missing };
}

function resolveLocalWrite(root, localPath) {
  const normalized = normalizeLocalWritePath(localPath);
  const rootReal = fs.realpathSync(root);
  const nograRoot = path.join(rootReal, ".nogra");
  ensureDir(nograRoot);
  const nograReal = fs.realpathSync(nograRoot);
  const lexicalTarget = path.resolve(rootReal, normalized);
  if (lexicalTarget !== nograReal && !lexicalTarget.startsWith(`${nograReal}${path.sep}`)) {
    throw new Error(`resolved local write path escapes .nogra/: ${normalized}`);
  }
  const { existingParent, missing } = nearestExistingParent(lexicalTarget);
  const parentReal = fs.realpathSync(existingParent);
  if (parentReal !== nograReal && !parentReal.startsWith(`${nograReal}${path.sep}`)) {
    throw new Error(`resolved local write parent escapes .nogra/: ${normalized}`);
  }
  const target = path.join(parentReal, ...missing, path.basename(lexicalTarget));
  return { normalized, target };
}

function parseJsonl(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonlIfMissing(file, content, idempotencyField, idempotencyKey) {
  ensureDir(path.dirname(file));
  const key = cleanInline(idempotencyKey);
  const field = cleanInline(idempotencyField || "eventId");
  if (key && fs.existsSync(file)) {
    const exists = parseJsonl(file).some((item) => String(item?.[field] ?? "") === key);
    if (exists) {
      return "skipped";
    }
  }
  fs.appendFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return "applied";
}

function applyOneLocalWrite(root, write) {
  if (!write || typeof write !== "object") {
    throw new Error("localWrite item must be an object");
  }
  const operation = cleanInline(write.operation);
  if (!VALID_OPERATIONS.has(operation)) {
    throw new Error(`unsupported localWrite operation: ${operation || "(empty)"}`);
  }
  const { normalized, target } = resolveLocalWrite(root, write.path);
  const content = String(write.content ?? "");
  let result;
  if (operation === "append_jsonl") {
    result = appendJsonlIfMissing(target, content, write.idempotencyField, write.idempotencyKey);
  } else {
    result = writeIfChanged(target, content);
  }
  return { path: normalized, operation, result };
}

function extractLocalWrites(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (Array.isArray(input.localWrites)) {
    return input.localWrites;
  }
  throw new Error("input must be localWrites array or object with localWrites");
}

function applyLocalWrites(root, input) {
  const writes = extractLocalWrites(input);
  const applied = [];
  const rejected = [];
  for (const write of writes) {
    try {
      applied.push(applyOneLocalWrite(root, write));
    } catch (error) {
      rejected.push({
        path: String(write?.path ?? ""),
        operation: String(write?.operation ?? ""),
        error: error.message
      });
    }
  }
  return {
    status: rejected.length ? "partial" : "ok",
    applied,
    rejected,
    counts: {
      applied: applied.filter((item) => item.result === "applied").length,
      noop: applied.filter((item) => item.result === "noop").length,
      skipped: applied.filter((item) => item.result === "skipped").length,
      rejected: rejected.length
    }
  };
}

function transportPaths(root, runId, existing = {}) {
  const artifactsDir = existing.artifactsDir || `.nogra/transport/artifacts/${runId}`;
  return {
    artifactsDir,
    report: existing.report || `${artifactsDir}/report.md`,
    output: existing.output || `${artifactsDir}/output.md`,
    log: existing.log || `${artifactsDir}/log`
  };
}

function runFile(root, runId) {
  return path.join(root, ".nogra", "transport", "runs", `${runId}.json`);
}

function eventsFile(root) {
  return path.join(root, ".nogra", "transport", "events.jsonl");
}

function ledgerEventsFile(root) {
  return path.join(root, ".nogra", "ledger", "events.jsonl");
}

function sessionAnchorFile(root) {
  return path.join(root, ".nogra", "runtime", "session-anchor.json");
}

function workspaceConfigFile(root) {
  return path.join(root, ".nogra", "config.json");
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonFileIfValid(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return readJsonFile(file);
  } catch {
    return null;
  }
}

function readWorkspaceConfig(root) {
  const config = readJsonFileIfValid(workspaceConfigFile(root));
  return config && typeof config === "object" ? config : {};
}

function resolvedWorkspaceId(root, explicit = "") {
  return cleanInline(explicit) || cleanInline(readWorkspaceConfig(root).workspaceId) || "local";
}

function nonEmptyLineCount(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).filter((line) => line.trim()).length;
}

function transcriptIdFromPath(value) {
  const base = path.basename(cleanInline(value));
  return base.replace(/\.jsonl$/u, "");
}

function readSessionAnchor(root) {
  const anchor = readJsonFileIfValid(sessionAnchorFile(root));
  if (!anchor || typeof anchor !== "object") {
    return { sessionId: "", transcriptId: "" };
  }
  return {
    sessionId: cleanInline(anchor.sessionId),
    transcriptId: cleanInline(anchor.transcriptId) || transcriptIdFromPath(anchor.transcriptPath)
  };
}

function appendLedgerEvent(root, type, extra = {}) {
  const { releaseVersion: _ignoredReleaseVersion, ...safeExtra } = extra;
  const session = readSessionAnchor(root);
  const eventId = cleanInline(safeExtra.eventId) || `ledger-event-${cleanInline(safeExtra.runId || "local")}-${type}`;
  const existing = eventId && fs.existsSync(ledgerEventsFile(root))
    ? parseJsonl(ledgerEventsFile(root)).find((item) => String(item?.eventId ?? "") === eventId)
    : null;
  if (existing) return existing;
  const ledgerWatermark = nonEmptyLineCount(ledgerEventsFile(root)) + 1;
  const at = now();
  const event = {
    schema: "nogra.ledger.event.v1",
    eventId,
    ledgerWatermark,
    generatedAt: at,
    createdAt: at,
    workspaceId: resolvedWorkspaceId(root, safeExtra.workspaceId),
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    type,
    ...safeExtra
  };
  appendJsonlIfMissing(ledgerEventsFile(root), JSON.stringify(event), "eventId", event.eventId);
  return event;
}

function localTarget(root, localPath) {
  return resolveLocalWrite(root, localPath).target;
}

function artifactFlags(root, paths) {
  return {
    reportExists: Boolean(paths.report && fs.existsSync(localTarget(root, paths.report)) && fs.statSync(localTarget(root, paths.report)).isFile()),
    outputExists: Boolean(paths.output && fs.existsSync(localTarget(root, paths.output)) && fs.statSync(localTarget(root, paths.output)).isFile()),
    logExists: Boolean(paths.log && fs.existsSync(localTarget(root, paths.log)) && fs.statSync(localTarget(root, paths.log)).isFile())
  };
}

function terminalEventId(runId, status) {
  return `transport-event-${runId}-terminal-${status}`;
}

function finalizeRun(root, input, options = {}) {
  const runId = safeRunId(input.runId);
  const status = cleanInline(input.status).toLowerCase();
  if (!TERMINAL_STATUSES.has(status)) {
    throw new Error(`finalize-run status must be terminal: ${status || "(empty)"}`);
  }
  const phase = cleanInline(input.phase || "returned").toLowerCase();
  if (!VALID_PHASES.has(phase)) {
    throw new Error(`invalid phase: ${phase}`);
  }
  const file = runFile(root, runId);
  if (!fs.existsSync(file)) {
    return { status: "missing", runId, error: "transport run not found", nextOwner: "Manager" };
  }
  const record = readJsonFile(file);
  const currentStatus = cleanInline(record.status).toLowerCase();
  if (TERMINAL_STATUSES.has(currentStatus) && currentStatus !== status && !options.allowStatusChange) {
    return {
      status: "conflict",
      runId,
      currentStatus,
      requestedStatus: status,
      nextOwner: "Manager",
      reason: "terminal status change requires explicit Manager decision"
    };
  }
  const paths = transportPaths(root, runId, record.paths && typeof record.paths === "object" ? record.paths : {});
  const reportText = String(input.reportText ?? "");
  const outputText = String(input.outputText ?? "");
  const reportPath = localTarget(root, paths.report);
  const outputPath = localTarget(root, paths.output);
  const reportResult = reportText
    ? writeMaybeArtifact(reportPath, reportText, options.allowOverwrite)
    : "not_provided";
  const outputPayload = outputText || reportText;
  const outputResult = outputPayload
    ? writeMaybeArtifact(outputPath, outputPayload, options.allowOverwrite)
    : "not_provided";
  const flags = artifactFlags(root, paths);
  const completedAt = record.completedAt || cleanInline(input.completedAt) || now();
  const executionPair = roleRuntimePair(record, status);
  const verificationPair = verificationRoleRuntimePair(record, input);
  const continuation = continuationFields(input);
  const eventWorkspaceId = resolvedWorkspaceId(root, input.workspaceId || record.workspaceId || record.metadata?.workspaceId);
  const ledgerEvent = appendLedgerEvent(root, status === "cancelled" ? "transport_run_cancelled" : "transport_run_returned", {
    eventId: `ledger-event-${runId}-terminal-${status}`,
    workspaceId: eventWorkspaceId,
    runId,
    status,
    phase,
    briefId: cleanInline(record.briefId || input.briefId || ""),
    summary: cleanInline(input.summary || ""),
    ...continuation
  });
  const verificationFields = verificationPair
    ? {
        verificationRole: verificationPair.verificationRole,
        verificationRuntime: verificationPair.verificationRuntime,
        verificationRuntimeSource: verificationPair.verificationRuntimeSource,
        verificationStatus: verificationPair.verificationStatus,
        verificationLabel: verificationPair.verificationLabel
      }
    : {};
  const updated = {
    ...record,
    runId,
    workspaceId: eventWorkspaceId,
    updatedAt: now(),
    status,
    phase,
    paths,
    artifacts: flags,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId || record.sessionId || record.metadata?.sessionId || "",
    transcriptId: ledgerEvent.transcriptId || record.transcriptId || record.metadata?.transcriptId || "",
    executionRole: executionPair.executionRole || record.executionRole || "",
    executionRuntime: executionPair.executionRuntime || record.executionRuntime || "",
    executionRuntimeSource: executionPair.executionRuntimeSource || record.executionRuntimeSource || "",
    executionLabel: executionPair.executionLabel || record.executionLabel || "",
    ...verificationFields,
    ...continuation,
    completedAt,
    durationSeconds: record.createdAt ? durationSeconds(record.createdAt, completedAt) : record.durationSeconds ?? null,
    summary: input.summary != null ? cleanInline(input.summary) : record.summary ?? "",
    error: input.error != null ? cleanInline(input.error) : record.error ?? "",
    metadata: record.metadata && typeof record.metadata === "object"
      ? {
          ...record.metadata,
          executionRole: executionPair.executionRole || record.metadata.executionRole || "",
          executionRuntime: executionPair.executionRuntime || record.metadata.executionRuntime || "",
          executionRuntimeSource: executionPair.executionRuntimeSource || record.metadata.executionRuntimeSource || "",
          executionLabel: executionPair.executionLabel || record.metadata.executionLabel || "",
          ledgerWatermark: ledgerEvent.ledgerWatermark,
          workspaceId: eventWorkspaceId,
          sessionId: ledgerEvent.sessionId || record.metadata.sessionId || "",
          transcriptId: ledgerEvent.transcriptId || record.metadata.transcriptId || "",
          ...verificationFields,
          ...continuation,
          nextOwner: input.nextOwner || "Manager"
        }
      : {
          executionRole: executionPair.executionRole,
          executionRuntime: executionPair.executionRuntime,
          executionRuntimeSource: executionPair.executionRuntimeSource,
          executionLabel: executionPair.executionLabel,
          ledgerWatermark: ledgerEvent.ledgerWatermark,
          workspaceId: eventWorkspaceId,
          sessionId: ledgerEvent.sessionId,
          transcriptId: ledgerEvent.transcriptId,
          ...verificationFields,
          ...continuation,
          nextOwner: input.nextOwner || "Manager"
        }
  };
  writeIfChanged(file, `${JSON.stringify(updated, null, 2)}\n`);
  const event = {
    schema: "nogra.transport.event.v1",
    eventId: cleanInline(input.eventId) || terminalEventId(runId, status),
    generatedAt: cleanInline(input.eventAt) || completedAt,
    createdAt: cleanInline(input.eventAt) || completedAt,
    workspaceId: eventWorkspaceId,
    runId,
    type: status === "cancelled" ? "transport_run_cancelled" : "transport_run_returned",
    status,
    phase,
    executionRole: executionPair.executionRole,
    executionRuntime: executionPair.executionRuntime,
    executionRuntimeSource: executionPair.executionRuntimeSource,
    executionLabel: executionPair.executionLabel,
    ledgerWatermark: ledgerEvent.ledgerWatermark,
    sessionId: ledgerEvent.sessionId,
    transcriptId: ledgerEvent.transcriptId,
    ...verificationFields,
    ...continuation,
    briefId: cleanInline(record.briefId || input.briefId || ""),
    summary: cleanInline(input.summary || ""),
    nextOwner: input.nextOwner || "Manager"
  };
  const eventResult = appendJsonlIfMissing(eventsFile(root), JSON.stringify(event), "eventId", event.eventId);
  const check = checkRun(root, runId);
  return {
    status: check.status === "ok" ? "ok" : "inconsistent",
    runId,
    report: paths.report,
    output: paths.output,
    artifacts: flags,
    writes: { report: reportResult, output: outputResult, run: "applied", event: eventResult },
    consistency: check,
    nextOwner: "Manager"
  };
}

function writeMaybeArtifact(file, text, allowOverwrite) {
  const content = text.endsWith("\n") ? text : `${text}\n`;
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf8");
    if (current === content) {
      return "noop";
    }
    if (!allowOverwrite && current.trim()) {
      throw new Error(`artifact exists with different content: ${file}`);
    }
  }
  atomicWrite(file, content);
  return "applied";
}

function durationSeconds(startValue, endValue) {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

function latestTerminalEvent(root, runId) {
  const events = parseJsonl(eventsFile(root)).filter((event) => event.runId === runId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (TERMINAL_EVENT_TYPES.has(event.type)) {
      return event;
    }
    if (!event.type && TERMINAL_STATUSES.has(String(event.status || "").toLowerCase())) {
      return event;
    }
  }
  return null;
}

function checkRun(root, runIdValue) {
  const runId = safeRunId(runIdValue);
  const file = runFile(root, runId);
  if (!fs.existsSync(file)) {
    return { status: "missing", runId, differences: [{ field: "run", expected: "exists", actual: "missing" }], nextOwner: "Manager" };
  }
  const record = readJsonFile(file);
  const paths = transportPaths(root, runId, record.paths && typeof record.paths === "object" ? record.paths : {});
  const expectedFlags = artifactFlags(root, paths);
  const actualFlags = record.artifacts && typeof record.artifacts === "object" ? record.artifacts : {};
  const differences = [];
  for (const key of ["reportExists", "outputExists", "logExists"]) {
    if (Boolean(actualFlags[key]) !== Boolean(expectedFlags[key])) {
      differences.push({ field: `artifacts.${key}`, expected: expectedFlags[key], actual: Boolean(actualFlags[key]) });
    }
  }
  const status = cleanInline(record.status).toLowerCase();
  const phase = cleanInline(record.phase).toLowerCase();
  const event = latestTerminalEvent(root, runId);
  if (TERMINAL_STATUSES.has(status)) {
    if (!event) {
      differences.push({ field: "latestTerminalEvent", expected: "exists", actual: "missing" });
    } else {
      const eventStatus = cleanInline(event.status).toLowerCase();
      const eventPhase = cleanInline(event.phase).toLowerCase();
      if (eventStatus && eventStatus !== status) {
        differences.push({ field: "latestTerminalEvent.status", expected: status, actual: eventStatus });
      }
      if (eventPhase && eventPhase !== phase) {
        differences.push({ field: "latestTerminalEvent.phase", expected: phase, actual: eventPhase });
      }
    }
  }
  return {
    status: differences.length ? "inconsistent" : "ok",
    runId,
    differences,
    artifacts: expectedFlags,
    latestTerminalEventId: event?.eventId || "",
    nextOwner: differences.length ? "Manager" : undefined
  };
}

function render(payload, json = false) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${payload.status || "ok"}\n`);
  if (payload.runId) {
    process.stdout.write(`runId: ${payload.runId}\n`);
  }
  if (Array.isArray(payload.differences) && payload.differences.length) {
    for (const diff of payload.differences) {
      process.stdout.write(`diff: ${diff.field} expected=${JSON.stringify(diff.expected)} actual=${JSON.stringify(diff.actual)}\n`);
    }
  }
  if (payload.counts) {
    process.stdout.write(`counts: ${JSON.stringify(payload.counts)}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = workspaceRoot(args);
  ensureDir(root);
  let payload;
  if (command === "apply-local-writes") {
    payload = applyLocalWrites(root, readInput(args));
  } else if (command === "finalize-run") {
    payload = finalizeRun(root, readInput(args), {
      allowOverwrite: Boolean(args["allow-overwrite"]),
      allowStatusChange: Boolean(args["allow-status-change"])
    });
  } else if (command === "check-run") {
    payload = checkRun(root, args["run-id"]);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
  render(payload, Boolean(args.json));
  if (["partial", "inconsistent", "conflict", "missing"].includes(payload.status)) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  render({ status: "error", error: error.message, nextOwner: "Manager" }, process.argv.includes("--json"));
  process.exitCode = 1;
}
