#!/usr/bin/env node

// Boot-context visibility smoke: a standing gate delegation must
// never be ambient. When gate.autoApprove is
// ON in .nogra/config.json, the cache-safe boot context names the enabled
// delegation on a gateDelegations line; when it is off (the default) the
// rendered output is byte-identical to the pre-change baseline — no cache
// invalidation and no behavior change for default workspaces. The line
// derives only from config.json: ledger, transport and runtime state must
// never influence the cache-safe render. Temp fixture workspaces only; never
// touches real workspace .nogra state; zero live model calls.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderCacheSafeConvergenceGuardContext } from "../runtime/local/convergence-guard.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function makeWorkspace(name, gate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `nogra-gate-visibility-${name}-`));
  const config = {
    schema: "nogra.workspace.config.v1",
    workspaceId: `gate-visibility-${name}`,
    installMode: "plugin",
    connectionMode: "local"
  };
  if (gate !== undefined) {
    config.gate = gate;
  }
  writeJson(path.join(root, ".nogra", "config.json"), config);
  return root;
}

// Pre-change baseline of renderCacheSafeConvergenceGuardContext under default
// config, captured byte-for-byte on 2026-07-03 BEFORE the Phase 3 visibility
// clause landed. Default workspaces must keep rendering exactly this.
function baselineContext(root, eventName) {
  return [
    "<NOGRA_CONVERGENCE_GUARD>",
    "Nogra convergence: user intent and Claude action meet in Nogra before git/action risk.",
    "cacheSafe=true",
    `event=${eventName}`,
    `workspaceRoot=${path.resolve(root)}`,
    "briefIsNotGO=true",
    `compactionDriftBoundary=${eventName === "PostCompact" ? "true" : "false"}`,
    "driftGuards=A:speed-before-intent,B:no-fabricated-grounding,C:preserve-provenance,D:respect-brief-contract,E:wait-for-explicit-GO,F:no-manufactured-friction,G:no-bad-evidence-through,H:answer-the-ask",
    "riskBoundaries=git-history,destructive-write,production-deploy,data-migration,secrets,permissions,billing,customer-send",
    "stateInstruction=Read project-local .nogra/state files, /nogra:status, and current git state before current-state claims.",
    "rule=If a risk boundary has no current dispatch receipt, stop before the tool call and ask for explicit intent/GO or create/dispatch a Nogra brief.",
    "</NOGRA_CONVERGENCE_GUARD>"
  ].join("\n");
}

// Expected ON output: exactly the baseline plus one gateDelegations line
// directly after briefIsNotGO=true — nothing else may move or change.
function expectedWithDelegations(root, eventName, delegations) {
  const lines = baselineContext(root, eventName).split("\n");
  const anchor = lines.indexOf("briefIsNotGO=true");
  assert(anchor !== -1, "baseline must contain the briefIsNotGO anchor line");
  lines.splice(anchor + 1, 0, `gateDelegations=${delegations}`);
  return lines.join("\n");
}

function render(root, eventName = "SessionStart") {
  return renderCacheSafeConvergenceGuardContext({ root, eventName });
}

function main() {
  const cleanupRoots = [];
  const track = (root) => {
    cleanupRoots.push(root);
    return root;
  };

  // --- Case 1: default config (no gate key) -> byte-identical to the
  // pre-change baseline, for both boot events.
  const defaultWs = track(makeWorkspace("default"));
  assert(render(defaultWs, "SessionStart") === baselineContext(defaultWs, "SessionStart"), "default config must render the cache-safe context byte-identical to the pre-change baseline (SessionStart)");
  assert(render(defaultWs, "PostCompact") === baselineContext(defaultWs, "PostCompact"), "default config must render the cache-safe context byte-identical to the pre-change baseline (PostCompact)");

  // --- Case 2: explicitly-off opt-ins render exactly like the default —
  // OFF is byte-absent, not "off"-labeled.
  const explicitOffWs = track(makeWorkspace("explicit-off", {
    mode: "advisory",
    autoApprove: false
  }));
  assert(render(explicitOffWs) === baselineContext(explicitOffWs, "SessionStart"), "explicitly-off gate opt-ins must stay byte-identical to the baseline");

  // Legacy string gate form ("hard") carries no opt-in and must stay baseline.
  const legacyWs = track(makeWorkspace("legacy-string", "hard"));
  assert(render(legacyWs) === baselineContext(legacyWs, "SessionStart"), "legacy string gate config must stay byte-identical to the baseline");

  // Ambiguous opt-in values (non-boolean) parse as OFF and stay baseline.
  const fuzzyWs = track(makeWorkspace("fuzzy", {
    mode: "advisory",
    autoApprove: "true"
  }));
  assert(render(fuzzyWs) === baselineContext(fuzzyWs, "SessionStart"), "ambiguous (non-boolean) opt-in values must parse as OFF and stay byte-identical to the baseline");

  // --- Case 3: the opt-in ON is named.
  const autoWs = track(makeWorkspace("auto", { mode: "advisory", autoApprove: true }));
  const autoRendered = render(autoWs);
  assert(autoRendered.includes("\ngateDelegations=autoApprove\n"), "autoApprove ON should surface gateDelegations=autoApprove in the cache-safe context");
  assert(autoRendered === expectedWithDelegations(autoWs, "SessionStart", "autoApprove"), "autoApprove ON should change the baseline by exactly one gateDelegations line");

  // --- Case 4: config.json is the ONLY source. Ledger, transport and
  // runtime state must never change the cache-safe render.
  writeJson(path.join(autoWs, ".nogra", "transport", "runs", "transport-gate-visibility-live.json"), {
    runId: "transport-gate-visibility-live",
    briefId: "brief-gate-visibility",
    status: "queued",
    nextOwner: "nogra:executor",
    updatedAt: new Date().toISOString(),
    authorizedBoundaries: ["production-deploy"],
    scope: ["vercel --prod"]
  });
  fs.mkdirSync(path.join(autoWs, ".nogra", "ledger"), { recursive: true });
  fs.writeFileSync(path.join(autoWs, ".nogra", "ledger", "events.jsonl"), `${JSON.stringify({ event: "test" })}\n`, "utf8");
  writeJson(path.join(autoWs, ".nogra", "runtime", "active-intent.json"), {
    schema: "nogra.activeIntent.v1",
    status: "active",
    objective: "Visibility smoke dynamic-state fixture.",
    gate: { authorize: ["production-deploy"] }
  });
  assert(render(autoWs) === autoRendered, "ledger/transport/runtime state must never change the cache-safe boot context (config.json is the only permitted source)");

  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("gate visibility smoke passed: default and explicit-off render byte-identical to the pre-change baseline, the enabled delegation is named via gateDelegations, ambiguous values parse as OFF, dynamic state never leaks into the cache-safe boot context");
}

main();
