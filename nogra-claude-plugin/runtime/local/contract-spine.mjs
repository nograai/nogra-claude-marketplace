import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonSchema, readJsonSchema, validateJsonSchema } from "./json-schema.mjs";

export const BRIEF_SCHEMA_V1 = "nogra.brief.v1";
export const APPROVAL_SCHEMA_V1 = "nogra.approval.v1";
export const ANCHOR_SCHEMA_V1 = "nogra.anchor.v1";
export const EVIDENCE_SCHEMA_V1 = "nogra.evidence.v1";
export const FACT_SCHEMA_V1 = "nogra.fact.v1";
export const ROLE_LEASE_SCHEMA_V1 = "nogra.role.lease.v1";
export const ROLE_REPORT_SCHEMA_V1 = "nogra.role.report.v1";
export const BOOT_CONTEXT_SCHEMA_V2 = "nogra.boot.context.v2";
export const MEMORY_RESOLUTION_SCHEMA_V1 = "nogra.memory.resolution.v1";
export const TRANSCRIPT_DIAGNOSTIC_SCHEMA_V1 = "nogra.transcript.diagnostic.v1";
export const DISPATCH_RECEIPT_SCHEMA_V2 = "nogra.dispatch.receipt.v2";
export const RUN_SCHEMA_V2 = "nogra.run.v2";
export const RUN_EVENT_SCHEMA_V2 = "nogra.run.event.v2";
export const VERDICT_SCHEMA_V1 = "nogra.verdict.v1";

export const RUN_LIFECYCLES = new Set([
  "queued",
  "running",
  "returning",
  "returned",
  "verified",
  "accepted",
  "cancelled",
  "archived"
]);

export const RUN_OUTCOMES = new Set(["ok", "partial", "blocked", "failed", "cancelled"]);
export const RUN_VERDICTS = new Set(["ship", "deviation", "blocked", "decision_required", "unverified"]);

const RUN_TRANSITIONS = new Map([
  ["queued", new Set(["running", "returning", "returned", "cancelled"])],
  ["running", new Set(["returning", "returned", "cancelled"])],
  ["returning", new Set(["returned", "cancelled"])],
  ["returned", new Set(["verified", "accepted", "archived"])],
  ["verified", new Set(["accepted", "archived"])],
  ["accepted", new Set(["archived"])],
  ["cancelled", new Set(["archived"])],
  ["archived", new Set()]
]);

const RUN_EVENT_LIFECYCLE = new Map([
  ["run_queued", "queued"],
  ["run_started", "running"],
  ["run_returning", "returning"],
  ["run_returned", "returned"],
  ["run_verified", "verified"],
  ["run_accepted", "accepted"],
  ["run_cancelled", "cancelled"],
  ["run_archived", "archived"]
]);

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..", "..");
const contractsRoot = path.join(pluginRoot, "contracts", "schemas");
const schemaCache = new Map();

const CONTRACT_FILES = new Map([
  [BRIEF_SCHEMA_V1, "brief-v1.schema.json"],
  [APPROVAL_SCHEMA_V1, "approval-v1.schema.json"],
  [ANCHOR_SCHEMA_V1, "anchor-v1.schema.json"],
  [EVIDENCE_SCHEMA_V1, "evidence-v1.schema.json"],
  [FACT_SCHEMA_V1, "fact-v1.schema.json"],
  [ROLE_LEASE_SCHEMA_V1, "role-lease-v1.schema.json"],
  [ROLE_REPORT_SCHEMA_V1, "role-report-v1.schema.json"],
  [BOOT_CONTEXT_SCHEMA_V2, "boot-context-v2.schema.json"],
  [MEMORY_RESOLUTION_SCHEMA_V1, "memory-resolution-v1.schema.json"],
  [TRANSCRIPT_DIAGNOSTIC_SCHEMA_V1, "transcript-diagnostic-v1.schema.json"],
  [DISPATCH_RECEIPT_SCHEMA_V2, "dispatch-receipt-v2.schema.json"],
  [RUN_SCHEMA_V2, "run-v2.schema.json"],
  [RUN_EVENT_SCHEMA_V2, "run-event-v2.schema.json"],
  [VERDICT_SCHEMA_V1, "verdict-v1.schema.json"]
]);

function schemaFor(schemaName) {
  const file = CONTRACT_FILES.get(schemaName);
  if (!file) throw new Error(`unknown Nogra contract schema: ${schemaName}`);
  if (!schemaCache.has(schemaName)) {
    schemaCache.set(schemaName, readJsonSchema(path.join(contractsRoot, file)));
  }
  return schemaCache.get(schemaName);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function briefAuthorityView(brief) {
  return {
    schema: String(brief?.schema || ""),
    briefId: String(brief?.briefId || ""),
    workspaceId: String(brief?.workspaceId || ""),
    title: String(brief?.title || ""),
    intent: String(brief?.intent || ""),
    contextHandoff: String(brief?.contextHandoff || ""),
    decisions: Array.isArray(brief?.decisions) ? brief.decisions : [],
    rejected: Array.isArray(brief?.rejected) ? brief.rejected : [],
    knownGaps: Array.isArray(brief?.knownGaps) ? brief.knownGaps : [],
    scope: brief?.scope || {},
    successCriteria: Array.isArray(brief?.successCriteria) ? brief.successCriteria : [],
    stopCriteria: Array.isArray(brief?.stopCriteria) ? brief.stopCriteria : [],
    maxOutput: brief?.maxOutput || {},
    evidenceRequired: String(brief?.evidenceRequired || ""),
    targetRole: String(brief?.targetRole || ""),
    targetModel: String(brief?.targetModel || ""),
    executionShape: brief?.executionShape || {},
    handoffRefs: Array.isArray(brief?.handoffRefs) ? brief.handoffRefs : []
  };
}

export function briefAuthorityHash(brief) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(briefAuthorityView(brief))).digest("hex")}`;
}

export function approvalActionHash(brief) {
  const authority = {
    action: "dispatch",
    workspaceId: String(brief?.workspaceId || ""),
    briefId: String(brief?.briefId || ""),
    briefHash: briefAuthorityHash(brief),
    targetRole: String(brief?.targetRole || ""),
    targetModel: String(brief?.targetModel || ""),
    singleUse: true
  };
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(authority)).digest("hex")}`;
}

export function anchorContentView(anchor) {
  return {
    schema: String(anchor?.schema || ""),
    workspaceId: String(anchor?.workspaceId || ""),
    authority: anchor?.authority || {},
    completion: anchor?.completion || {},
    decisions: Array.isArray(anchor?.decisions) ? anchor.decisions : [],
    blockers: Array.isArray(anchor?.blockers) ? anchor.blockers : [],
    nextOwner: String(anchor?.nextOwner || ""),
    git: anchor?.git || {},
    references: anchor?.references || {},
    native: anchor?.native || {},
    redactions: Array.isArray(anchor?.redactions) ? anchor.redactions : [],
    metadata: anchor?.metadata || {}
  };
}

export function anchorContentHash(anchor) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(anchorContentView(anchor))).digest("hex")}`;
}

function semanticHash(prefix, value) {
  return `${prefix}:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function evidenceContentView(evidence) {
  return {
    schema: String(evidence?.schema || ""),
    workspaceId: String(evidence?.workspaceId || ""),
    subject: String(evidence?.subject || ""),
    summary: String(evidence?.summary || ""),
    evidenceLevel: String(evidence?.evidenceLevel || ""),
    producer: evidence?.producer || {},
    method: evidence?.method || {},
    result: evidence?.result || {},
    artifacts: Array.isArray(evidence?.artifacts) ? evidence.artifacts : [],
    sourceRefs: Array.isArray(evidence?.sourceRefs) ? evidence.sourceRefs : [],
    verdictIds: Array.isArray(evidence?.verdictIds) ? evidence.verdictIds : [],
    runId: evidence?.runId ?? null,
    briefId: evidence?.briefId ?? null,
    redactions: Array.isArray(evidence?.redactions) ? evidence.redactions : [],
    metadata: evidence?.metadata || {}
  };
}

export function evidenceContentHash(evidence) {
  return semanticHash("sha256", evidenceContentView(evidence));
}

export function roleReportContentView(report) {
  return {
    schema: String(report?.schema || ""),
    reportId: String(report?.reportId || ""),
    workspaceId: String(report?.workspaceId || ""),
    runId: String(report?.runId || ""),
    briefId: String(report?.briefId || ""),
    leaseId: String(report?.leaseId || ""),
    role: String(report?.role || ""),
    status: String(report?.status || ""),
    summary: String(report?.summary || ""),
    claims: Array.isArray(report?.claims) ? report.claims : [],
    evidenceIds: Array.isArray(report?.evidenceIds) ? report.evidenceIds : [],
    filesChanged: Array.isArray(report?.filesChanged) ? report.filesChanged : [],
    requestedProbes: Array.isArray(report?.requestedProbes) ? report.requestedProbes : [],
    scopeCheck: report?.scopeCheck || {},
    mutationAttempted: Boolean(report?.mutationAttempted),
    recommendation: String(report?.recommendation || ""),
    reason: String(report?.reason || ""),
    generatedAt: String(report?.generatedAt || ""),
    nextOwner: String(report?.nextOwner || ""),
    redactions: Array.isArray(report?.redactions) ? report.redactions : [],
    metadata: report?.metadata || {}
  };
}

export function roleReportContentHash(report) {
  return semanticHash("sha256", roleReportContentView(report));
}

function normalizedFactSubject(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function factKey(workspaceId, subject) {
  return semanticHash("sha256", {
    workspaceId: String(workspaceId || ""),
    subject: normalizedFactSubject(subject)
  });
}

export function factContentView(fact) {
  return {
    schema: String(fact?.schema || ""),
    workspaceId: String(fact?.workspaceId || ""),
    factKey: String(fact?.factKey || ""),
    subject: String(fact?.subject || ""),
    claim: String(fact?.claim || ""),
    source: fact?.source || {},
    evidenceLevel: String(fact?.evidenceLevel || ""),
    observedAt: String(fact?.observedAt || ""),
    supersedes: fact?.supersedes ?? null,
    evidenceIds: Array.isArray(fact?.evidenceIds) ? fact.evidenceIds : [],
    verdictIds: Array.isArray(fact?.verdictIds) ? fact.verdictIds : [],
    redactions: Array.isArray(fact?.redactions) ? fact.redactions : [],
    metadata: fact?.metadata || {}
  };
}

export function factContentHash(fact) {
  return semanticHash("sha256", factContentView(fact));
}

export function validateContract(schemaName, value) {
  return validateJsonSchema(schemaFor(schemaName), value);
}

export function assertContract(schemaName, value) {
  return assertJsonSchema(schemaFor(schemaName), value, schemaName);
}

export function assertApprovalSemantics(approval) {
  assertContract(APPROVAL_SCHEMA_V1, approval);
  if (approval.singleUse !== true) {
    throw new Error("approval semantics failed: singleUse must be true");
  }
  if (approval.status === "available" && (approval.consumedAt || approval.consumedByRunId)) {
    throw new Error("approval semantics failed: available approval cannot have consumption fields");
  }
  if (approval.status === "consumed" && (!approval.consumedAt || !approval.consumedByRunId)) {
    throw new Error("approval semantics failed: consumed approval requires consumedAt and consumedByRunId");
  }
  return approval;
}

export function assertEvidenceSemantics(evidence) {
  assertContract(EVIDENCE_SCHEMA_V1, evidence);
  if (evidence.contentHash !== evidenceContentHash(evidence)) {
    throw new Error("evidence semantics failed: contentHash does not match semantic content");
  }
  const digestId = `evidence-${evidence.contentHash.slice("sha256:".length, "sha256:".length + 20)}`;
  if (evidence.evidenceId !== digestId) {
    throw new Error("evidence semantics failed: evidenceId must be derived from contentHash");
  }
  const artifactRefs = new Set();
  for (const artifact of evidence.artifacts) {
    if (artifactRefs.has(artifact.ref)) {
      throw new Error(`evidence semantics failed: duplicate artifact ref ${artifact.ref}`);
    }
    artifactRefs.add(artifact.ref);
  }
  if (["edited", "tested", "verified"].includes(evidence.evidenceLevel) && !evidence.artifacts.length) {
    throw new Error(`${evidence.evidenceLevel} evidence requires at least one content-addressed artifact`);
  }
  if (evidence.evidenceLevel === "tested" && !["command", "test"].includes(evidence.method.type)) {
    throw new Error("tested evidence requires command or test method");
  }
  if (evidence.evidenceLevel === "verified") {
    const operatorRecord = evidence.method.type === "operator_record" && evidence.producer.type === "operator";
    const verifierRecord = evidence.method.type === "verification"
      && evidence.producer.type === "verifier"
      && evidence.verdictIds.length > 0;
    if (!operatorRecord && !verifierRecord) {
      throw new Error("verified evidence requires an operator record or a verdict-backed verification");
    }
    if (operatorRecord && evidence.artifacts.some((artifact) => !artifact.ref.startsWith(".nogra/evidence/"))) {
      throw new Error("verified operator evidence artifacts must be stored under .nogra/evidence/");
    }
  }
  return evidence;
}

export function assertFactSemantics(fact) {
  assertContract(FACT_SCHEMA_V1, fact);
  if (fact.factKey !== factKey(fact.workspaceId, fact.subject)) {
    throw new Error("fact semantics failed: factKey does not match workspaceId and subject");
  }
  if (fact.contentHash !== factContentHash(fact)) {
    throw new Error("fact semantics failed: contentHash does not match semantic content");
  }
  const digestId = `fact-${fact.contentHash.slice("sha256:".length, "sha256:".length + 20)}`;
  if (fact.factId !== digestId) {
    throw new Error("fact semantics failed: factId must be derived from contentHash");
  }
  if (fact.supersedes === fact.factId) {
    throw new Error("fact semantics failed: a fact cannot supersede itself");
  }
  if (["memory_projection", "sync_projection"].includes(fact.source.type) && fact.evidenceLevel !== "reported") {
    throw new Error(`${fact.source.type} can only create reported facts`);
  }
  return fact;
}

function normalizedStatement(value) {
  return String(value || "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function assertUniqueValues(values, label) {
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "");
    if (seen.has(normalized)) {
      throw new Error(`anchor semantics failed: duplicate ${label} ${normalized || "(empty)"}`);
    }
    seen.add(normalized);
  }
}

export function assertAnchorSemantics(anchor) {
  assertContract(ANCHOR_SCHEMA_V1, anchor);
  if (anchor.sourceWatermark < 0) {
    throw new Error("anchor semantics failed: sourceWatermark cannot be negative");
  }
  if (Date.parse(anchor.updatedAt) < Date.parse(anchor.createdAt)) {
    throw new Error("anchor semantics failed: updatedAt cannot precede createdAt");
  }
  if (anchor.supersedes === anchor.anchorId) {
    throw new Error("anchor semantics failed: an anchor cannot supersede itself");
  }
  if (anchor.contentHash !== anchorContentHash(anchor)) {
    throw new Error("anchor semantics failed: contentHash does not match the semantic content");
  }

  const authority = anchor.authority || {};
  const refs = anchor.references || {};
  if (authority.mode === "approved") {
    if (!authority.briefId || !authority.briefHash || !authority.approvalId || !authority.approvalActionHash) {
      throw new Error("anchor semantics failed: approved authority requires brief and approval bindings");
    }
    if (!refs.briefIds.includes(authority.briefId) || !refs.approvalIds.includes(authority.approvalId)) {
      throw new Error("anchor semantics failed: approved authority bindings must be present in references");
    }
  } else if (authority.briefId || authority.briefHash || authority.approvalId || authority.approvalActionHash) {
    throw new Error(`anchor semantics failed: ${authority.mode} authority cannot carry approved brief/GO bindings`);
  }

  const verified = anchor.completion?.verifiedDone || [];
  const claimed = anchor.completion?.claimedDone || [];
  const unknown = anchor.completion?.unknown || [];
  assertUniqueValues([...verified, ...claimed].map((item) => item.claimId), "claimId");
  assertUniqueValues(unknown.map((item) => item.itemId), "unknown itemId");
  assertUniqueValues(anchor.decisions.map((item) => item.decisionId), "decisionId");
  assertUniqueValues(anchor.blockers.map((item) => item.blockerId), "blockerId");
  for (const [name, values] of Object.entries(refs)) {
    assertUniqueValues(values, `${name} reference`);
  }

  const buckets = [
    ...verified.map((item) => ({ bucket: "verifiedDone", statement: item.claim })),
    ...claimed.map((item) => ({ bucket: "claimedDone", statement: item.claim })),
    ...unknown.map((item) => ({ bucket: "unknown", statement: item.subject }))
  ];
  const statementBuckets = new Map();
  for (const item of buckets) {
    const key = normalizedStatement(item.statement);
    if (statementBuckets.has(key) && statementBuckets.get(key) !== item.bucket) {
      throw new Error(`anchor semantics failed: the same statement cannot appear in both ${statementBuckets.get(key)} and ${item.bucket}`);
    }
    statementBuckets.set(key, item.bucket);
  }
  for (const claim of verified) {
    if (!refs.factIds.includes(claim.factId)) {
      throw new Error(`anchor semantics failed: verified claim fact is missing from references: ${claim.factId}`);
    }
    for (const evidenceRef of claim.evidenceRefs) {
      if (!refs.evidenceRefs.includes(evidenceRef)) {
        throw new Error(`anchor semantics failed: verified claim evidence is missing from references: ${evidenceRef}`);
      }
    }
  }
  for (const claim of claimed) {
    if (!refs.factIds.includes(claim.factId)) {
      throw new Error(`anchor semantics failed: claimed fact is missing from references: ${claim.factId}`);
    }
  }

  const git = anchor.git || {};
  if (git.status === "clean" && (git.dirtyCount !== 0 || git.dirtyFingerprint !== null)) {
    throw new Error("anchor semantics failed: clean git state requires dirtyCount=0 and no dirty fingerprint");
  }
  if (git.status === "dirty" && (!(git.dirtyCount > 0) || !git.dirtyFingerprint || !git.fingerprintBasis)) {
    throw new Error("anchor semantics failed: dirty git state requires a positive count and fingerprint");
  }
  if (["not_repository", "unknown"].includes(git.status) && (git.dirtyCount !== null || git.dirtyFingerprint !== null)) {
    throw new Error(`anchor semantics failed: ${git.status} git state cannot claim dirty details`);
  }
  return anchor;
}

export function assertRunTransition(fromLifecycle, toLifecycle) {
  const from = String(fromLifecycle || "");
  const to = String(toLifecycle || "");
  if (!RUN_LIFECYCLES.has(from) || !RUN_LIFECYCLES.has(to)) {
    throw new Error(`run transition uses unknown lifecycle: ${from || "(empty)"} -> ${to || "(empty)"}`);
  }
  if (from !== to && !RUN_TRANSITIONS.get(from)?.has(to)) {
    throw new Error(`run transition is not allowed: ${from} -> ${to}`);
  }
  return true;
}

export function assertRoleLeaseSemantics(lease) {
  assertContract(ROLE_LEASE_SCHEMA_V1, lease);
  if (lease.status === "active" && (lease.closedAt !== null || lease.closeReason)) {
    throw new Error("role lease semantics failed: active lease cannot carry closure fields");
  }
  if (lease.status !== "active" && (!lease.closedAt || !lease.closeReason)) {
    throw new Error("role lease semantics failed: closed or expired lease requires closure fields");
  }
  if (Date.parse(lease.expiresAt) <= Date.parse(lease.createdAt)) {
    throw new Error("role lease semantics failed: expiry must follow creation");
  }
  if (lease.role === "verifier" && lease.allowedTools.some((tool) => ["Bash", "Edit", "MultiEdit", "Write"].includes(tool))) {
    throw new Error("role lease semantics failed: verifier operation set must be read-only");
  }
  return lease;
}

export function assertRoleReportSemantics(report) {
  assertContract(ROLE_REPORT_SCHEMA_V1, report);
  if (roleReportContentHash(report) !== report.contentHash) {
    throw new Error("role report semantics failed: content hash mismatch");
  }
  if (report.role === "executor" && report.recommendation !== "none") {
    throw new Error("role report semantics failed: executor cannot issue or recommend a verdict");
  }
  if (report.role === "executor" && report.status === "ok" && report.requestedProbes.length) {
    throw new Error("role report semantics failed: executor ok cannot carry pending Manager probes");
  }
  if (report.role === "verifier") {
    if (report.filesChanged.length || report.mutationAttempted) {
      throw new Error("role report semantics failed: verifier must be read-only");
    }
    if (report.recommendation === "none") {
      throw new Error("role report semantics failed: verifier must return a bounded recommendation");
    }
    if (report.recommendation === "ship" && (
      report.status !== "ok" ||
      !report.evidenceIds.length ||
      report.scopeCheck.status !== "met" ||
      report.requestedProbes.length ||
      !report.claims.length ||
      report.claims.some((claim) => claim.verificationStatus !== "verified" || !claim.evidenceIds.length)
    )) {
      throw new Error("role report semantics failed: ship recommendation requires verified claims, canonical evidence, no pending probes and a met scope check");
    }
    if (report.recommendation !== "ship" && report.status === "ok") {
      throw new Error("role report semantics failed: non-ship verifier recommendation cannot use ok status");
    }
  }
  if (report.status === "ok" && report.scopeCheck.status !== "met") {
    throw new Error("role report semantics failed: ok requires a met scope check");
  }
  if (report.status !== "ok" && !report.reason) {
    throw new Error("role report semantics failed: non-ok report requires a reason");
  }
  return report;
}

export function assertBootContextSemantics(boot) {
  assertContract(BOOT_CONTEXT_SCHEMA_V2, boot);
  if (boot.writes.length || boot.autoLoaded !== false || boot.authorization !== "none" || boot.checkpointLoaded !== false) {
    throw new Error("boot context semantics failed: boot must remain read-only, detector-only and non-authorizing");
  }
  const expectedState =
    boot.status === "missing"
      ? "fresh"
      : ["ambiguous", "hub"].includes(boot.status)
        ? "detected"
        : boot.sessionSource === "resume"
          ? "resumed"
          : boot.sessionSource === "compact"
            ? "recovering"
            : "focused";
  if (boot.state !== expectedState) {
    throw new Error(`boot context semantics failed: ${boot.status}/${boot.sessionSource} requires state ${expectedState}`);
  }
  if (boot.state === "resumed" && boot.sessionSource !== "resume") {
    throw new Error("boot context semantics failed: only a native resume signal may produce resumed");
  }
  if (boot.state === "recovering" && boot.sessionSource !== "compact") {
    throw new Error("boot context semantics failed: only a compact recovery signal may produce recovering");
  }
  if (boot.checkpointAvailable && boot.checkpointStatus === "missing") {
    throw new Error("boot context semantics failed: an available checkpoint cannot be missing");
  }
  if (!boot.checkpointAvailable && boot.checkpointStatus !== "missing") {
    throw new Error("boot context semantics failed: an absent checkpoint must report missing");
  }
  return boot;
}

export function assertMemoryResolutionSemantics(resolution) {
  assertContract(MEMORY_RESOLUTION_SCHEMA_V1, resolution);
  if (resolution.status === "resolved") {
    if (!resolution.directory || !resolution.resolvedDirectory || resolution.autoMemoryEnabled !== true) {
      throw new Error("memory resolution semantics failed: resolved memory requires an enabled concrete directory");
    }
  } else if (resolution.resolvedDirectory) {
    throw new Error(`memory resolution semantics failed: ${resolution.status} cannot expose a resolved directory`);
  }
  if (resolution.status === "disabled" && resolution.autoMemoryEnabled !== false) {
    throw new Error("memory resolution semantics failed: disabled memory must report autoMemoryEnabled=false");
  }
  if (resolution.source.endsWith("-settings") && resolution.status === "resolved" && resolution.confidence !== "configured") {
    throw new Error("memory resolution semantics failed: settings-backed memory must use configured confidence");
  }
  if (resolution.source === "transcript-project" && resolution.confidence !== "exact") {
    throw new Error("memory resolution semantics failed: transcript-backed memory must use exact confidence");
  }
  return resolution;
}

export function assertTranscriptDiagnosticSemantics(diagnostic) {
  assertContract(TRANSCRIPT_DIAGNOSTIC_SCHEMA_V1, diagnostic);
  if (
    diagnostic.authority !== "none" ||
    diagnostic.advisoryOnly !== true ||
    diagnostic.blocking !== false
  ) {
    throw new Error("transcript diagnostic semantics failed: diagnostic must remain advisory and non-authorizing");
  }
  if (diagnostic.signalCount !== diagnostic.signals.length) {
    throw new Error("transcript diagnostic semantics failed: signalCount must match signals");
  }
  if (diagnostic.signalCount < 0 || diagnostic.transcript.lines < 0) {
    throw new Error("transcript diagnostic semantics failed: counts cannot be negative");
  }
  const uniqueSignals = new Set(diagnostic.signals.map((signal) => signal.id));
  if (uniqueSignals.size !== diagnostic.signals.length) {
    throw new Error("transcript diagnostic semantics failed: signal ids must be unique");
  }
  if (!diagnostic.transcript.exists && (diagnostic.transcript.lines !== 0 || diagnostic.signals.length !== 0)) {
    throw new Error("transcript diagnostic semantics failed: missing transcript cannot claim lines or signals");
  }
  if (diagnostic.signals.some((signal) => signal.evidence.some((item) => item.line < 1))) {
    throw new Error("transcript diagnostic semantics failed: evidence lines must be positive");
  }
  if (diagnostic.persistence === "preview" && diagnostic.path) {
    throw new Error("transcript diagnostic semantics failed: preview cannot claim a saved path");
  }
  if (diagnostic.persistence === "saved" && !diagnostic.path) {
    throw new Error("transcript diagnostic semantics failed: saved diagnostic requires a path");
  }
  if (diagnostic.persistence === "saved" && !diagnostic.transcript.exists) {
    throw new Error("transcript diagnostic semantics failed: missing transcript cannot be saved");
  }
  const expectedEffects = {
    permission: "none",
    go: "not-inferred",
    routing: "unchanged",
    dispatch: "unchanged",
    evidenceLevel: "unchanged",
    factLevel: "unchanged",
    verdict: "none"
  };
  if (canonicalJson(diagnostic.controlEffects) !== canonicalJson(expectedEffects)) {
    throw new Error("transcript diagnostic semantics failed: control and truth effects must remain neutral");
  }
  return diagnostic;
}

export function assertRunSemantics(run) {
  assertContract(RUN_SCHEMA_V2, run);
  const preReturn = ["queued", "running", "returning"].includes(run.lifecycle);
  if (preReturn && (run.outcome !== null || run.verdict !== null)) {
    throw new Error(`run semantics failed: ${run.lifecycle} requires null outcome and verdict`);
  }
  if (run.lifecycle === "returned" && (!run.outcome || run.outcome === "cancelled" || run.verdict !== null)) {
    throw new Error("run semantics failed: returned requires a non-cancelled outcome and null verdict");
  }
  if (run.lifecycle === "returned" && (!run.returnedAt || !run.endedAt)) {
    throw new Error("run semantics failed: returned requires returnedAt and endedAt");
  }
  if (run.lifecycle === "verified" && (!run.outcome || !run.verdict)) {
    throw new Error("run semantics failed: verified requires both outcome and verdict");
  }
  if (run.lifecycle === "verified" && (!run.returnedAt || !run.verifiedAt || !run.endedAt)) {
    throw new Error("run semantics failed: verified requires returnedAt, verifiedAt and endedAt");
  }
  if (run.lifecycle === "cancelled" && (run.outcome !== "cancelled" || run.verdict !== null)) {
    throw new Error("run semantics failed: cancelled requires outcome=cancelled and verdict=null");
  }
  if (run.lifecycle === "cancelled" && !run.endedAt) {
    throw new Error("run semantics failed: cancelled requires endedAt");
  }
  if (run.lifecycle === "accepted" && (!run.outcome || !run.acceptedAt)) {
    throw new Error("run semantics failed: accepted requires outcome and acceptedAt");
  }
  if (run.verdict !== null && !["verified", "accepted", "archived"].includes(run.lifecycle)) {
    throw new Error(`run semantics failed: lifecycle ${run.lifecycle} cannot carry a verdict`);
  }
  return run;
}

export function assertRunEventSemantics(event) {
  assertContract(RUN_EVENT_SCHEMA_V2, event);
  const expectedLifecycle = RUN_EVENT_LIFECYCLE.get(event.eventType);
  if (event.type !== event.eventType) {
    throw new Error("run event semantics failed: type must equal eventType");
  }
  if (expectedLifecycle !== event.lifecycle) {
    throw new Error(`run event semantics failed: ${event.eventType} requires lifecycle ${expectedLifecycle}`);
  }
  if (["queued", "running", "returning"].includes(event.lifecycle) && (event.outcome !== null || event.verdict !== null)) {
    throw new Error(`run event semantics failed: ${event.lifecycle} requires null outcome and verdict`);
  }
  if (event.lifecycle === "returned" && (!event.outcome || event.outcome === "cancelled" || event.verdict !== null)) {
    throw new Error("run event semantics failed: returned requires a non-cancelled outcome and null verdict");
  }
  if (event.lifecycle === "verified" && (!event.outcome || !event.verdict)) {
    throw new Error("run event semantics failed: verified requires both outcome and verdict");
  }
  if (event.lifecycle === "cancelled" && (event.outcome !== "cancelled" || event.verdict !== null)) {
    throw new Error("run event semantics failed: cancelled requires outcome=cancelled and verdict=null");
  }
  return event;
}

export function assertVerdictSemantics(verdict) {
  assertContract(VERDICT_SCHEMA_V1, verdict);
  if (verdict.verdict !== "ship" && !String(verdict.reason || "").trim()) {
    throw new Error(`verdict semantics failed: ${verdict.verdict} requires a reason`);
  }
  if (verdict.verdict === "ship" && verdict.evidenceIds.length === 0) {
    throw new Error("verdict semantics failed: ship requires at least one canonical evidenceId");
  }
  return verdict;
}

export function safeApprovalId(value) {
  const cleaned = String(value || "").trim();
  if (!/^approval-[A-Za-z0-9_.-]+$/u.test(cleaned)) {
    throw new Error(`invalid approval id: ${cleaned || "(empty)"}`);
  }
  return cleaned;
}

export function safeAnchorId(value) {
  const cleaned = String(value || "").trim();
  if (!/^anchor-[A-Za-z0-9_.-]+$/u.test(cleaned)) {
    throw new Error(`invalid anchor id: ${cleaned || "(empty)"}`);
  }
  return cleaned;
}

export function safeRunId(value) {
  const cleaned = String(value || "").trim();
  if (!/^(?:run|transport)-[A-Za-z0-9_.-]+$/u.test(cleaned)) {
    throw new Error(`invalid run id: ${cleaned || "(empty)"}`);
  }
  return cleaned;
}

export function approvalsDir(root) {
  return path.join(root, ".nogra", "receipts", "approvals");
}

export function approvalPath(root, approvalId) {
  return path.join(approvalsDir(root), `${safeApprovalId(approvalId)}.json`);
}

export function canonicalRunsDir(root) {
  return path.join(root, ".nogra", "runs");
}

export function canonicalRunPath(root, runId) {
  return path.join(canonicalRunsDir(root), `${safeRunId(runId)}.json`);
}

export function legacyRunPath(root, runId) {
  return path.join(root, ".nogra", "transport", "runs", `${safeRunId(runId)}.json`);
}

export function runIdForApproval(approvalId) {
  return `run-${safeApprovalId(approvalId).slice("approval-".length)}`;
}

export function readJsonIfValid(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

export function legacyLifecycle(record) {
  const phase = String(record?.phase || "").trim().toLowerCase();
  const status = String(record?.status || "").trim().toLowerCase();
  if (["queued", "running", "returning", "returned", "acknowledged"].includes(phase)) {
    return phase === "acknowledged" ? "accepted" : phase;
  }
  if (["queued", "running", "returning"].includes(status)) return status;
  if (["returned", "ok", "partial", "blocked", "failed"].includes(status)) return "returned";
  if (status === "cancelled") return "cancelled";
  if (status === "acknowledged" || status === "accepted") return "accepted";
  if (status === "archived") return "archived";
  return "queued";
}

export function legacyOutcome(record) {
  const status = String(record?.status || "").trim().toLowerCase();
  return RUN_OUTCOMES.has(status) ? status : null;
}

export function legacyVerdict(record) {
  const value = String(record?.verdict || record?.verification || "").trim().toLowerCase();
  return RUN_VERDICTS.has(value) ? value : null;
}

export function normalizeRunRecord(record, sourcePath = "") {
  if (!record || typeof record !== "object") return null;
  if (record.schema === RUN_SCHEMA_V2) {
    return {
      ...record,
      compatibilityStatus: record.outcome || record.lifecycle,
      legacy: false,
      sourcePath
    };
  }
  const runId = String(record.runId || path.basename(sourcePath, ".json"));
  if (!runId) return null;
  return {
    ...record,
    schema: record.schema || "nogra.transport.run.v1",
    runId,
    lifecycle: legacyLifecycle(record),
    outcome: legacyOutcome(record),
    verdict: legacyVerdict(record),
    compatibilityStatus: legacyOutcome(record) || legacyLifecycle(record),
    legacy: true,
    sourcePath
  };
}

export function readRunRecord(root, runIdValue) {
  const runId = safeRunId(runIdValue);
  const canonical = canonicalRunPath(root, runId);
  const canonicalRecord = readJsonIfValid(canonical);
  if (canonicalRecord) return normalizeRunRecord(canonicalRecord, canonical);
  const legacy = legacyRunPath(root, runId);
  const legacyRecord = readJsonIfValid(legacy);
  return legacyRecord ? normalizeRunRecord(legacyRecord, legacy) : null;
}

function recordsFromDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const file = path.join(dir, entry.name);
        return normalizeRunRecord(readJsonIfValid(file), file);
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function listRunRecords(root) {
  const records = new Map();
  for (const record of recordsFromDir(path.join(root, ".nogra", "transport", "runs"))) {
    records.set(record.runId, record);
  }
  for (const record of recordsFromDir(canonicalRunsDir(root))) {
    records.set(record.runId, record);
  }
  return [...records.values()];
}

export function compatibilityRunStatus(record) {
  if (!record) return "";
  return String(record.outcome || record.compatibilityStatus || record.lifecycle || record.status || "");
}
