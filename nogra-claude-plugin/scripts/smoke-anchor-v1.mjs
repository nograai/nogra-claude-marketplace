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

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  }).trim();
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-anchor-v1-")));
git(root, ["init", "-q"]);
git(root, ["config", "user.name", "Nogra Smoke"]);
git(root, ["config", "user.email", "smoke@nogra.invalid"]);
local(["init", "--root", root, "--apply", "--workspace-name", "Anchor V1"]);
fs.writeFileSync(path.join(root, "app.txt"), "baseline\n", "utf8");
writeJson(path.join(root, ".nogra", "evidence", "anchor-smoke.json"), {
  schema: "nogra.evidence.fixture.v1",
  result: "The local Anchor smoke passed its baseline check."
});
git(root, ["add", "."]);
git(root, ["commit", "-qm", "anchor fixture baseline"]);

const baselineEvidence = local(["evidence-save", "--root", root], {
  subject: "anchor.fixture.baseline",
  summary: "The operator fixture records the baseline Anchor observation.",
  evidenceLevel: "verified",
  producer: { type: "operator", ref: "anchor-smoke" },
  method: { type: "operator_record", description: "Read the local operator fixture.", command: null },
  result: { status: "observed", exitCode: null },
  artifacts: [{ ref: ".nogra/evidence/anchor-smoke.json", mediaType: "application/json" }],
  sourceRefs: [".nogra/evidence/anchor-smoke.json"],
  verdictIds: [],
  runId: null,
  briefId: null,
  redactions: [],
  metadata: {}
});
const baselineFact = local(["fact-record", "--root", root], {
  subject: "anchor.fixture.baseline",
  claim: "The baseline Anchor fixture evidence exists.",
  source: { type: "operator_record", ref: baselineEvidence.evidence.evidenceId },
  evidenceLevel: "verified",
  observedAt: "2026-07-23T10:00:00.000Z",
  supersedes: null,
  evidenceIds: [baselineEvidence.evidence.evidenceId],
  verdictIds: [],
  redactions: [],
  metadata: {}
});
const claimedFact = local(["fact-record", "--root", root], {
  subject: "anchor.fixture.next-phase",
  claim: "The caller reports that the next quality phase is ready for review.",
  source: { type: "operator_record", ref: "fixture:caller" },
  evidenceLevel: "reported",
  observedAt: "2026-07-23T10:00:00.000Z",
  supersedes: null,
  evidenceIds: [],
  verdictIds: [],
  redactions: [],
  metadata: {}
});

const statusBefore = local(["status", "--root", root]);
assert(statusBefore.ledger.anchorStatus === "missing", "fresh initialized workspace should have no semantic Anchor yet");
assert(statusBefore.ledger.checkpointStatus === "stale", "fact/evidence ledger activity should make the legacy Markdown projection stale before the first Anchor");

const invalid = local(["anchor-validate", "--root", root], {
  authority: {
    mode: "observation",
    objective: "Reject an unsupported completion claim.",
    scope: { in: ["Fixture."], out: [] }
  },
  completion: {
    verifiedDone: [
      {
        factId: "fact-aaaaaaaaaaaaaaaaaaaa",
        claim: "A missing receipt proves deployment.",
        observedAt: "2026-07-23T10:00:00.000Z",
        evidenceRefs: [".nogra/evidence/missing.json"],
        provenance: {
          evidenceLevel: "verified",
          sourceType: "evidence",
          sourceRef: ".nogra/evidence/missing.json"
        }
      }
    ],
    claimedDone: [],
    unknown: []
  },
  nextOwner: "Manager"
});
assert(invalid.valid === false && invalid.errors.some((error) => error.includes("does not resolve")), "verified claims must not accept missing evidence");
const outsideEvidence = path.join(os.tmpdir(), `nogra-anchor-outside-${process.pid}.json`);
fs.writeFileSync(outsideEvidence, "{}\n", "utf8");
fs.symlinkSync(outsideEvidence, path.join(root, ".nogra", "evidence", "outside-link.json"));
const escapedEvidence = local(["anchor-validate", "--root", root], {
  authority: {
    mode: "observation",
    objective: "Reject evidence symlinks outside the local trust domain.",
    scope: { in: ["Fixture."], out: [] }
  },
  completion: {
    verifiedDone: [
      {
        factId: "fact-aaaaaaaaaaaaaaaaaaaa",
        claim: "An outside file is local evidence.",
        observedAt: "2026-07-23T10:00:00.000Z",
        evidenceRefs: [".nogra/evidence/outside-link.json"],
        provenance: {
          evidenceLevel: "verified",
          sourceType: "evidence",
          sourceRef: ".nogra/evidence/outside-link.json"
        }
      }
    ],
    claimedDone: [],
    unknown: []
  },
  nextOwner: "Manager"
});
assert(escapedEvidence.valid === false && escapedEvidence.errors.some((error) => error.includes("outside")), "verified evidence symlinks must not escape the local .nogra trust domain");
fs.unlinkSync(path.join(root, ".nogra", "evidence", "outside-link.json"));
fs.unlinkSync(outsideEvidence);

const input = {
  authority: {
    mode: "observation",
    objective: "Preserve the verified Anchor v1 smoke state.",
    scope: {
      in: ["Local Anchor contracts, records and projections."],
      out: ["No external state or deployment."]
    }
  },
  completion: {
    verifiedDone: [
      {
        factId: baselineFact.fact.factId,
        claim: "The baseline Anchor fixture evidence exists.",
        observedAt: "2026-07-23T10:00:00.000Z",
        evidenceRefs: [baselineEvidence.path],
        provenance: {
          evidenceLevel: "verified",
          sourceType: "evidence",
          sourceRef: baselineEvidence.evidence.evidenceId
        }
      }
    ],
    claimedDone: [
      {
        factId: claimedFact.fact.factId,
        claim: "The caller reports that the next quality phase is ready for review.",
        claimedAt: "2026-07-23T10:00:00.000Z",
        claimedBy: "fixture-caller",
        evidenceRefs: [],
        provenance: {
          evidenceLevel: "reported",
          sourceType: "operator_record",
          sourceRef: "fixture:caller"
        }
      }
    ],
    unknown: [
      {
        subject: "Production deployment state",
        reason: "No deployment receipt is in scope.",
        nextCheck: "Inspect a canonical deployment receipt.",
        sourceRef: "fixture:scope"
      }
    ]
  },
  decisions: [
    {
      decision: "Canonical product surfaces are English-first.",
      owner: "Patrick",
      sourceRef: "fixture:decision"
    }
  ],
  blockers: [],
  nextOwner: "Manager",
  references: {
    evidenceRefs: [baselineEvidence.path]
  }
};

const firstExpectedWatermark = readJsonl(path.join(root, ".nogra", "ledger", "events.jsonl")).length + 1;
const first = local(["anchor-save", "--root", root], input);
assert(first.status === "ok" && first.idempotent === false, "first Anchor save should write one canonical record");
assert(first.anchor.schema === "nogra.anchor.v1", "Anchor writer should emit the canonical schema");
assert(first.anchor.sourceWatermark === firstExpectedWatermark, "first Anchor should bind its ledger event watermark");
assert(first.anchor.supersedes === null, "first Anchor should not supersede another record");
assert(first.anchor.completion.verifiedDone.length === 1, "verified completion should remain explicit");
assert(first.anchor.completion.claimedDone.length === 1, "claimed completion should remain separate");
assert(first.anchor.completion.unknown.length === 1, "unknown completion should remain explicit");
assert(fs.existsSync(path.join(root, first.path)), "immutable Anchor JSON should exist");
assert(fs.existsSync(path.join(root, first.currentPath)), "current Anchor JSON projection should exist");
assert(fs.existsSync(path.join(root, first.projectionPath)), "human-readable Anchor projection should exist");

const eventsAfterFirst = readJsonl(path.join(root, ".nogra", "ledger", "events.jsonl"));
assert(eventsAfterFirst.filter((event) => event.type === "anchor_saved").length === 1, "first save should append exactly one Anchor ledger event");
const projection = fs.readFileSync(path.join(root, first.projectionPath), "utf8");
assert(projection.includes("# Nogra Anchor"), "Markdown projection should use the English-first Anchor name");
assert(projection.includes("## Verified Done") && projection.includes("## Claimed Done") && projection.includes("## Unknown"), "projection should preserve completion truth classes");

const second = local(["anchor-save", "--root", root], input);
assert(second.idempotent === true && second.recovered === false, "fresh identical Anchor save should deduplicate");
assert(second.anchor.anchorId === first.anchor.anchorId, "dedupe should return the existing Anchor id");
assert(readJsonl(path.join(root, ".nogra", "ledger", "events.jsonl")).filter((event) => event.type === "anchor_saved").length === 1, "dedupe must not append another ledger event");

let status = local(["status", "--root", root]);
assert(status.ledger.anchorStatus === "fresh", `saved Anchor should be fresh: ${JSON.stringify(status.ledger)}`);
assert(status.ledger.currentAnchorId === first.anchor.anchorId, "status should expose the canonical current Anchor id");

local(["ledger-smoke", "--root", root, "--label", "make Anchor stale"]);
status = local(["status", "--root", root]);
assert(status.ledger.anchorStatus === "stale_ledger", "ledger movement should make the current Anchor stale");
const superseding = local(["anchor-save", "--root", root], input);
assert(superseding.idempotent === false, "stale ledger should create a new Anchor even when semantic content is unchanged");
assert(superseding.anchor.supersedes === first.anchor.anchorId, "new Anchor should link the superseded record");
assert(superseding.anchor.sourceWatermark === first.anchor.sourceWatermark + 2, "superseding Anchor should bind the new ledger watermark");

fs.unlinkSync(path.join(root, superseding.currentPath));
const recovered = local(["anchor-save", "--root", root], input);
assert(recovered.idempotent === true && recovered.recovered === true, "missing current projection should recover from immutable record plus ledger event");
assert(recovered.anchor.anchorId === superseding.anchor.anchorId, "recovery should not create a duplicate Anchor");
assert(fs.readdirSync(path.join(root, ".nogra", "checkpoints")).filter((name) => name.startsWith("anchor-") && name.endsWith(".json")).length === 2, "recovery should leave exactly two immutable semantic snapshots");

const brief = local(["brief-save", "--root", root, "--source", "anchor-smoke"], {
  title: "Approved Anchor binding",
  intent: "Prove that Anchor derives approved objective and scope from canonical authority records.",
  contextHandoff: "Anchor v1 approved-authority fixture.",
  scope: {
    in: ["Local Nogra records."],
    out: ["No external state."],
    files: [".nogra/"]
  },
  successCriteria: ["Approved Anchor binds the verified run and verdict."],
  stopCriteria: ["Stop on authority drift."],
  maxOutput: { format: "report", limit: "short" },
  evidenceRequired: "verified"
});
local(["brief-promote", "--root", root, "--brief-id", brief.briefId]);
const approval = local(["approval-create", "--root", root, "--brief-id", brief.briefId, "--approved-by", "anchor-smoke"]);
const dispatch = local(["dispatch", "--root", root, "--brief-id", brief.briefId, "--approval-id", approval.approvalId]);
ledger(["finalize-run", "--root", root], {
  runId: dispatch.runId,
  status: "ok",
  summary: "Approved Anchor fixture returned.",
  reportText: "# Anchor fixture report\n\nThe local fixture returned."
});
const approvedEvidence = local(["evidence-save", "--root", root], {
  subject: "anchor.fixture.approved-run",
  summary: "The approved Anchor fixture returned a content-addressed executor report.",
  evidenceLevel: "tested",
  producer: { type: "tool", ref: "smoke-anchor-v1" },
  method: { type: "test", description: "Exercise the approved Anchor lifecycle fixture.", command: "node smoke-anchor-v1.mjs" },
  result: { status: "pass", exitCode: 0 },
  artifacts: [{ ref: `.nogra/transport/artifacts/${dispatch.runId}/report.md`, mediaType: "text/markdown" }],
  sourceRefs: [],
  verdictIds: [],
  runId: dispatch.runId,
  briefId: brief.briefId,
  redactions: [],
  metadata: {}
});
local(["verify", "--root", root, "--run-id", dispatch.runId], {
  verdict: "ship",
  summary: "Approved Anchor fixture evidence satisfies the brief.",
  acceptance: [
    {
      criterion: "Approved Anchor binds the verified run and verdict.",
      status: "met",
      evidence: "Canonical run, report and verdict records exist."
    }
  ],
  verificationRole: "Manager",
  verificationRuntime: "fixture",
  evidenceIds: [approvedEvidence.evidence.evidenceId]
});
const approvedFact = local(["fact-record", "--root", root], {
  subject: "anchor.fixture.approved-run",
  claim: "The approved Anchor fixture run received a ship verdict.",
  source: { type: "verifier_report", ref: `verdict-${dispatch.runId}` },
  evidenceLevel: "verified",
  observedAt: "2026-07-23T10:00:00.000Z",
  supersedes: null,
  evidenceIds: [approvedEvidence.evidence.evidenceId],
  verdictIds: [`verdict-${dispatch.runId}`],
  redactions: [],
  metadata: {}
});
const approvedInput = {
  authority: {
    mode: "approved",
    briefId: brief.briefId,
    approvalId: approval.approvalId
  },
  completion: {
    verifiedDone: [
      {
        factId: approvedFact.fact.factId,
        claim: "The approved Anchor fixture run received a ship verdict.",
        observedAt: "2026-07-23T10:00:00.000Z",
        evidenceRefs: [`.nogra/transport/artifacts/${dispatch.runId}/validation.json`],
        provenance: {
          evidenceLevel: "verified",
          sourceType: "verdict",
          sourceRef: `verdict-${dispatch.runId}`
        }
      }
    ],
    claimedDone: [],
    unknown: []
  },
  decisions: [],
  blockers: [],
  nextOwner: "Manager",
  references: {
    runIds: [dispatch.runId],
    evidenceRefs: [
      approvedEvidence.path,
      `.nogra/transport/artifacts/${dispatch.runId}/validation.json`
    ],
    verdictIds: [`verdict-${dispatch.runId}`]
  }
};
const approvedAnchor = local(["anchor-save", "--root", root], approvedInput);
assert(approvedAnchor.anchor.authority.objective === brief.intent, "approved Anchor objective must be derived from the bound brief");
assert(approvedAnchor.anchor.authority.briefId === brief.briefId, "approved Anchor should bind the canonical brief");
assert(approvedAnchor.anchor.authority.approvalId === approval.approvalId, "approved Anchor should bind the consumed approval");
assert(approvedAnchor.anchor.references.runIds.includes(dispatch.runId), "approved Anchor should retain its canonical run reference");
assert(approvedAnchor.anchor.references.verdictIds.includes(`verdict-${dispatch.runId}`), "approved Anchor should retain its verdict reference");
const driftedAuthority = local(["anchor-validate", "--root", root], {
  ...approvedInput,
  authority: {
    ...approvedInput.authority,
    objective: "A caller-supplied objective that differs from the brief."
  }
});
assert(driftedAuthority.valid === false && driftedAuthority.errors.some((error) => error.includes("must come from the bound brief")), "approved Anchor must reject caller-authored objective drift");

fs.writeFileSync(path.join(root, "app.txt"), "changed after anchor\n", "utf8");
status = local(["status", "--root", root]);
assert(status.ledger.anchorStatus === "stale_git", "repository mutation should make a ledger-current Anchor stale by Git fingerprint");

console.log("anchor-v1 smoke passed: evidence-gated truth classes, immutable records, atomic projections, ledger/Git freshness, dedupe, supersedes and interrupted-projection recovery all hold");
