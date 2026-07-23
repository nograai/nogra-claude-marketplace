#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  factStatus,
  readEvidenceRecord,
  readFactRecords,
  recordFact,
  saveEvidenceRecord
} from "../runtime/local/fact-store.mjs";
import { syncPull } from "../runtime/local/sync-client.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");

function throwsNamed(fn, pattern, label) {
  assert.throws(fn, pattern, label);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-fact-smoke-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-fact-outside-"));
  try {
    execFileSync(process.execPath, [localRuntime, "init", "--apply", "--root", root, "--workspace-name", "Fact smoke", "--json"], {
      encoding: "utf8"
    });
    const outputRef = ".nogra/evidence/fact-smoke-output.txt";
    write(path.join(root, outputRef), "phase 3 smoke passed\n");

    const testedInput = {
      subject: "workspace.quality.phase3.test",
      summary: "The phase-3 fixture command completed successfully.",
      evidenceLevel: "tested",
      producer: { type: "tool", ref: "smoke-evidence-fact-v1" },
      method: { type: "test", description: "Run the phase-3 fixture.", command: "node smoke-evidence-fact-v1.mjs" },
      result: { status: "pass", exitCode: 0 },
      artifacts: [{ ref: outputRef, mediaType: "text/plain" }],
      sourceRefs: [],
      verdictIds: [],
      runId: null,
      briefId: null,
      redactions: [],
      metadata: {}
    };
    const tested = saveEvidenceRecord(root, testedInput);
    assert.equal(tested.status, "ok");
    assert.match(tested.evidence.evidenceId, /^evidence-[a-f0-9]{20}$/u);
    assert.equal(tested.evidence.artifacts[0].sha256.length, 71);
    const testedReplay = saveEvidenceRecord(root, testedInput);
    assert.equal(testedReplay.idempotent, true, "identical evidence must deduplicate by semantic content");
    assert.equal(testedReplay.evidence.createdAt, tested.evidence.createdAt, "idempotent evidence replay must return the immutable original");

    const firstFactInput = {
      subject: "workspace.quality.phase3.status",
      claim: "The phase-3 fact fixture passed.",
      source: { type: "tool_receipt", ref: tested.evidence.evidenceId },
      evidenceLevel: "tested",
      observedAt: "2026-07-23T12:00:00Z",
      supersedes: null,
      evidenceIds: [tested.evidence.evidenceId],
      verdictIds: [],
      redactions: [],
      metadata: {}
    };
    const firstFact = recordFact(root, firstFactInput);
    assert.equal(firstFact.status, "ok");
    assert.equal(recordFact(root, firstFactInput).idempotent, true, "identical fact retry must be idempotent");
    throwsNamed(
      () => recordFact(root, { ...firstFactInput, claim: "Different wording without an explicit correction." }),
      /explicit supersedes/u,
      "one stable subject must not gain duplicate active facts"
    );

    const replacement = recordFact(root, {
      ...firstFactInput,
      claim: "The phase-3 fact and evidence fixture passed.",
      supersedes: firstFact.fact.factId
    });
    assert.equal(replacement.fact.supersedes, firstFact.fact.factId);
    throwsNamed(
      () => recordFact(root, {
        ...firstFactInput,
        claim: "A lower-confidence correction.",
        evidenceLevel: "reported",
        evidenceIds: [],
        supersedes: replacement.fact.factId
      }),
      /cannot regress/u,
      "supersession must not lower evidence strength"
    );

    throwsNamed(
      () => recordFact(root, {
        subject: "workspace.quality.phase3.memory-claim",
        claim: "A synchronized memory line says the phase is verified.",
        source: { type: "sync_projection", ref: "MEMORY.md" },
        evidenceLevel: "verified",
        observedAt: "2026-07-23T12:00:00Z",
        supersedes: null,
        evidenceIds: [tested.evidence.evidenceId],
        verdictIds: [],
        redactions: [],
        metadata: {}
      }),
      /sync_projection can only create reported facts/u,
      "sync projections must never upgrade a claim"
    );
    const reportedProjectionFact = recordFact(root, {
      subject: "workspace.quality.phase3.memory-claim",
      claim: "A synchronized memory line reports that the phase is verified.",
      source: { type: "sync_projection", ref: "MEMORY.md" },
      evidenceLevel: "reported",
      observedAt: "2026-07-23T12:00:00Z",
      supersedes: null,
      evidenceIds: [],
      verdictIds: [],
      redactions: [],
      metadata: {}
    });
    assert.equal(reportedProjectionFact.fact.evidenceLevel, "reported");

    throwsNamed(
      () => recordFact(root, {
        subject: "workspace.quality.phase3.unsupported-verification",
        claim: "Tested evidence alone is a verified fact.",
        source: { type: "tool_receipt", ref: tested.evidence.evidenceId },
        evidenceLevel: "verified",
        observedAt: "2026-07-23T12:00:00Z",
        supersedes: null,
        evidenceIds: [tested.evidence.evidenceId],
        verdictIds: [],
        redactions: [],
        metadata: {}
      }),
      /verified operator evidence or a canonical ship verdict/u,
      "tested evidence must not self-promote to verified fact"
    );

    const operatorRef = ".nogra/evidence/operator-phase3-record.md";
    write(path.join(root, operatorRef), "Patrick approved the English-first phase-3 direction.\n");
    const operatorEvidence = saveEvidenceRecord(root, {
      subject: "product.language.canonical",
      summary: "The operator record states the canonical language decision.",
      evidenceLevel: "verified",
      producer: { type: "operator", ref: "patrick" },
      method: { type: "operator_record", description: "Read the explicit operator decision.", command: null },
      result: { status: "observed", exitCode: null },
      artifacts: [{ ref: operatorRef, mediaType: "text/markdown" }],
      sourceRefs: [operatorRef],
      verdictIds: [],
      runId: null,
      briefId: null,
      redactions: [],
      metadata: {}
    });
    const operatorFact = recordFact(root, {
      subject: "product.language.canonical",
      claim: "NOGRA canonical product surfaces are English-first.",
      source: { type: "operator_record", ref: operatorEvidence.evidence.evidenceId },
      evidenceLevel: "verified",
      observedAt: "2026-07-23T12:00:00Z",
      supersedes: null,
      evidenceIds: [operatorEvidence.evidence.evidenceId],
      verdictIds: [],
      redactions: [],
      metadata: {}
    });
    assert.equal(operatorFact.fact.evidenceLevel, "verified");

    write(path.join(outside, "outside.txt"), "outside\n");
    fs.symlinkSync(path.join(outside, "outside.txt"), path.join(root, ".nogra", "evidence", "escape.txt"));
    throwsNamed(
      () => saveEvidenceRecord(root, { ...testedInput, subject: "workspace.escape", artifacts: [{ ref: ".nogra/evidence/escape.txt" }] }),
      /resolves outside the workspace/u,
      "artifact symlink escapes must be rejected"
    );

    const memoryDir = path.join(root, ".native-memory-fixture");
    const syncDir = path.join(root, ".nogra", "memory", "sync-fixture");
    fs.mkdirSync(memoryDir, { recursive: true });
    const server = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        memory: "- phase 3 is verified because memory says so\n",
        user: "",
        turns: [],
        cursor: 0,
        wm: 1
      }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = server.address().port;
      const beforeFacts = readFactRecords(root).length;
      await syncPull(root, {
        ctx: { endpoint: `http://127.0.0.1:${port}`, token: "fixture", mode: "union" },
        memoryDir,
        syncDir
      });
      assert.equal(readFactRecords(root).length, beforeFacts, "sync pull must not create or upgrade ledger facts");
      assert.match(fs.readFileSync(path.join(memoryDir, "MEMORY.md"), "utf8"), /memory says so/u);
      const syncState = JSON.parse(fs.readFileSync(path.join(syncDir, "state.json"), "utf8"));
      assert.equal(syncState.memoryAuthority, "advisory_projection_only", "sync state must preserve the projection boundary");
      assert.match(fs.readFileSync(path.join(syncDir, "log.jsonl"), "utf8"), /"authority":"advisory_projection_only"/u);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    write(path.join(root, outputRef), "tampered after receipt\n");
    throwsNamed(
      () => readEvidenceRecord(root, tested.evidence.evidenceId),
      /integrity mismatch/u,
      "changed evidence artifacts must fail integrity checks"
    );
    throwsNamed(
      () => factStatus(root),
      /integrity mismatch/u,
      "fact projection must fail closed when supporting evidence changes"
    );
    write(path.join(root, outputRef), "phase 3 smoke passed\n");

    const status = factStatus(root);
    assert.equal(status.projection.counts.active, 3);
    assert.equal(status.projection.counts.superseded, 1);
    assert.equal(status.projection.memoryAuthority, "advisory_projection_only");
    assert.equal(status.freshness, "fresh");
    assert.ok(status.projection.activeFacts.every((fact) => fact.factId && fact.factKey));

    console.log("evidence/fact v1 smoke passed: content-addressed evidence, explicit supersession, monotonic levels, advisory memory/sync, integrity and ledger projection hold");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`smoke-evidence-fact-v1: FAIL - ${error.stack || error.message}`);
  process.exitCode = 1;
});
