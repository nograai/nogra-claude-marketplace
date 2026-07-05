#!/usr/bin/env node

import { resolveGateDecision } from "../runtime/local/gate-decision.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";
import { captureSessionAnchor } from "../runtime/local/session-anchor.mjs";

function emitReview(result) {
  if (!result.reviewMessage) return;
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    additionalContext: result.reviewMessage
  };
  if (result.denyEligible) {
    hookSpecificOutput.permissionDecision = "deny";
    hookSpecificOutput.permissionDecisionReason = result.reviewMessage;
  } else if (result.shouldAsk) {
    hookSpecificOutput.permissionDecision = "ask";
    hookSpecificOutput.permissionDecisionReason = result.reviewMessage;
  } else if (result.shouldAllow && result.allowReason) {
    // Receipt-driven auto-approval: only reachable when the workspace opted in
    // (gate.autoApprove) and a valid GO receipt mechanically covers this
    // action's boundary class and scope. 'allow' bypasses Claude Code's
    // permission prompt.
    hookSpecificOutput.permissionDecision = "allow";
    hookSpecificOutput.permissionDecisionReason = result.allowReason;
  }
  process.stdout.write(
    JSON.stringify({
      systemMessage: result.reviewMessage,
      hookSpecificOutput
    })
  );
}

function decisionLabel(result) {
  if (result.denyEligible) return "deny";
  if (result.shouldAsk) return "ask";
  if (result.shouldAllow) return "allow";
  return result.reviewMessage ? "review" : "silent";
}

// Error direction: any failure in the gate must emit no decision (silent
// exit 0) so the native permission system stays in charge — never allow.
try {
  const { configured, input, root, result } = resolveGateDecision();
  if (!configured) {
    process.exit(0);
  }

  captureSessionAnchor(root, input, "PreToolUse");

  captureLiveHookEvent(root, input, {
    eventName: "PreToolUse",
    decision: decisionLabel(result),
    action: result.action || "",
    reason: result.reason || ""
  });
  if (!result.reviewMessage) {
    process.exit(0);
  }

  emitReview(result);
} catch {
  process.exit(0);
}
