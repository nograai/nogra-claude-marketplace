import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  TRANSCRIPT_DIAGNOSTIC_SCHEMA_V1,
  assertTranscriptDiagnosticSemantics
} from "./contract-spine.mjs";

const BUSINESS_CLAIM_RE = /\b(revenue|mrr|arr|affiliate|conversion|conv(?:ersion)? rate|cr|indt[ae]gt|tjener|oms[ae]tning|kr\/md|kr\.?\/md|dkk|kroner|users?|brugere|leads?)\b/iu;
const SOURCE_CUE_RE = /\b(observed|observeret|user-provided|bruger-oplyst|inferred|infereret|unknown|ukendt|db|database|query|vercel|stripe|provider|webhook|analytics|event|events|source|kilde|caveat|forbehold|hypotese)\b/iu;
const STOP_LANGUAGE_RE = /\b(stop|one[-\s]?shot|en chance|sidste chance|no agents?|ingen agents?|ikke\s+k[oe]r\s+agents?|do not spawn|don't spawn|dont spawn|uden go)\b/iu;
const TRUTH_LABELS = [
  /\b(observed|observeret)\b/iu,
  /\b(user-provided|bruger-oplyst|brugeroplyst)\b/iu,
  /\b(inferred|infereret)\b/iu,
  /\b(unknown|ukendt)\b/iu
];

function now() {
  return new Date().toISOString();
}

function cleanInline(value, maxLength = 240) {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function transcriptIdFromPath(value) {
  return path.basename(cleanInline(value)).replace(/\.jsonl$/u, "");
}

function safeFilePart(value, fallback = "session") {
  const cleaned = cleanInline(value, 120).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned || fallback;
}

function readJsonIfValid(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeWorkspaceWrite(root, file) {
  const workspace = path.resolve(root);
  const target = path.resolve(file);
  if (!isInside(target, workspace)) {
    throw new Error("transcript diagnostic write target escapes the workspace");
  }
  const workspaceReal = fs.realpathSync.native(workspace);
  let existingParent = path.dirname(target);
  while (!fs.existsSync(existingParent)) {
    const next = path.dirname(existingParent);
    if (next === existingParent) break;
    existingParent = next;
  }
  const parentReal = fs.realpathSync.native(existingParent);
  if (!isInside(parentReal, workspaceReal)) {
    throw new Error("transcript diagnostic write parent resolves outside the workspace");
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter((entry) => entry.line.trim())
    .map((entry) => {
      try {
        return { index: entry.index, value: JSON.parse(entry.line) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function runtimeDir(root) {
  return path.join(root, ".nogra", "runtime");
}

function sessionAnchorPath(root) {
  return path.join(runtimeDir(root), "session-anchor.json");
}

export function transcriptDiagnosticDir(root) {
  return path.join(runtimeDir(root), "diagnostics", "transcript");
}

export function transcriptDiagnosticLatestPath(root) {
  return path.join(runtimeDir(root), "transcript-diagnostic.latest.json");
}

function resolveTranscript(root, options = {}) {
  const explicit = cleanInline(options.transcriptPath || options.transcript || "");
  if (explicit) {
    return {
      path: path.resolve(explicit),
      source: "explicit-path"
    };
  }
  const anchor = readJsonIfValid(sessionAnchorPath(root)) || {};
  const anchored = cleanInline(anchor.transcriptPath || anchor.transcript_path || "");
  if (anchored) {
    return {
      path: path.resolve(anchored),
      source: "session-anchor"
    };
  }
  return { path: "", source: "none" };
}

function relativeOrAbsolute(root, file) {
  if (!file) return "";
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : resolvedFile;
}

function extractText(value, depth = 0) {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (value.type === "tool_use") return "";
  if (Object.hasOwn(value, "content")) return extractText(value.content, depth + 1);
  if (Object.hasOwn(value, "message")) return extractText(value.message, depth + 1);
  return "";
}

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item && typeof item === "object" && item.type === "tool_use")
    .map((item) => ({
      name: cleanInline(item.name, 80),
      id: cleanInline(item.id, 120),
      description: cleanInline(item.input?.description || item.input?.summary || "", 160)
    }))
    .filter((tool) => tool.name);
}

function normalizeRecord(entry) {
  const value = entry.value || {};
  const message = value.message && typeof value.message === "object" ? value.message : {};
  const role = cleanInline(value.role || message.role || value.type, 40);
  const content = Object.hasOwn(message, "content") ? message.content : value.content;
  const directTool = cleanInline(value.tool_name || value.toolName, 80)
    ? [{
        name: cleanInline(value.tool_name || value.toolName, 80),
        id: cleanInline(value.tool_use_id || value.toolUseId, 120),
        description: cleanInline(value.description || "", 160)
      }]
    : [];
  return {
    line: entry.index,
    role,
    text: cleanInline(extractText(content), 8000),
    tools: [...extractToolUses(content), ...directTool]
  };
}

function compactEvidence(record, cue) {
  return {
    line: record.line,
    role: cleanInline(record.role, 40),
    cue: cleanInline(cue, 120),
    excerpt: cleanInline(record.text, 180)
  };
}

function signal(id, category, observation, evidence, limitations) {
  return { id, category, observation, evidence, limitations };
}

function hasTruthLabels(records) {
  return records.some((record) => TRUTH_LABELS.every((pattern) => pattern.test(record.text || "")));
}

function detectSignals(records) {
  const signals = [];
  const stopRecord = records.find((record) => record.role === "user" && STOP_LANGUAGE_RE.test(record.text));
  const laterToolRecord = stopRecord
    ? records.find((record) => record.line > stopRecord.line && record.tools.length > 0)
    : null;
  if (stopRecord && laterToolRecord) {
    signals.push(signal(
      "stop_language_precedes_tool_use",
      "lexical-cooccurrence",
      "A lexical stop cue appears before a later tool-use record.",
      [
        compactEvidence(stopRecord, "lexical stop cue"),
        compactEvidence(laterToolRecord, "later tool-use record")
      ],
      [
        "This co-occurrence does not determine whether GO existed, was scoped or was later superseded.",
        "Use canonical approval and run receipts for authorization."
      ]
    ));
  }

  const agentRecord = records.find((record) => record.tools.some((tool) => /^(agent|task)$/iu.test(tool.name)));
  if (agentRecord) {
    const tool = agentRecord.tools.find((entry) => /^(agent|task)$/iu.test(entry.name));
    signals.push(signal(
      "agent_tool_use_observed",
      "tool-observation",
      "An Agent or Task tool-use record appears in the transcript.",
      [compactEvidence(agentRecord, `tool=${tool?.name || "Agent"}`)],
      [
        "Tool presence alone does not prove that delegation was required, approved or policy-compliant."
      ]
    ));
  }

  const businessRecord = records.find((record) => {
    return record.role === "assistant" && BUSINESS_CLAIM_RE.test(record.text) && !SOURCE_CUE_RE.test(record.text);
  });
  if (businessRecord) {
    signals.push(signal(
      "business_metric_language_without_source_cue",
      "source-cue",
      "Business-metric language appears without a nearby lexical source cue in the same message.",
      [compactEvidence(businessRecord, "business-metric lexeme without source cue")],
      [
        "A missing lexical cue does not prove that the claim is false or unsupported.",
        "Canonical evidence records, not transcript wording, determine evidence level."
      ]
    ));
  }

  if (signals.length > 0 && !hasTruthLabels(records)) {
    signals.push(signal(
      "truth_labels_absent",
      "source-cue",
      "The transcript does not contain all four optional truth-label lexemes in one message.",
      [],
      [
        "Truth labels are writing aids, not proof and not a required permission surface.",
        "Facts and evidence remain authoritative even when these words are absent."
      ]
    ));
  }
  return signals;
}

function baseControlEffects() {
  return {
    permission: "none",
    go: "not-inferred",
    routing: "unchanged",
    dispatch: "unchanged",
    evidenceLevel: "unchanged",
    factLevel: "unchanged",
    verdict: "none"
  };
}

function finish(value) {
  return assertTranscriptDiagnosticSemantics({
    schema: TRANSCRIPT_DIAGNOSTIC_SCHEMA_V1,
    generatedAt: now(),
    mode: "explicit-diagnostic",
    authority: "none",
    advisoryOnly: true,
    blocking: false,
    root: "",
    transcript: {
      path: "",
      id: "",
      exists: false,
      lines: 0,
      source: "none"
    },
    sessionId: "",
    signalCount: 0,
    signals: [],
    limitations: [
      "Signals are lexical heuristics, not semantic or authorization judgments.",
      "Canonical contracts, approvals, evidence, facts and verdicts remain authoritative."
    ],
    controlEffects: baseControlEffects(),
    summary: "No transcript was selected.",
    privacy: "Preview mode stores nothing. Saved diagnostics contain compact excerpts, never full transcript bodies.",
    persistence: "preview",
    path: "",
    ...value
  });
}

export function analyzeTranscriptDiagnostic(root, options = {}) {
  const workspaceRoot = path.resolve(root);
  const selected = resolveTranscript(workspaceRoot, options);
  const transcriptId = transcriptIdFromPath(selected.path);
  const anchor = readJsonIfValid(sessionAnchorPath(workspaceRoot)) || {};
  const sessionId = cleanInline(options.sessionId || anchor.sessionId || anchor.session_id || "", 160);
  if (!selected.path || !fs.existsSync(selected.path)) {
    return finish({
      root: workspaceRoot,
      transcript: {
        path: selected.path,
        id: transcriptId,
        exists: false,
        lines: 0,
        source: selected.source
      },
      sessionId,
      summary: "No readable transcript was available for the explicit diagnostic."
    });
  }

  const records = readJsonl(selected.path).map(normalizeRecord);
  const signals = detectSignals(records);
  return finish({
    root: workspaceRoot,
    transcript: {
      path: relativeOrAbsolute(workspaceRoot, selected.path),
      id: transcriptId,
      exists: true,
      lines: records.length,
      source: selected.source
    },
    sessionId,
    signalCount: signals.length,
    signals,
    summary: signals.length
      ? `${signals.length} non-authoritative transcript signal${signals.length === 1 ? "" : "s"} observed.`
      : "No configured lexical transcript signals were observed."
  });
}

export function writeTranscriptDiagnosticReceipt(root, diagnostic) {
  const validated = assertTranscriptDiagnosticSemantics(diagnostic);
  if (!validated.transcript.exists) return validated;
  const directory = transcriptDiagnosticDir(root);
  const stamp = validated.generatedAt.replace(/\D/gu, "").slice(0, 17);
  const id = safeFilePart(validated.transcript.id || validated.sessionId || "session");
  const contentId = crypto.createHash("sha256").update(JSON.stringify(validated)).digest("hex").slice(0, 16);
  const file = path.join(directory, `${stamp}-${id}-${contentId}.json`);
  const latest = transcriptDiagnosticLatestPath(root);
  assertSafeWorkspaceWrite(root, file);
  assertSafeWorkspaceWrite(root, latest);
  const payload = assertTranscriptDiagnosticSemantics({
    ...validated,
    persistence: "saved",
    path: relativeOrAbsolute(root, file)
  });
  writeJsonAtomic(file, payload);
  writeJsonAtomic(latest, payload);
  return payload;
}
