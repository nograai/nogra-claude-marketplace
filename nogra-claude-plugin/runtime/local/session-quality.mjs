import fs from "node:fs";
import path from "node:path";

const SCHEMA = "nogra.sessionQualityReceipt.v1";
const SEVERITY_ORDER = {
  info: 0,
  warning: 1,
  intervention: 2,
  "hard-stop": 3
};

const BUSINESS_CLAIM_RE = /\b(revenue|mrr|arr|affiliate|conversion|conv(?:ersion)? rate|cr|indt[ae]gt|tjener|oms[ae]tning|kr\/md|kr\.?\/md|dkk|kroner|users?|brugere|leads?)\b/iu;
const EVIDENCE_WORD_RE = /\b(observed|observeret|user-provided|bruger-oplyst|inferred|infereret|unknown|ukendt|db|database|query|vercel|stripe|provider|webhook|analytics|event|events|source|kilde|caveat|forbehold|hypotese)\b/iu;
const STOP_BOUNDARY_RE = /\b(stop|one[-\s]?shot|en chance|sidste chance|no agents?|ingen agents?|ikke\s+k[oe]r\s+agents?|do not spawn|don't spawn|dont spawn|uden go)\b/iu;
const RESUME_BOUNDARY_RE = /\b(go|approved|godkendt|forts[ae]t|k[oe]r|koer|run it|continue|proceed)\b/iu;
const TRUTH_LEDGER_RE = /\b(observed|observeret)\b/iu;
const USER_PROVIDED_RE = /\b(user-provided|bruger-oplyst|brugeroplyst)\b/iu;
const INFERRED_RE = /\b(inferred|infereret)\b/iu;
const UNKNOWN_RE = /\b(unknown|ukendt)\b/iu;

function now() {
  return new Date().toISOString();
}

function cleanInline(value, maxLength = 240) {
  const cleaned = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function transcriptIdFromPath(value) {
  return path.basename(cleanInline(value)).replace(/\.jsonl$/u, "");
}

function safeFilePart(value, fallback = "session") {
  const cleaned = cleanInline(value, 120).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
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
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
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

export function sessionQualityDir(root) {
  return path.join(runtimeDir(root), "quality");
}

export function sessionQualityLatestPath(root) {
  return path.join(runtimeDir(root), "session-quality.latest.json");
}

function sessionAnchorPath(root) {
  return path.join(runtimeDir(root), "session-anchor.json");
}

function liveHooksPath(root) {
  return path.join(runtimeDir(root), "live-hooks.jsonl");
}

function resolveTranscriptPath(root, options = {}) {
  const explicit = cleanInline(options.transcriptPath || options.transcript || "");
  if (explicit) return path.resolve(explicit);
  const anchor = readJsonIfValid(sessionAnchorPath(root)) || {};
  const anchored = cleanInline(anchor.transcriptPath || anchor.transcript_path || "");
  return anchored ? path.resolve(anchored) : "";
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

function extractToolUsesFromContent(content) {
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
  const tools = [
    ...extractToolUsesFromContent(content),
    cleanInline(value.tool_name || value.toolName, 80) ? {
      name: cleanInline(value.tool_name || value.toolName, 80),
      id: cleanInline(value.tool_use_id || value.toolUseId, 120),
      description: cleanInline(value.description || "", 160)
    } : null
  ].filter(Boolean);
  return {
    line: entry.index,
    role,
    text: cleanInline(extractText(content), 8000),
    tools
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

function pattern(id, severity, fixability, evidence, recommendedAction) {
  return {
    id,
    severity,
    fixability,
    evidence,
    recommendedAction
  };
}

function hasTruthLedger(records) {
  return records.some((record) => {
    const text = record.text || "";
    return TRUTH_LEDGER_RE.test(text) && USER_PROVIDED_RE.test(text) && INFERRED_RE.test(text) && UNKNOWN_RE.test(text);
  });
}

function detectPatterns(records) {
  const patterns = [];
  const stopBoundaries = records.filter((record) => record.role === "user" && STOP_BOUNDARY_RE.test(record.text));
  const isClearedByResume = (boundary, record) => records.some((candidate) => {
    return candidate.role === "user" &&
      candidate.line > boundary.line &&
      candidate.line < record.line &&
      RESUME_BOUNDARY_RE.test(candidate.text);
  });
  const stopWindows = stopBoundaries.map((boundary) => ({
    boundary,
    upperLine: Infinity,
    toolUses: records.filter((record) => {
      return record.line > boundary.line &&
        record.tools.length &&
        !isClearedByResume(boundary, record);
    })
  }));
  const stopWindowWithTools = stopWindows.find((window) => window.toolUses.length);
  const stopBoundary = stopWindowWithTools?.boundary || stopBoundaries[stopBoundaries.length - 1] || null;
  const toolUsesAfterStop = stopWindowWithTools?.toolUses || [];
  const agentUses = records.flatMap((record) => record.tools
    .filter((tool) => /^(agent|task)$/iu.test(tool.name))
    .map((tool) => ({ record, tool })));
  const agentUsesAfterStop = agentUses.filter(({ record }) => {
    return stopWindows.some((window) => record.line > window.boundary.line && !isClearedByResume(window.boundary, record));
  });

  if (toolUsesAfterStop.length) {
    patterns.push(pattern(
      "stop_boundary_followed_by_tools",
      "intervention",
      "ask-human",
      [
        compactEvidence(stopBoundary, "user stop or one-shot boundary"),
        compactEvidence(toolUsesAfterStop[0], "tool use after boundary")
      ],
      "Pause the run and ask the human to restate GO before further tool work."
    ));
  }

  if (agentUses.length) {
    patterns.push(pattern(
      agentUsesAfterStop.length ? "agent_spawn_after_stop_boundary" : "agent_spawn_observed",
      agentUsesAfterStop.length ? "intervention" : "warning",
      agentUsesAfterStop.length ? "ask-human" : "nudge",
      [
        compactEvidence(agentUsesAfterStop[0]?.record || agentUses[0].record, `tool=${agentUsesAfterStop[0]?.tool.name || agentUses[0].tool.name}`)
      ],
      agentUsesAfterStop.length
        ? "Require explicit GO for agent spawning and return to direct control."
        : "Record why an agent was needed and confirm it was inside the approved route."
    ));
  }

  const businessClaims = records
    .filter((record) => record.role === "assistant" && BUSINESS_CLAIM_RE.test(record.text) && !EVIDENCE_WORD_RE.test(record.text));
  if (businessClaims.length) {
    patterns.push(pattern(
      "business_claim_without_source_marker",
      "warning",
      "nudge",
      [compactEvidence(businessClaims[0], "business metric or revenue claim without source marker")],
      "Downgrade the claim to inferred or require DB, provider, Vercel or analytics evidence."
    ));
  }

  if (patterns.some((entry) => ["warning", "intervention", "hard-stop"].includes(entry.severity)) && !hasTruthLedger(records)) {
    patterns.push(pattern(
      "truth_ledger_missing_for_risky_session",
      "warning",
      "auto-fix",
      [],
      "Next response should split facts into Observed, User-provided, Inferred and Unknown."
    ));
  }

  return patterns;
}

function maxSeverity(patterns) {
  return patterns.reduce((current, entry) => {
    return SEVERITY_ORDER[entry.severity] > SEVERITY_ORDER[current] ? entry.severity : current;
  }, "info");
}

function statusFromSeverity(severity, missing = false) {
  if (missing) return "missing-transcript";
  if (severity === "hard-stop") return "hard-stop";
  if (severity === "intervention") return "intervention";
  if (severity === "warning") return "watch";
  return "ok";
}

function scoreFromPatterns(patterns) {
  const penalty = patterns.reduce((total, entry) => {
    if (entry.severity === "hard-stop") return total + 4;
    if (entry.severity === "intervention") return total + 2;
    if (entry.severity === "warning") return total + 1;
    return total;
  }, 0);
  return Math.max(0, 7 - penalty);
}

function liveHookSummary(root, sessionId, transcriptId) {
  const entries = readJsonl(liveHooksPath(root)).map((entry) => entry.value);
  const matching = entries.filter((entry) => {
    const sameSession = sessionId && cleanInline(entry.sessionId, 160) === sessionId;
    const sameTranscript = transcriptId && cleanInline(entry.transcriptId, 160) === transcriptId;
    return sameSession || sameTranscript;
  });
  const source = matching.length ? matching : entries;
  const latest = source[source.length - 1] || {};
  return {
    events: source.length,
    matched: matching.length,
    latestEvent: cleanInline(latest.eventName, 80),
    latestAt: cleanInline(latest.timestamp, 80)
  };
}

export function analyzeSessionQuality(root, options = {}) {
  const transcriptPath = resolveTranscriptPath(root, options);
  const generatedAt = now();
  const transcriptId = transcriptIdFromPath(transcriptPath);
  const anchor = readJsonIfValid(sessionAnchorPath(root)) || {};
  const sessionId = cleanInline(options.sessionId || anchor.sessionId || anchor.session_id || "", 160);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return {
      schema: SCHEMA,
      generatedAt,
      status: statusFromSeverity("info", true),
      score: null,
      maxSeverity: "info",
      blocking: false,
      root: path.resolve(root),
      transcript: {
        path: transcriptPath,
        id: transcriptId,
        exists: false,
        lines: 0
      },
      sessionId,
      patterns: [],
      remedies: [],
      nextGuard: "No transcript was available for quality analysis.",
      privacy: "Receipt stores compact pattern evidence only, not full transcript bodies."
    };
  }

  const records = readJsonl(transcriptPath).map(normalizeRecord);
  const patterns = detectPatterns(records);
  const severity = maxSeverity(patterns);
  const remedies = [...new Set(patterns.map((entry) => entry.recommendedAction).filter(Boolean))];
  const status = statusFromSeverity(severity);
  return {
    schema: SCHEMA,
    generatedAt,
    status,
    score: scoreFromPatterns(patterns),
    maxSeverity: severity,
    blocking: false,
    root: path.resolve(root),
    transcript: {
      path: relativeOrAbsolute(root, transcriptPath),
      id: transcriptId,
      exists: true,
      lines: records.length
    },
    sessionId,
    liveHooks: liveHookSummary(root, sessionId, transcriptId),
    patternCount: patterns.length,
    patterns,
    remedies,
    nextGuard: remedies[0] || "No quality drift pattern detected.",
    remedyPolicy: {
      mode: "advisory",
      blocking: false,
      autoFixablePatterns: patterns.filter((entry) => entry.fixability === "auto-fix").map((entry) => entry.id),
      humanGatePatterns: patterns.filter((entry) => entry.fixability === "ask-human").map((entry) => entry.id)
    },
    privacy: "Receipt stores compact pattern evidence only, not full transcript bodies."
  };
}

export function writeSessionQualityReceipt(root, receipt) {
  if (!receipt || receipt.status === "missing-transcript") return receipt;
  const dir = sessionQualityDir(root);
  const stamp = receipt.generatedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  const id = safeFilePart(receipt.transcript?.id || receipt.sessionId || "session");
  const file = path.join(dir, `${stamp}-${id}.json`);
  const payload = {
    ...receipt,
    path: relativeOrAbsolute(root, file)
  };
  writeJsonAtomic(file, payload);
  writeJsonAtomic(sessionQualityLatestPath(root), payload);
  return payload;
}

export function captureSessionQualityReceipt(root, input = {}) {
  try {
    const receipt = analyzeSessionQuality(root, {
      transcriptPath: input.transcript_path || input.transcriptPath,
      sessionId: input.session_id || input.sessionId
    });
    return writeSessionQualityReceipt(root, receipt);
  } catch {
    return null;
  }
}
