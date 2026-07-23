#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");
const ledgerRuntime = path.join(pluginRoot, "scripts", "nogra-ledger.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(script, args, input) {
  const output = execFileSync(process.execPath, [script, ...args, "--json"], {
    cwd: pluginRoot,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    stdio: input == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function local(args, input) {
  return run(localRuntime, args, input);
}

function ledger(args, input) {
  return run(ledgerRuntime, args, input);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJsonl(file, records) {
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function saveReadyBrief(root, title, extra = {}) {
  const saved = local(["brief-save", "--root", root, "--source", "v2-runtime-smoke"], {
    title,
    intent: `Exercise ${title}.`,
    contextHandoff: "Isolated canonical runtime conformance fixture.",
    scope: {
      in: ["Write local Nogra fixture evidence."],
      out: ["No app or external state."],
      files: [".nogra/transport/artifacts"]
    },
    successCriteria: ["The canonical contract transition is recorded."],
    stopCriteria: ["Stop on contract drift."],
    maxOutput: { format: "report", limit: "short" },
    evidenceRequired: "verified",
    ...extra
  });
  assert(saved.valid === true, `${title}: brief-save should pass`);
  const promoted = local(["brief-promote", "--root", root, "--brief-id", saved.briefId]);
  assert(promoted.status === "ready", `${title}: brief-promote should pass`);
  return saved;
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-contract-runtime-v2-")));
local(["init", "--root", root, "--apply", "--workspace-name", "Contract Runtime V2"]);

const replayBrief = saveReadyBrief(root, "Replay-safe dispatch");
const briefIsNotGo = local(["dispatch", "--root", root, "--brief-id", replayBrief.briefId]);
assert(briefIsNotGo.status === "blocked" && String(briefIsNotGo.error).includes("brief is not GO"), "a ready brief without approval must not dispatch");
const replayApproval = local(["approval-create", "--root", root, "--brief-id", replayBrief.briefId, "--approved-by", "smoke"]);
assert(replayApproval.status === "available", "explicit GO should create an available approval");
const replayDispatchArgs = [
  "dispatch", "--root", root, "--brief-id", replayBrief.briefId, "--approval-id", replayApproval.approvalId
];
const firstDispatch = local(replayDispatchArgs);
const secondDispatch = local(replayDispatchArgs);
assert(firstDispatch.status === "ready" && secondDispatch.status === "ready", "dispatch and its replay should both resolve");
assert(secondDispatch.idempotent === true, "dispatch replay should be identified as idempotent");
assert(firstDispatch.runId === secondDispatch.runId, "one approval must resolve to one deterministic run id");
assert(fs.readdirSync(path.join(root, ".nogra", "runs")).filter((name) => name.endsWith(".json")).length === 1, "dispatch replay must not create a second run");
let events = readJsonl(path.join(root, ".nogra", "ledger", "events.jsonl"));
assert(events.filter((event) => event.eventType === "run_queued" && event.runId === firstDispatch.runId).length === 1, "dispatch replay must not duplicate run_queued");
let status = local(["status", "--root", root]);
const canonicalProjection = status.recent.runs.find((run) => run.runId === firstDispatch.runId);
assert(canonicalProjection?.schema === "nogra.run.v2" && canonicalProjection.lifecycle === "queued" && canonicalProjection.legacy === false, "status must project canonical runs from .nogra/runs");

writeJson(path.join(root, ".nogra", "transport", "runs", "transport-legacy-fixture.json"), {
  schema: "nogra.transport.run.v1",
  runId: "transport-legacy-fixture",
  workspaceId: "contract-runtime-v2",
  briefId: "brief-legacy-fixture",
  status: "returned",
  phase: "returned",
  target: "executor",
  createdAt: new Date().toISOString(),
  updatedAt: new Date(Date.now() + 1000).toISOString(),
  paths: {},
  artifacts: {}
});
status = local(["status", "--root", root]);
const legacyProjection = status.recent.runs.find((run) => run.runId === "transport-legacy-fixture");
assert(
  legacyProjection?.legacy === true && legacyProjection.lifecycle === "returned",
  `status must dual-read frozen legacy transport runs without rewriting them: ${JSON.stringify(status.recent.runs)}`
);

const dispatchRecoveryBrief = saveReadyBrief(root, "Dispatch crash recovery");
const dispatchRecoveryApproval = local(["approval-create", "--root", root, "--brief-id", dispatchRecoveryBrief.briefId, "--approved-by", "smoke"]);
const dispatchRecoveryArgs = [
  "dispatch", "--root", root, "--brief-id", dispatchRecoveryBrief.briefId, "--approval-id", dispatchRecoveryApproval.approvalId
];
const dispatchBeforeRecovery = local(dispatchRecoveryArgs);
const ledgerFile = path.join(root, ".nogra", "ledger", "events.jsonl");
writeJsonl(
  ledgerFile,
  readJsonl(ledgerFile).filter((event) => !(event.eventType === "run_queued" && event.runId === dispatchBeforeRecovery.runId))
);
const recoveredDispatch = local(dispatchRecoveryArgs);
assert(recoveredDispatch.idempotent === true, "dispatch recovery should preserve idempotent command semantics");
assert(readJsonl(ledgerFile).filter((event) => event.eventType === "run_queued" && event.runId === dispatchBeforeRecovery.runId).length === 1, "dispatch recovery should restore exactly one missing run_queued event");

const targetBrief = saveReadyBrief(root, "Target binding", { targetRole: "executor", targetModel: "anthropic:sonnet" });
const targetApproval = local(["approval-create", "--root", root, "--brief-id", targetBrief.briefId, "--approved-by", "smoke"]);
const targetDrift = local([
  "dispatch", "--root", root, "--brief-id", targetBrief.briefId, "--approval-id", targetApproval.approvalId, "--target", "verifier"
]);
assert(targetDrift.status === "blocked" && String(targetDrift.error).includes("outside the approved brief target"), "post-GO role drift must be blocked");
const modelDrift = local([
  "dispatch", "--root", root, "--brief-id", targetBrief.briefId, "--approval-id", targetApproval.approvalId, "--target-model", "opus"
]);
assert(modelDrift.status === "blocked" && String(modelDrift.error).includes("new GO"), "post-GO runtime drift must be blocked");
const boundDispatch = local([
  "dispatch", "--root", root, "--brief-id", targetBrief.briefId, "--approval-id", targetApproval.approvalId
]);
assert(boundDispatch.status === "ready", "blocked drift attempts must not consume the approval");

const hashBrief = saveReadyBrief(root, "Brief hash binding");
const hashApproval = local(["approval-create", "--root", root, "--brief-id", hashBrief.briefId, "--approved-by", "smoke"]);
const hashBriefFile = path.join(root, ".nogra", "briefs", "drafts", `${hashBrief.briefId}.json`);
const changedBrief = readJson(hashBriefFile);
changedBrief.scope.files = [".nogra/transport/artifacts", "outside-approved-scope.txt"];
changedBrief.updatedAt = new Date().toISOString();
writeJson(hashBriefFile, changedBrief);
const hashDrift = local([
  "dispatch", "--root", root, "--brief-id", hashBrief.briefId, "--approval-id", hashApproval.approvalId
]);
assert(hashDrift.status === "blocked" && String(hashDrift.error).includes("brief revision"), "scope mutation after GO must invalidate approval");
assert(readJson(path.join(root, ".nogra", "receipts", "approvals", `${hashApproval.approvalId}.json`)).status === "available", "hash mismatch must not consume approval");

const expiryBrief = saveReadyBrief(root, "Approval expiry");
const expiryApproval = local(["approval-create", "--root", root, "--brief-id", expiryBrief.briefId, "--approved-by", "smoke"]);
const expiryFile = path.join(root, ".nogra", "receipts", "approvals", `${expiryApproval.approvalId}.json`);
const expired = readJson(expiryFile);
expired.expiresAt = "2026-01-01T00:00:00.000Z";
writeJson(expiryFile, expired);
const expiryDispatch = local([
  "dispatch", "--root", root, "--brief-id", expiryBrief.briefId, "--approval-id", expiryApproval.approvalId
]);
assert(expiryDispatch.status === "blocked" && String(expiryDispatch.error).includes("expired"), "expired approval must block dispatch");
assert(readJson(expiryFile).status === "expired", "expiry observation should persist an auditable expired state");

const finalized = ledger(["finalize-run", "--root", root], {
  runId: firstDispatch.runId,
  status: "ok",
  summary: "Executor outcome returned.",
  reportText: "# Executor Report\n\nFixture completed."
});
assert(finalized.status === "ok" && finalized.outcome === "ok" && finalized.lifecycle === "returned", "finalize must record executor outcome separately");
const finalizedReplay = ledger(["finalize-run", "--root", root], {
  runId: firstDispatch.runId,
  status: "ok",
  summary: "Executor outcome returned.",
  reportText: "# Executor Report\n\nFixture completed."
});
assert(finalizedReplay.status === "ok" && finalizedReplay.writes.event === "skipped", "finalize replay must not duplicate the return event");

const canonicalEvidence = local(["evidence-save", "--root", root], {
  subject: "contract.runtime.transition",
  summary: "The canonical executor report was inspected by the contract runtime smoke.",
  evidenceLevel: "tested",
  producer: { type: "tool", ref: "smoke-contract-runtime-v2" },
  method: { type: "test", description: "Run canonical lifecycle consistency checks.", command: "node smoke-contract-runtime-v2.mjs" },
  result: { status: "pass", exitCode: 0 },
  artifacts: [{ ref: `.nogra/transport/artifacts/${firstDispatch.runId}/report.md`, mediaType: "text/markdown" }],
  sourceRefs: [],
  verdictIds: [],
  runId: firstDispatch.runId,
  briefId: replayBrief.briefId,
  redactions: [],
  metadata: {}
});
assert(canonicalEvidence.status === "ok", "canonical evidence receipt must exist before ship verification");

const verificationInput = {
  verdict: "ship",
  summary: "Direct fixture evidence satisfies the brief.",
  acceptance: [
    {
      criterion: "The canonical contract transition is recorded.",
      status: "met",
      evidence: "Run and event records passed consistency checks."
    }
  ],
  verificationRole: "Manager",
  verificationRuntime: "fixture",
  verificationRuntimeSource: "direct manager verification",
  evidenceIds: [canonicalEvidence.evidence.evidenceId]
};
const verified = local(["verify", "--root", root, "--run-id", firstDispatch.runId], verificationInput);
const verifiedRunFile = path.join(root, ".nogra", "runs", `${firstDispatch.runId}.json`);
const interruptedVerifiedRun = readJson(verifiedRunFile);
const returnedEvent = readJsonl(ledgerFile).find((event) => event.eventType === "run_returned" && event.runId === firstDispatch.runId);
interruptedVerifiedRun.lifecycle = "returned";
interruptedVerifiedRun.verdict = null;
interruptedVerifiedRun.verifiedAt = null;
interruptedVerifiedRun.artifacts.validationExists = false;
interruptedVerifiedRun.ledgerWatermark = returnedEvent.ledgerWatermark;
delete interruptedVerifiedRun.verificationRole;
delete interruptedVerifiedRun.verificationRuntime;
delete interruptedVerifiedRun.verificationRuntimeSource;
delete interruptedVerifiedRun.verificationStatus;
delete interruptedVerifiedRun.verificationLabel;
writeJson(verifiedRunFile, interruptedVerifiedRun);
fs.unlinkSync(path.join(root, ".nogra", "transport", "artifacts", firstDispatch.runId, "validation.json"));
writeJsonl(
  ledgerFile,
  readJsonl(ledgerFile).filter((event) => !(event.eventType === "run_verified" && event.runId === firstDispatch.runId))
);
const verifiedReplay = local(["verify", "--root", root, "--run-id", firstDispatch.runId], verificationInput);
assert(verified.verdict === "ship" && verified.run.outcome === "ok" && verified.run.lifecycle === "verified", "verification must add verdict without replacing outcome");
assert(verifiedReplay.idempotent === true && verifiedReplay.recovered === true, "identical verification replay should recover an interrupted canonical write idempotently");
events = readJsonl(path.join(root, ".nogra", "ledger", "events.jsonl"));
assert(events.filter((event) => event.eventType === "run_returned" && event.runId === firstDispatch.runId).length === 1, "finalize replay must leave one run_returned event");
assert(events.filter((event) => event.eventType === "run_verified" && event.runId === firstDispatch.runId).length === 1, "verify replay must leave one run_verified event");
assert(fs.existsSync(path.join(root, ".nogra", "receipts", "verdicts", `verdict-${firstDispatch.runId}.json`)), "verification must write a canonical verdict receipt");
const conflictingVerification = local(["verify", "--root", root, "--run-id", firstDispatch.runId], {
  verdict: "blocked",
  reason: "Conflicting replay fixture.",
  summary: "Different verdict.",
  acceptance: []
});
assert(conflictingVerification.status === "blocked" && String(conflictingVerification.error).includes("different canonical verdict"), "verdict mutation must require an explicit Manager decision");
const consistency = ledger(["check-run", "--root", root, "--run-id", firstDispatch.runId]);
assert(consistency.status === "ok" && consistency.outcome === "ok" && consistency.verdict === "ship", "canonical run/event/artifact consistency must pass after verification");

console.log("contract-runtime-v2 smoke passed: GO binding, target/runtime/hash drift blocks, single-use dispatch/finalize/verify replay safety, expiry audit, lifecycle/outcome/verdict separation and canonical consistency all hold");
