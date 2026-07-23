#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(pluginRoot, "..");
const localRuntime = path.join(pluginRoot, "scripts", "nogra-local.mjs");
const ledgerRuntime = path.join(pluginRoot, "scripts", "nogra-ledger.mjs");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function command(script, args, input = null) {
  const output = execFileSync(process.execPath, [script, ...args, "--json"], {
    cwd: repoRoot,
    input: input == null ? undefined : JSON.stringify(input),
    encoding: "utf8",
    stdio: input == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function local(args, input = null) {
  return command(localRuntime, args, input);
}

function ledger(args, input) {
  return command(ledgerRuntime, args, input);
}

function hook(root, input) {
  const output = execFileSync(process.execPath, [preToolUseHook], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: root,
      ...input
    }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PROJECT_ROOT: root
    }
  });
  return output.trim() ? JSON.parse(output) : {};
}

function denied(payload) {
  return payload.hookSpecificOutput?.permissionDecision === "deny";
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-role-isolation-v1-")));
local(["init", "--root", root, "--apply", "--workspace-name", "Role Isolation V1"]);
fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "allowed.txt"), "allowed\n", "utf8");
fs.writeFileSync(path.join(root, "src", "outside.txt"), "outside\n", "utf8");
const outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nogra-role-escape-")));
fs.writeFileSync(path.join(outsideRoot, "escaped.txt"), "escaped\n", "utf8");
fs.symlinkSync(path.join(outsideRoot, "escaped.txt"), path.join(root, "src", "escape.txt"));

const brief = local(["brief-save", "--root", root, "--source", "role-isolation-smoke"], {
  title: "Role isolation fixture",
  intent: "Exercise the strict role boundary.",
  contextHandoff: "Self-contained Phase 4 regression fixture.",
  scope: {
    in: ["Edit one declared source file."],
    out: ["No control-plane writes, arbitrary shell or other source files."],
    files: ["src/allowed.txt", "src/escape.txt"]
  },
  successCriteria: ["The declared file remains the only writable executor target."],
  stopCriteria: ["Stop on role, scope or evidence mismatch."],
  maxOutput: { format: "structured role report", limit: "short" },
  evidenceRequired: "verified"
});
assert(brief.valid === true, "role isolation fixture brief should validate");
local(["brief-promote", "--root", root, "--brief-id", brief.briefId]);
const approval = local(["approval-create", "--root", root, "--brief-id", brief.briefId, "--approved-by", "smoke"]);
const dispatch = local([
  "dispatch",
  "--root",
  root,
  "--brief-id",
  brief.briefId,
  "--approval-id",
  approval.approvalId
]);
assert(dispatch.status === "ready", "role isolation fixture should dispatch");
assert(dispatch.run.scopePatterns?.includes("src/allowed.txt"), "dispatch must bind file scope into the canonical run");
assert(dispatch.executionCrossing?.roleLeaseRequired === true, "dispatch must require a role lease");
assert(dispatch.executionCrossing?.arbitraryShellAllowed === false, "dispatch must deny arbitrary shell");

const executorLease = local([
  "role-enter",
  "--root",
  root,
  "--run-id",
  dispatch.runId,
  "--role",
  "executor",
  "--expires-in-minutes",
  "30"
]);
assert(executorLease.status === "active", "Manager should be able to enter the executor role");
assert(executorLease.scopePatterns.length === 2 && executorLease.scopePatterns.includes("src/allowed.txt"), "executor lease must carry normalized scope");
assert(!executorLease.allowedTools.includes("Bash"), "executor lease must not expose arbitrary shell");
assert(local(["role-status", "--root", root]).effectiveStatus === "active", "role-status should expose the active lease");
assert(local(["status", "--root", root]).roleIsolation?.leaseId === executorLease.leaseId, "general status should project the active role lease");
const executorHandoff = local(["handoff-contract", "--root", root, "--kind", "executor", "--run-id", dispatch.runId]);
assert(executorHandoff.roleIsolation?.leaseActive === true, "executor handoff should observe the active lease");
assert(executorHandoff.roleIsolation?.expectedLeaseId === executorLease.leaseId, "executor handoff should bind the exact lease");
assert(executorHandoff.roleReport?.template?.leaseId === executorLease.leaseId, "executor handoff should carry the exact role report template");

const allowedEdit = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Edit",
  tool_input: { file_path: path.join(root, "src", "allowed.txt"), old_string: "allowed", new_string: "changed" }
});
assert(!denied(allowedEdit), "in-scope executor edit should pass the role boundary without auto-approval");

const outsideEdit = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Edit",
  tool_input: { file_path: path.join(root, "src", "outside.txt"), old_string: "outside", new_string: "changed" }
});
assert(denied(outsideEdit), "out-of-scope executor edit must fail closed");

const symlinkEscape = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Edit",
  tool_input: { file_path: path.join(root, "src", "escape.txt"), old_string: "escaped", new_string: "changed" }
});
assert(denied(symlinkEscape), "approved lexical path that resolves through an external symlink must fail closed");

const controlPlaneWrite = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Write",
  tool_input: { file_path: path.join(root, ".nogra", "config.json"), content: "{}" }
});
assert(denied(controlPlaneWrite), "executor control-plane write must fail closed");

const executorShell = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Bash",
  tool_input: { command: "printf unsafe" }
});
assert(denied(executorShell), "executor arbitrary shell must fail closed");

const agentSwap = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-2",
  tool_name: "Edit",
  tool_input: { file_path: path.join(root, "src", "allowed.txt"), old_string: "allowed", new_string: "changed" }
});
assert(denied(agentSwap), "a second agent must not reuse a bound executor lease");

const roleEscalation = hook(root, {
  agent_type: "verifier",
  agent_id: "agent-verifier-1",
  tool_name: "Write",
  tool_input: { file_path: path.join(root, "src", "allowed.txt"), content: "changed" }
});
assert(denied(roleEscalation), "verifier must not borrow an executor lease");

const executorExit = local([
  "role-exit",
  "--root",
  root,
  "--lease-id",
  executorLease.leaseId,
  "--reason",
  "executor returned structured claims"
]);
assert(executorExit.status === "closed", "Manager should close the executor lease");

const readAfterLeaseClose = hook(root, {
  agent_type: "executor",
  agent_id: "agent-executor-1",
  tool_name: "Read",
  tool_input: { file_path: path.join(root, "src", "allowed.txt") }
});
assert(denied(readAfterLeaseClose), "role reads must fail closed after lease closure");

const mismatchedReport = local(["role-report-save", "--root", root], {
  schema: "nogra.role.report.v1",
  runId: dispatch.runId,
  briefId: "brief-another-revision",
  leaseId: executorLease.leaseId,
  role: "executor",
  status: "blocked",
  summary: "Mismatched boundary fixture.",
  claims: [],
  evidenceIds: [],
  filesChanged: [],
  requestedProbes: [],
  scopeCheck: { status: "blocked", checkedPatterns: [], deviations: [] },
  mutationAttempted: false,
  recommendation: "none",
  reason: "Fixture mismatch.",
  generatedAt: new Date().toISOString(),
  nextOwner: "Manager"
});
assert(mismatchedReport.status === "blocked" && String(mismatchedReport.error).includes("boundary mismatch"), "mismatched role report identity must fail closed");

const outOfScopeReport = local(["role-report-save", "--root", root], {
  runId: dispatch.runId,
  leaseId: executorLease.leaseId,
  role: "executor",
  status: "partial",
  summary: "An invalid report names an out-of-scope file.",
  claims: [],
  evidenceIds: [],
  filesChanged: ["src/outside.txt"],
  requestedProbes: ["Run the role isolation smoke."],
  scopeCheck: {
    status: "deviation",
    checkedPatterns: ["src/allowed.txt"],
    deviations: ["src/outside.txt is outside scope"]
  },
  mutationAttempted: false,
  recommendation: "none",
  reason: "The claimed file is outside scope.",
  generatedAt: new Date().toISOString(),
  nextOwner: "Manager"
});
assert(outOfScopeReport.status === "blocked" && String(outOfScopeReport.error).includes("outside"), "out-of-scope executor report must fail validation");

const executorReport = local(["role-report-save", "--root", root], {
  schema: executorHandoff.roleReport.template.schema,
  reportId: executorHandoff.roleReport.template.reportId,
  workspaceId: executorHandoff.roleReport.template.workspaceId,
  runId: dispatch.runId,
  briefId: brief.briefId,
  leaseId: executorLease.leaseId,
  role: "executor",
  status: "partial",
  summary: "Scoped implementation claims returned; Manager probe is pending.",
  claims: [{
    claim: "Only the approved file was addressed.",
    verificationStatus: "claimed",
    evidenceIds: []
  }],
  evidenceIds: [],
  filesChanged: ["src/allowed.txt"],
  requestedProbes: ["Run node scripts/smoke-role-isolation-v1.mjs."],
  scopeCheck: {
    status: "met",
    checkedPatterns: ["src/allowed.txt", "src/escape.txt"],
    deviations: []
  },
  mutationAttempted: false,
  recommendation: "none",
  reason: "Manager-owned test evidence is still pending.",
  generatedAt: new Date().toISOString(),
  nextOwner: "Manager"
});
assert(executorReport.status === "ok", "schema-valid executor report should persist");
assert(executorReport.report.recommendation === "none", "executor report cannot recommend a verdict");

const finalized = ledger(["finalize-run", "--root", root], {
  runId: dispatch.runId,
  status: "ok",
  summary: "Manager recorded the executor outcome.",
  reportText: JSON.stringify(executorReport.report, null, 2)
});
assert(finalized.status === "ok" && finalized.lifecycle === "returned", "Manager should own executor finalization");

const evidence = local(["evidence-save", "--root", root], {
  subject: "role isolation fixture",
  summary: "Manager-owned test evidence for the role isolation fixture.",
  evidenceLevel: "tested",
  producer: { type: "tool", ref: "smoke-role-isolation-v1" },
  method: { type: "test", description: "Run the bounded role isolation regression.", command: "node smoke-role-isolation-v1.mjs" },
  result: { status: "pass", exitCode: 0 },
  artifacts: [{ ref: "src/allowed.txt", mediaType: "text/plain" }],
  sourceRefs: [],
  verdictIds: [],
  runId: dispatch.runId,
  briefId: brief.briefId,
  redactions: [],
  metadata: {}
});
assert(evidence.status === "ok", "Manager should persist canonical test evidence");

const missingStructuredVerifier = local(["verify", "--root", root, "--run-id", dispatch.runId], {
  verificationRole: "nogra:verifier",
  status: "ok",
  verdict: "ship",
  summary: "Unstructured verifier claim.",
  reason: "",
  evidenceIds: [evidence.evidence.evidenceId],
  acceptance: [{ criterion: "Role isolation", status: "met" }],
  briefDeviations: [],
  decisionRequired: false
});
assert(
  missingStructuredVerifier.status === "blocked" && String(missingStructuredVerifier.error).includes("roleReportId"),
  "a claimed verifier verdict without a structured report must fail closed"
);

const verifierLease = local([
  "role-enter",
  "--root",
  root,
  "--run-id",
  dispatch.runId,
  "--role",
  "verifier"
]);
assert(verifierLease.status === "active", "Manager should enter verifier only after executor return");
assert(verifierLease.allowedTools.join(",") === "Read,Grep,Glob", "verifier operation set must be read-only");
const verifierHandoff = local(["handoff-contract", "--root", root, "--kind", "verifier", "--run-id", dispatch.runId]);
assert(verifierHandoff.roleIsolation?.expectedLeaseId === verifierLease.leaseId, "verifier handoff should bind the exact lease");
assert(verifierHandoff.roleReport?.template?.leaseId === verifierLease.leaseId, "verifier handoff should carry the exact report template");

const verifierRead = hook(root, {
  agent_type: "verifier",
  agent_id: "agent-verifier-1",
  tool_name: "Read",
  tool_input: { file_path: path.join(root, "src", "allowed.txt") }
});
assert(!denied(verifierRead), "verifier should read a workspace-local target under its active lease");

const verifierSymlinkEscape = hook(root, {
  agent_type: "verifier",
  agent_id: "agent-verifier-1",
  tool_name: "Read",
  tool_input: { file_path: path.join(root, "src", "escape.txt") }
});
assert(denied(verifierSymlinkEscape), "verifier read through an external symlink must fail closed");

const verifierShell = hook(root, {
  agent_type: "verifier",
  agent_id: "agent-verifier-1",
  tool_name: "Bash",
  tool_input: { command: "git status --short" }
});
assert(denied(verifierShell), "verifier arbitrary shell must fail closed");

const verifierWrite = hook(root, {
  agent_type: "verifier",
  agent_id: "agent-verifier-1",
  tool_name: "Write",
  tool_input: { file_path: path.join(root, "src", "allowed.txt"), content: "changed" }
});
assert(denied(verifierWrite), "verifier file mutation must fail closed");

const verifierExit = local([
  "role-exit",
  "--root",
  root,
  "--lease-id",
  verifierLease.leaseId,
  "--reason",
  "verifier returned a read-only recommendation"
]);
assert(verifierExit.status === "closed", "Manager should close the verifier lease");

const missingEvidenceReport = local(["role-report-save", "--root", root], {
  runId: dispatch.runId,
  leaseId: verifierLease.leaseId,
  role: "verifier",
  status: "ok",
  summary: "Invalid ship recommendation without evidence.",
  claims: [],
  evidenceIds: [],
  filesChanged: [],
  requestedProbes: [],
  scopeCheck: { status: "met", checkedPatterns: ["src/allowed.txt", "src/escape.txt"], deviations: [] },
  mutationAttempted: false,
  recommendation: "ship",
  reason: "",
  generatedAt: new Date().toISOString(),
  nextOwner: "Manager"
});
assert(missingEvidenceReport.status === "blocked" && String(missingEvidenceReport.error).includes("canonical evidence"), "ship recommendation without canonical evidence must fail closed");

const verifierReport = local(["role-report-save", "--root", root], {
  schema: verifierHandoff.roleReport.template.schema,
  reportId: verifierHandoff.roleReport.template.reportId,
  workspaceId: verifierHandoff.roleReport.template.workspaceId,
  runId: dispatch.runId,
  briefId: brief.briefId,
  leaseId: verifierLease.leaseId,
  role: "verifier",
  status: "ok",
  summary: "Independent read-only verification matched the approved scope and canonical test evidence.",
  claims: [{
    claim: "The strict role boundary blocks scope escape and role escalation.",
    verificationStatus: "verified",
    evidenceIds: [evidence.evidence.evidenceId]
  }],
  evidenceIds: [evidence.evidence.evidenceId],
  filesChanged: [],
  requestedProbes: [],
  scopeCheck: { status: "met", checkedPatterns: ["src/allowed.txt", "src/escape.txt"], deviations: [] },
  mutationAttempted: false,
  recommendation: "ship",
  reason: "",
  generatedAt: new Date().toISOString(),
  nextOwner: "Manager"
});
assert(verifierReport.status === "ok", `schema-valid verifier report should persist: ${JSON.stringify(verifierReport)}`);

const retryVerifierLease = local([
  "role-enter",
  "--root",
  root,
  "--run-id",
  dispatch.runId,
  "--role",
  "verifier"
]);
assert(retryVerifierLease.leaseId !== verifierLease.leaseId, "a fresh verifier pass must receive a unique lease receipt");
const retryVerifierHandoff = local(["handoff-contract", "--root", root, "--kind", "verifier", "--run-id", dispatch.runId]);
assert(
  retryVerifierHandoff.roleReport.template.reportId !== verifierReport.reportId,
  "a fresh verifier pass must not overwrite the prior structured report"
);
local([
  "role-exit",
  "--root",
  root,
  "--lease-id",
  retryVerifierLease.leaseId,
  "--reason",
  "retry identity fixture complete"
]);

const verification = local(["verify", "--root", root, "--run-id", dispatch.runId], {
  roleReportId: verifierReport.reportId,
  verificationRuntime: "smoke:read-only"
});
assert(verification.status === "ok" && verification.verdict === "ship", "Manager should be able to issue a verdict from valid structured verifier evidence");
assert(verification.verdictRecord.owner === "Manager", "canonical verdict must remain Manager-owned");
assert(verification.verdictRecord.roleReportId === verifierReport.reportId, "verdict must bind the structured verifier report");

process.stdout.write(
  `role-isolation-v1 smoke passed: leases bind agent/run/scope; executor scope/symlink escape, agent swap, control-plane write and arbitrary shell fail closed; verifier symlink read, mutation and shell fail closed; structured reports and canonical evidence gate the Manager verdict\n`
);
