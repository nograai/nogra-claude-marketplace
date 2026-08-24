#!/usr/bin/env node

// Effect-aware gate classification regression.
// The fixtures are derived from the 2026-07-26 Civica dogfood journal.
// They prove that inert shell payload text, help and dry-run commands do not
// masquerade as external mutation while real mutation remains gated.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const preToolUseHook = path.join(pluginRoot, "hooks", "pre-tool-use.mjs");
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`effect-aware-command-risk: ${message}`);
  checks += 1;
}

function run(root, command, sessionId) {
  const output = execFileSync(process.execPath, [preToolUseHook], {
    cwd: root,
    input: JSON.stringify({
      cwd: root,
      workspace_roots: [root],
      tool_name: "Bash",
      tool_input: { command },
      session_id: sessionId,
      transcript_path: path.join(root, `${sessionId}.jsonl`)
    }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot
    }
  });
  return output.trim() ? JSON.parse(output) : {};
}

function reason(output) {
  return String(
    output.hookSpecificOutput?.permissionDecisionReason ||
      output.systemMessage ||
      ""
  );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nogra-effect-risk-"));
try {
  fs.mkdirSync(path.join(root, ".nogra"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".nogra", "config.json"),
    `${JSON.stringify({
      schema: "nogra.workspace.config.v1",
      workspaceId: "effect-risk-smoke",
      installMode: "plugin",
      connectionMode: "local"
    }, null, 2)}\n`,
    "utf8"
  );

  const dryRun = run(
    root,
    "npx wrangler deploy --dry-run --outdir /tmp/nogra-dry-run",
    "effect-risk-dry-run"
  );
  assert(Object.keys(dryRun).length === 0, "Wrangler dry-run must not be production deploy");

  const help = run(
    root,
    "vercel deploy --help",
    "effect-risk-help"
  );
  assert(Object.keys(help).length === 0, "Vercel deploy help must stay read-only");

  const checkpointHeredoc = run(
    root,
    [
      "python3 - <<'PY'",
      "text = '''boligscout.vercel.app remains unchanged",
      "cleanup of temp/deploy/secret artifacts happens later'''",
      "print(text)",
      "PY",
      "echo checkpoint inspected"
    ].join("\n"),
    "effect-risk-heredoc"
  );
  assert(
    Object.keys(checkpointHeredoc).length === 0,
    "inert heredoc prose must not become a production deploy"
  );

  const readOnlyCustomerText = run(
    root,
    "grep -RInE 'customer|email|send|create|delete' .nogra/state",
    "effect-risk-readonly-customer"
  );
  assert(
    Object.keys(readOnlyCustomerText).length === 0,
    "read-only search terms must not become a billing action"
  );

  const quotedDestructiveText = run(
    root,
    "printf '%s\\n' 'rm -rf /tmp/example'",
    "effect-risk-quoted-rm"
  );
  assert(
    Object.keys(quotedDestructiveText).length === 0,
    "quoted rm text must not become a destructive action"
  );

  const deploy = run(
    root,
    "npx wrangler deploy",
    "effect-risk-real-deploy"
  );
  assert(
    reason(deploy).includes("Nogra check: production deploy"),
    "real Wrangler deploy must remain gated"
  );

  const shellHeredocDeploy = run(
    root,
    ["bash <<'SH'", "npx wrangler deploy", "SH"].join("\n"),
    "effect-risk-shell-heredoc-deploy"
  );
  assert(
    reason(shellHeredocDeploy).includes("Nogra check: production deploy"),
    "an executable shell heredoc must keep its real effects gated"
  );

  const vercelProd = run(
    root,
    "vercel --prod",
    "effect-risk-vercel-prod"
  );
  assert(
    reason(vercelProd).includes("Nogra check: production deploy"),
    "real Vercel production promotion must remain gated"
  );

  const billing = run(
    root,
    "stripe customers create --email test@example.com",
    "effect-risk-real-billing"
  );
  assert(
    reason(billing).includes("Nogra check: customer/billing action"),
    "real Stripe customer creation must remain gated"
  );

  const destructive = run(
    root,
    "rm -rf /tmp/nogra-effect-risk-target",
    "effect-risk-real-rm"
  );
  assert(
    reason(destructive).includes("Nogra check: destructive rm"),
    "real recursive forced removal must remain gated"
  );

  console.log(`effect-aware-command-risk smoke passed: ${checks} checks`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
