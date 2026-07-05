#!/usr/bin/env node

import { resolveGateDecision } from "../runtime/local/gate-decision.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";

// PermissionRequest responder: answers a permission dialog on the user's
// behalf ONLY when the same receipt check that drives the PreToolUse gate
// passes (workspace opted in via gate.autoApprove AND a valid GO receipt
// mechanically covers this action's boundary class and scope). In every
// other case — no receipt, scope miss, non-goal, opt-in disabled, or any
// error — it emits no decision so the dialog reaches the user unchanged.
// The native dialog text cannot be enriched, so this responder stays
// allow-or-silent.
try {
  const { configured, input, root, result } = resolveGateDecision();
  if (!configured || !result || !result.shouldAllow || !result.allowReason) {
    process.exit(0);
  }

  captureLiveHookEvent(root, input, {
    eventName: "PermissionRequest",
    decision: "allow",
    action: result.risk || "",
    reason: result.allowReason
  });

  const decision = { behavior: "allow" };
  const toolInput = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : null;
  if (toolInput) {
    decision.updatedInput = toolInput;
  }
  process.stdout.write(
    JSON.stringify({
      systemMessage: result.allowReason,
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision
      }
    })
  );
} catch {
  process.exit(0);
}
