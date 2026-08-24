#!/usr/bin/env node

// nogra-grant — the deterministic hand for ask-grants: bind the operator's
// LITERAL words to ONE boundary class on the running intent, with optional
// scope and TTL. No prompt is ever read or scored here; the ask is passed in
// verbatim by the hand that records it (the operator's /nogra:authorize, or
// the Manager after echoing the binding in chat).
//
//   nogra-grant.mjs add    --root <ws> --class <boundary> --ask "<words>" [--scope <pattern>]... [--ttl turn|next|N turns|30m|1h|1d|intent] [--by <who>] [--objective "<words>"]
//   nogra-grant.mjs list   --root <ws> [--json]
//   nogra-grant.mjs revoke --root <ws> --id <grant-id>
//   nogra-grant.mjs expire-turn --root <ws>        (what the UserPromptSubmit hook does on every operator prompt)
//
// Exit 0 on success, 2 on operator-input errors (no intent, bad ttl, missing ask).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { addGrant, expireTurnGrants, listGrants, revokeGrant } from "../runtime/local/active-intent.mjs";

function parseArgs(argv) {
  const out = { _: [], scope: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === "json") {
      out.json = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      out[key] = true;
      continue;
    }
    i += 1;
    if (key === "scope") out.scope.push(value);
    else out[key] = value;
  }
  return out;
}

function gateAutoApprove(root) {
  try {
    const file = path.join(root, ".nogra", "config.json");
    if (!existsSync(file)) return false;
    const config = JSON.parse(readFileSync(file, "utf8"));
    return Boolean(config && config.gate && config.gate.autoApprove === true);
  } catch {
    return false;
  }
}

function fail(message, payload = {}) {
  console.error(`nogra-grant: ${message}`);
  if (Object.keys(payload).length) console.error(JSON.stringify(payload));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const verb = args._[0];
const root = path.resolve(String(args.root || process.env.CLAUDE_PROJECT_ROOT || process.cwd()));
if (!existsSync(path.join(root, ".nogra"))) fail(`no .nogra workspace at ${root}`);

if (verb === "add") {
  const result = addGrant(root, {
    class: args.class || args.boundary,
    ask: args.ask,
    scope: args.scope,
    ttl: args.ttl,
    grantedBy: args.by,
    source: args.source,
    objective: args.objective
  });
  if (!result.ok) {
    const hints = {
      "no-running-intent": "no running intent — pass --objective \"<the operator's own words>\" to start a minimal one, or run /nogra:authorize",
      "bad-ttl": "ttl must be one of: intent, turn, next, N turns, 30m, 1h, 1d",
      "ask-required": "--ask \"<the operator's literal words>\" is required: the ask IS the receipt",
      "class-required": "--class <boundary> is required (e.g. destructive-write, production-deploy, git-history)",
      "never-grantable": "gate-arming can never be granted — a live human approval is the only door"
    };
    fail(hints[result.reason] || result.reason, result);
  }
  const g = result.grant;
  const auto = gateAutoApprove(root);
  const door = g.scope.length ? (auto ? "allow-capable (scope declared, gate.autoApprove on)" : "skip-only (scope declared, gate.autoApprove OFF)") : "skip-only (no scope: the gate skips its ask, never allows)";
  const ttl = g.expiresAt ? `until ${g.expiresAt}` : g.turnsLeft !== null ? `${g.turnsLeft} operator prompt(s)` : "lives with the intent";
  console.log(`Grant: ${g.id} · ${g.class} · scope [${g.scope.join(", ") || "—"}] · ttl ${ttl}`);
  console.log(`  ask: "${g.ask}"`);
  console.log(`  door: ${door}`);
  if (result.intentStarted) console.log("  intent: started minimal intent from --objective");
  console.log(`  file: ${result.path}`);
  process.exit(0);
}

if (verb === "list") {
  const state = listGrants(root);
  if (args.json) {
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }
  console.log(`intent: ${state.intentActive ? "active" : "none"} · live grants: ${state.live.length} · stored: ${state.stored.length}`);
  for (const g of state.stored) {
    const live = state.live.some((l) => l.id === g.id);
    const ttl = g.expiresAt ? `until ${g.expiresAt}` : g.turnsLeft !== null ? `${g.turnsLeft} prompt(s)` : "intent";
    console.log(`  ${live ? "●" : "○"} ${g.id} · ${g.class} · ${g.status} · ttl ${ttl} · "${g.ask}"`);
  }
  process.exit(0);
}

if (verb === "revoke") {
  const result = revokeGrant(root, args.id);
  if (!result.ok) fail(result.reason, result);
  console.log(`revoked: ${result.id}`);
  process.exit(0);
}

if (verb === "expire-turn") {
  const result = expireTurnGrants(root, { trigger: "cli" });
  console.log(`ticked ${result.changed} grant(s); expired: ${result.expired.join(", ") || "none"}`);
  process.exit(0);
}

console.error("usage: nogra-grant.mjs add|list|revoke|expire-turn --root <workspace> [...]");
process.exit(64);
