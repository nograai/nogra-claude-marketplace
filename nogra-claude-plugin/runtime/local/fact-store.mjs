import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_SCHEMA_V1,
  FACT_SCHEMA_V1,
  assertEvidenceSemantics,
  assertFactSemantics,
  assertVerdictSemantics,
  evidenceContentHash,
  factContentHash,
  factKey,
  readJsonIfValid,
  readRunRecord
} from "./contract-spine.mjs";

const EVIDENCE_LEVEL_RANK = new Map([
  ["reported", 0],
  ["edited", 1],
  ["tested", 2],
  ["verified", 3]
]);

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
}

function cleanText(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").trim();
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanInline).filter(Boolean))];
}

function now() {
  return new Date().toISOString();
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

function appendDurableLine(file, value) {
  ensureDir(path.dirname(file));
  const handle = fs.openSync(file, "a");
  try {
    fs.writeSync(handle, `${JSON.stringify(value)}\n`, null, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function readWorkspaceConfig(root) {
  const file = path.join(root, ".nogra", "config.json");
  const config = readJsonIfValid(file);
  if (!config || typeof config !== "object") {
    throw new Error("fact/evidence operations require a valid .nogra/config.json");
  }
  return config;
}

function workspaceId(root) {
  const value = cleanInline(readWorkspaceConfig(root).workspaceId);
  if (!value) throw new Error("fact/evidence operations require config.workspaceId");
  return value;
}

function ledgerFile(root) {
  return path.join(root, ".nogra", "ledger", "events.jsonl");
}

function currentFactsFile(root) {
  const config = readWorkspaceConfig(root);
  const configured = cleanInline(config?.paths?.currentFacts) || ".nogra/state/CURRENT-FACTS.json";
  return resolveWorkspacePath(root, configured, { mustExist: false });
}

function sessionAnchor(root) {
  const value = readJsonIfValid(path.join(root, ".nogra", "runtime", "session-anchor.json"));
  return {
    sessionId: cleanInline(value?.sessionId),
    transcriptId: cleanInline(value?.transcriptId) || path.basename(cleanInline(value?.transcriptPath)).replace(/\.jsonl$/u, "")
  };
}

function parseLedger(root) {
  const file = ledgerFile(root);
  if (!fs.existsSync(file)) return [];
  const out = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    try {
      out.push(JSON.parse(lines[index]));
    } catch {
      throw new Error(`ledger contains invalid JSON at line ${index + 1}; fact writes are blocked`);
    }
  }
  return out;
}

function ledgerWatermark(root) {
  return parseLedger(root).length;
}

function safeRelativePath(value) {
  const raw = cleanInline(value).replaceAll("\\", "/");
  if (!raw || raw.startsWith("/") || raw.startsWith("~") || raw.includes("\0")) {
    throw new Error(`artifact ref must be a workspace-relative path: ${raw || "(empty)"}`);
  }
  const parts = raw.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error(`artifact ref escapes the workspace: ${raw}`);
  }
  return parts.join("/");
}

function nearestExistingParent(file) {
  let current = path.dirname(file);
  while (!fs.existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function resolveWorkspacePath(root, value, options = {}) {
  const relative = safeRelativePath(value);
  const rootReal = fs.realpathSync(root);
  const target = path.resolve(rootReal, relative);
  if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`path escapes the workspace: ${relative}`);
  }
  const parentReal = fs.realpathSync(nearestExistingParent(target));
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`path parent resolves outside the workspace: ${relative}`);
  }
  if (options.mustExist !== false) {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`artifact ref does not resolve to a file: ${relative}`);
    }
    const targetReal = fs.realpathSync(target);
    if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
      throw new Error(`artifact ref resolves outside the workspace: ${relative}`);
    }
  }
  return target;
}

function fileDigest(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function evidencePath(root, evidenceId) {
  if (!/^evidence-[a-f0-9]{20}$/u.test(cleanInline(evidenceId))) {
    throw new Error(`invalid evidence id: ${cleanInline(evidenceId) || "(empty)"}`);
  }
  return path.join(root, ".nogra", "evidence", `${evidenceId}.json`);
}

function verdictPath(root, verdictId) {
  const safe = cleanInline(verdictId);
  if (!/^verdict-[A-Za-z0-9_.-]+$/u.test(safe)) {
    throw new Error(`invalid verdict id: ${safe || "(empty)"}`);
  }
  return path.join(root, ".nogra", "receipts", "verdicts", `${safe}.json`);
}

export function readEvidenceRecord(root, evidenceId) {
  const record = readJsonIfValid(evidencePath(root, evidenceId));
  if (!record) throw new Error(`evidence record not found: ${evidenceId}`);
  assertEvidenceSemantics(record);
  if (record.workspaceId !== workspaceId(root)) {
    throw new Error(`evidence belongs to another workspace: ${evidenceId}`);
  }
  for (const artifact of record.artifacts) {
    const file = resolveWorkspacePath(root, artifact.ref);
    const currentDigest = fileDigest(file);
    if (currentDigest !== artifact.sha256) {
      throw new Error(`evidence artifact integrity mismatch: ${artifact.ref}`);
    }
  }
  for (const verdictId of record.verdictIds) {
    const verdict = readVerdictRecord(root, verdictId);
    if (record.evidenceLevel === "verified" && verdict.verdict !== "ship") {
      throw new Error(`verified evidence requires a ship verdict: ${verdictId}`);
    }
  }
  return record;
}

function readVerdictRecord(root, verdictId) {
  const record = readJsonIfValid(verdictPath(root, verdictId));
  if (!record) throw new Error(`verdict record not found: ${verdictId}`);
  assertVerdictSemantics(record);
  if (record.workspaceId !== workspaceId(root)) {
    throw new Error(`verdict belongs to another workspace: ${verdictId}`);
  }
  return record;
}

function validateRunAndBriefRefs(root, record) {
  if (record.runId) {
    const run = readRunRecord(root, record.runId);
    if (!run) throw new Error(`evidence run not found: ${record.runId}`);
    if (run.workspaceId && run.workspaceId !== record.workspaceId) {
      throw new Error(`evidence run belongs to another workspace: ${record.runId}`);
    }
  }
  if (record.briefId) {
    const file = path.join(root, ".nogra", "briefs", "drafts", `${record.briefId}.json`);
    const brief = readJsonIfValid(file);
    if (!brief) throw new Error(`evidence brief not found: ${record.briefId}`);
    if (brief.workspaceId !== record.workspaceId) {
      throw new Error(`evidence brief belongs to another workspace: ${record.briefId}`);
    }
  }
}

function normalizeArtifacts(root, input) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set();
  return values.map((value) => {
    const raw = typeof value === "string" ? { ref: value } : value;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("evidence artifacts must be paths or structured objects");
    }
    const ref = safeRelativePath(raw.ref);
    if (seen.has(ref)) throw new Error(`duplicate evidence artifact ref: ${ref}`);
    seen.add(ref);
    const file = resolveWorkspacePath(root, ref);
    return {
      ref,
      sha256: fileDigest(file),
      mediaType: cleanInline(raw.mediaType) || "application/octet-stream"
    };
  });
}

function withLedgerLock(root, operation) {
  const lock = path.join(root, ".nogra", "runtime", "fact-ledger.lock");
  ensureDir(path.dirname(lock));
  let handle;
  const acquire = (allowRecovery = true) => {
    try {
      handle = fs.openSync(lock, "wx");
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: now() }));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readJsonIfValid(lock);
      const age = Date.now() - Date.parse(existing?.createdAt || "");
      let alive = false;
      try {
        if (Number.isInteger(existing?.pid) && existing.pid > 0) {
          process.kill(existing.pid, 0);
          alive = true;
        }
      } catch {}
      if (allowRecovery && Number.isFinite(age) && age > 30_000 && !alive) {
        fs.unlinkSync(lock);
        return acquire(false);
      }
      throw new Error("another fact/evidence ledger operation is active; retry after it finishes");
    }
  };
  acquire();
  try {
    return operation();
  } finally {
    try { fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

function evidenceLedgerEvent(root, evidence, watermark) {
  const session = sessionAnchor(root);
  const at = now();
  return {
    schema: "nogra.ledger.event.v1",
    eventId: `ledger-event-${evidence.evidenceId}-recorded`,
    ledgerWatermark: watermark,
    generatedAt: at,
    createdAt: at,
    workspaceId: evidence.workspaceId,
    sessionId: session.sessionId,
    transcriptId: session.transcriptId,
    type: "evidence_recorded",
    evidenceId: evidence.evidenceId,
    evidenceLevel: evidence.evidenceLevel,
    subject: evidence.subject,
    contentHash: evidence.contentHash,
    runId: evidence.runId,
    briefId: evidence.briefId
  };
}

export function saveEvidenceRecord(root, input) {
  return withLedgerLock(root, () => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("evidence input must be a structured JSON object");
    }
    const producer = input.producer && typeof input.producer === "object" ? input.producer : {};
    const method = input.method && typeof input.method === "object" ? input.method : {};
    const result = input.result && typeof input.result === "object" ? input.result : {};
    const candidate = {
      schema: EVIDENCE_SCHEMA_V1,
      workspaceId: workspaceId(root),
      subject: cleanInline(input.subject),
      summary: cleanText(input.summary),
      evidenceLevel: cleanInline(input.evidenceLevel),
      producer: { type: cleanInline(producer.type), ref: cleanInline(producer.ref) },
      method: {
        type: cleanInline(method.type),
        description: cleanText(method.description),
        command: method.command == null ? null : cleanText(method.command)
      },
      result: {
        status: cleanInline(result.status),
        exitCode: result.exitCode == null ? null : Number(result.exitCode)
      },
      artifacts: normalizeArtifacts(root, input.artifacts),
      sourceRefs: uniqueStrings(input.sourceRefs),
      verdictIds: uniqueStrings(input.verdictIds),
      runId: input.runId ? cleanInline(input.runId) : null,
      briefId: input.briefId ? cleanInline(input.briefId) : null,
      redactions: uniqueStrings(input.redactions),
      metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}
    };
    candidate.contentHash = evidenceContentHash(candidate);
    candidate.evidenceId = `evidence-${candidate.contentHash.slice("sha256:".length, "sha256:".length + 20)}`;
    let evidence = {
      schema: candidate.schema,
      evidenceId: candidate.evidenceId,
      workspaceId: candidate.workspaceId,
      createdAt: cleanInline(input.createdAt) || now(),
      subject: candidate.subject,
      summary: candidate.summary,
      evidenceLevel: candidate.evidenceLevel,
      producer: candidate.producer,
      method: candidate.method,
      result: candidate.result,
      artifacts: candidate.artifacts,
      sourceRefs: candidate.sourceRefs,
      verdictIds: candidate.verdictIds,
      runId: candidate.runId,
      briefId: candidate.briefId,
      contentHash: candidate.contentHash,
      redactions: candidate.redactions,
      metadata: candidate.metadata
    };
    assertEvidenceSemantics(evidence);
    validateRunAndBriefRefs(root, evidence);
    for (const verdictId of evidence.verdictIds) {
      const verdict = readVerdictRecord(root, verdictId);
      if (evidence.evidenceLevel === "verified" && verdict.verdict !== "ship") {
        throw new Error(`verified evidence requires a ship verdict: ${verdictId}`);
      }
    }
    const file = evidencePath(root, evidence.evidenceId);
    const existing = readJsonIfValid(file);
    if (existing) {
      assertEvidenceSemantics(existing);
      if (existing.contentHash !== evidence.contentHash) {
        throw new Error(`immutable evidence id collision: ${evidence.evidenceId}`);
      }
      evidence = existing;
    } else {
      atomicWrite(file, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    const events = parseLedger(root);
    let event = events.find((item) => item?.eventId === `ledger-event-${evidence.evidenceId}-recorded`);
    let recovered = false;
    if (!event) {
      event = evidenceLedgerEvent(root, evidence, events.length + 1);
      appendDurableLine(ledgerFile(root), event);
      recovered = Boolean(existing);
    }
    return {
      status: "ok",
      idempotent: Boolean(existing && !recovered),
      recovered,
      evidence,
      path: path.relative(root, file).replaceAll(path.sep, "/"),
      ledgerWatermark: event.ledgerWatermark,
      nextOwner: "Manager"
    };
  });
}

export function readFactRecords(root) {
  const facts = parseLedger(root)
    .filter((item) => item?.schema === FACT_SCHEMA_V1)
    .map((item) => {
      assertFactSemantics(item);
      return item;
    });
  for (let index = 0; index < facts.length; index += 1) {
    assertFactSupport(root, facts[index], facts.slice(0, index));
  }
  return facts;
}

function factProjection(root, facts = readFactRecords(root)) {
  const supersededIds = new Set(facts.map((fact) => fact.supersedes).filter(Boolean));
  const activeFacts = facts.filter((fact) => !supersededIds.has(fact.factId));
  const projection = {
    schema: "nogra.fact.projection.v1",
    workspaceId: workspaceId(root),
    generatedAt: now(),
    sourceWatermark: facts.at(-1)?.ledgerWatermark || 0,
    scannedLedgerWatermark: ledgerWatermark(root),
    authority: ".nogra/ledger/events.jsonl",
    memoryAuthority: "advisory_projection_only",
    activeFacts,
    supersededFacts: facts.filter((fact) => supersededIds.has(fact.factId)),
    counts: {
      active: activeFacts.length,
      superseded: supersededIds.size,
      total: facts.length
    }
  };
  return projection;
}

export function rebuildFactProjection(root) {
  const projection = factProjection(root);
  const file = currentFactsFile(root);
  atomicWrite(file, `${JSON.stringify(projection, null, 2)}\n`);
  return { projection, path: path.relative(root, file).replaceAll(path.sep, "/") };
}

function assertFactSupport(root, candidate, facts) {
  const evidence = candidate.evidenceIds.map((id) => readEvidenceRecord(root, id));
  const verdicts = candidate.verdictIds.map((id) => readVerdictRecord(root, id));
  const rank = EVIDENCE_LEVEL_RANK.get(candidate.evidenceLevel);
  if (rank > 0 && !evidence.length && !verdicts.length) {
    throw new Error(`${candidate.evidenceLevel} fact requires canonical evidence or verdict references`);
  }
  if (candidate.evidenceLevel === "edited" && !evidence.some((item) => EVIDENCE_LEVEL_RANK.get(item.evidenceLevel) >= 1)) {
    throw new Error("edited fact requires edited-or-stronger evidence");
  }
  if (candidate.evidenceLevel === "tested" && !evidence.some((item) => EVIDENCE_LEVEL_RANK.get(item.evidenceLevel) >= 2)) {
    throw new Error("tested fact requires tested-or-stronger evidence");
  }
  if (candidate.evidenceLevel === "verified") {
    const operatorEvidence = candidate.source.type === "operator_record"
      && evidence.some((item) => item.evidenceLevel === "verified"
        && item.producer.type === "operator"
        && candidate.source.ref === item.evidenceId);
    const shipVerdict = candidate.source.type === "verifier_report"
      && candidate.evidenceIds.length > 0
      && verdicts.some((item) => item.verdict === "ship"
        && candidate.source.ref === item.verdictId
        && candidate.evidenceIds.every((id) => item.evidenceIds.includes(id)));
    if (!operatorEvidence && !shipVerdict) {
      throw new Error("verified fact requires verified operator evidence or a canonical ship verdict");
    }
  }
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));
  const supersededIds = new Set(facts.map((fact) => fact.supersedes).filter(Boolean));
  const active = facts.find((fact) => fact.factKey === candidate.factKey && !supersededIds.has(fact.factId));
  if (active && candidate.supersedes !== active.factId) {
    throw new Error(`subject already has active fact ${active.factId}; explicit supersedes is required`);
  }
  if (!active && candidate.supersedes) {
    const previous = byId.get(candidate.supersedes);
    if (!previous) throw new Error(`superseded fact not found: ${candidate.supersedes}`);
    if (previous.factKey !== candidate.factKey) {
      throw new Error("a fact may only supersede the same stable subject");
    }
    if (supersededIds.has(previous.factId)) {
      throw new Error(`superseded fact is not active: ${previous.factId}`);
    }
  }
  if (active && EVIDENCE_LEVEL_RANK.get(candidate.evidenceLevel) < EVIDENCE_LEVEL_RANK.get(active.evidenceLevel)) {
    throw new Error(`evidence level cannot regress when superseding ${active.factId}`);
  }
}

export function recordFact(root, input) {
  return withLedgerLock(root, () => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("fact input must be a structured JSON object");
    }
    const source = input.source && typeof input.source === "object" ? input.source : {};
    const subject = cleanInline(input.subject);
    const observedAt = cleanInline(input.observedAt);
    const session = sessionAnchor(root);
    const semantic = {
      schema: FACT_SCHEMA_V1,
      workspaceId: workspaceId(root),
      factKey: factKey(workspaceId(root), subject),
      subject,
      claim: cleanText(input.claim),
      source: { type: cleanInline(source.type), ref: cleanInline(source.ref) },
      evidenceLevel: cleanInline(input.evidenceLevel),
      observedAt,
      supersedes: input.supersedes ? cleanInline(input.supersedes) : null,
      evidenceIds: uniqueStrings(input.evidenceIds),
      verdictIds: uniqueStrings(input.verdictIds),
      redactions: uniqueStrings(input.redactions),
      metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}
    };
    semantic.contentHash = factContentHash(semantic);
    semantic.factId = `fact-${semantic.contentHash.slice("sha256:".length, "sha256:".length + 20)}`;
    const facts = readFactRecords(root);
    const existing = facts.find((fact) => fact.factId === semantic.factId);
    if (existing) {
      if (existing.contentHash !== semantic.contentHash) {
        throw new Error(`immutable fact id collision: ${semantic.factId}`);
      }
      const rebuilt = rebuildFactProjection(root);
      return {
        status: "ok",
        idempotent: true,
        fact: existing,
        projectionPath: rebuilt.path,
        ledgerWatermark: existing.ledgerWatermark,
        nextOwner: "Manager"
      };
    }
    const recordedAt = now();
    const fact = {
      schema: semantic.schema,
      factId: semantic.factId,
      factKey: semantic.factKey,
      workspaceId: semantic.workspaceId,
      subject: semantic.subject,
      claim: semantic.claim,
      source: semantic.source,
      evidenceLevel: semantic.evidenceLevel,
      observedAt: semantic.observedAt,
      recordedAt,
      supersedes: semantic.supersedes,
      evidenceIds: semantic.evidenceIds,
      verdictIds: semantic.verdictIds,
      contentHash: semantic.contentHash,
      ledgerWatermark: ledgerWatermark(root) + 1,
      sessionId: session.sessionId,
      transcriptId: session.transcriptId,
      redactions: semantic.redactions,
      metadata: semantic.metadata
    };
    assertFactSemantics(fact);
    if (Date.parse(fact.observedAt) > Date.parse(fact.recordedAt)) {
      throw new Error("fact observedAt cannot be later than recordedAt");
    }
    assertFactSupport(root, fact, facts);
    appendDurableLine(ledgerFile(root), fact);
    const rebuilt = rebuildFactProjection(root);
    return {
      status: "ok",
      idempotent: false,
      fact,
      projectionPath: rebuilt.path,
      ledgerWatermark: fact.ledgerWatermark,
      nextOwner: "Manager"
    };
  });
}

export function factStatus(root) {
  const file = currentFactsFile(root);
  const facts = readFactRecords(root);
  const projection = factProjection(root, facts);
  const current = readJsonIfValid(file);
  const freshness = !current
    ? "missing"
    : current.sourceWatermark === projection.sourceWatermark
      ? "fresh"
      : "stale";
  return {
    status: "ok",
    freshness,
    projection,
    projectionPath: path.relative(root, file).replaceAll(path.sep, "/"),
    nextOwner: "Manager"
  };
}
