#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANCHOR_SCHEMA_V1,
  APPROVAL_SCHEMA_V1,
  EVIDENCE_SCHEMA_V1,
  FACT_SCHEMA_V1,
  RUN_EVENT_SCHEMA_V2,
  RUN_SCHEMA_V2,
  VERDICT_SCHEMA_V1,
  anchorContentHash,
  assertAnchorSemantics,
  assertApprovalSemantics,
  assertContract,
  assertEvidenceSemantics,
  assertFactSemantics,
  assertRunEventSemantics,
  assertRunSemantics,
  assertRunTransition,
  assertVerdictSemantics,
  approvalActionHash,
  briefAuthorityHash
} from "../runtime/local/contract-spine.mjs";
import { readJsonSchema } from "../runtime/local/json-schema.mjs";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const schemasDir = path.join(pluginRoot, "contracts", "schemas");
const fixturesDir = path.join(pluginRoot, "contracts", "fixtures", "v2");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}

for (const name of fs.readdirSync(schemasDir).filter((entry) => entry.endsWith(".schema.json"))) {
  readJsonSchema(path.join(schemasDir, name));
}

assertApprovalSemantics(readJson("valid/approval-available.json"));
assertAnchorSemantics(readJson("valid/anchor-observation.json"));
assertEvidenceSemantics(readJson("valid/evidence-tested.json"));
assertFactSemantics(readJson("valid/fact-tested.json"));
assertRunSemantics(readJson("valid/run-queued.json"));
assertRunEventSemantics(readJson("valid/run-event-queued.json"));
assertVerdictSemantics(readJson("valid/verdict-ship.json"));

assertThrows(
  () => assertEvidenceSemantics(readJson("invalid/evidence-verified-without-authority.json")),
  "self-declared verified evidence without operator/verdict authority must fail semantics"
);
assertThrows(
  () => assertFactSemantics(readJson("invalid/fact-sync-upgrade.json")),
  "sync projection facts must not upgrade beyond reported"
);
assertThrows(
  () => assertAnchorSemantics(readJson("invalid/anchor-verified-without-evidence.json")),
  "verified anchor claims without evidence must fail semantics"
);
assertThrows(
  () => assertApprovalSemantics(readJson("invalid/approval-consumed-without-run.json")),
  "consumed approval without a bound run must fail semantics"
);
assertThrows(
  () => assertContract(RUN_SCHEMA_V2, readJson("invalid/run-mixed-status.json")),
  "run v2 must reject the ambiguous legacy status field"
);
assertThrows(
  () => assertRunSemantics(readJson("invalid/run-verified-no-verdict.json")),
  "verified run without a verdict must fail semantics"
);
assertThrows(
  () => assertRunEventSemantics(readJson("invalid/run-event-lifecycle-drift.json")),
  "run event lifecycle drift must fail semantics"
);
assertThrows(
  () => assertVerdictSemantics(readJson("invalid/verdict-missing-reason.json")),
  "non-ship verdict without a reason must fail semantics"
);

assertRunTransition("queued", "returned");
assertRunTransition("returned", "verified");
assertRunTransition("verified", "accepted");
assertThrows(() => assertRunTransition("queued", "verified"), "queued -> verified must not bypass evidence return");
assertThrows(() => assertRunTransition("verified", "returned"), "verified -> returned must not regress lifecycle");

const authorityBrief = {
  schema: "nogra.brief.v1",
  briefId: "brief-fixture",
  workspaceId: "fixture-workspace",
  title: "Fixture",
  intent: "Implement the approved fixture.",
  contextHandoff: "Conformance smoke.",
  scope: { in: ["fixture"], out: [], files: ["fixture.txt"] },
  successCriteria: ["Fixture passes."],
  stopCriteria: ["Stop on drift."],
  maxOutput: { format: "report", limit: "short" },
  evidenceRequired: "tested",
  targetRole: "executor",
  targetModel: "sonnet"
};
const stableHash = briefAuthorityHash(authorityBrief);
const stableActionHash = approvalActionHash(authorityBrief);
assert(stableHash === briefAuthorityHash({ ...authorityBrief, status: "ready", updatedAt: "2026-07-23T10:00:00.000Z" }), "status/timestamp projection changes must not invalidate GO");
assert(stableActionHash === approvalActionHash({ ...authorityBrief, status: "ready", updatedAt: "2026-07-23T10:00:00.000Z" }), "status/timestamp projection changes must not invalidate the action hash");
assert(stableHash !== briefAuthorityHash({ ...authorityBrief, scope: { ...authorityBrief.scope, files: ["other.txt"] } }), "scope changes must invalidate GO");
assert(stableHash !== briefAuthorityHash({ ...authorityBrief, targetModel: "opus" }), "runtime changes must invalidate GO");
assert(stableHash !== briefAuthorityHash({ ...authorityBrief, maxOutput: { format: "report", limit: "long" } }), "return-policy changes must invalidate GO");
assert(stableActionHash !== approvalActionHash({ ...authorityBrief, targetRole: "verifier" }), "target-role changes must invalidate the dispatch action hash");

for (const [schema, fixture] of [
  [ANCHOR_SCHEMA_V1, "valid/anchor-observation.json"],
  [APPROVAL_SCHEMA_V1, "valid/approval-available.json"],
  [EVIDENCE_SCHEMA_V1, "valid/evidence-tested.json"],
  [FACT_SCHEMA_V1, "valid/fact-tested.json"],
  [RUN_SCHEMA_V2, "valid/run-queued.json"],
  [RUN_EVENT_SCHEMA_V2, "valid/run-event-queued.json"],
  [VERDICT_SCHEMA_V1, "valid/verdict-ship.json"]
]) {
  assertContract(schema, readJson(fixture));
}

const anchor = readJson("valid/anchor-observation.json");
assert(anchor.contentHash === anchorContentHash(anchor), "anchor content hash must bind semantic continuity state");
assertThrows(
  () => assertAnchorSemantics({ ...anchor, nextOwner: "Executor" }),
  "anchor semantic mutation must invalidate its content hash"
);

console.log("contract-spine-v2 smoke passed: all bundled schema keywords are enforced; valid goldens pass; anchor provenance/hash drift, lifecycle bypasses, ambiguous status and unscoped GO mutations fail");
