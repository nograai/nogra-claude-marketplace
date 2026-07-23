#!/usr/bin/env node

import {
  hasNograConfig,
  readHookInput,
  resolveGateDecision,
  resolveProjectRoot
} from "../runtime/local/gate-decision.mjs";
import { captureLiveHookEvent } from "../runtime/local/live-log.mjs";
import { evaluateRoleToolUse, hookRole } from "../runtime/local/role-isolation.mjs";
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

const input = readHookInput();
const root = resolveProjectRoot(input);
const role = hookRole(input);

// A known Nogra role fails closed before the general convergence gate. This
// remains effective even when the parent session has broad native permissions:
// PreToolUse denial is the mechanical role boundary.
if (role) {
  let roleResult;
  try {
    roleResult = hasNograConfig(root)
      ? evaluateRoleToolUse({ root, input })
      : {
          applicable: true,
          denyEligible: true,
          shouldAsk: false,
          shouldAllow: false,
          reviewMessage: `Nogra ${role} boundary blocked this action: workspace has no local Nogra configuration`,
          action: "role-isolation",
          reason: "workspace has no local Nogra configuration"
        };
  } catch (error) {
    roleResult = {
      applicable: true,
      denyEligible: true,
      shouldAsk: false,
      shouldAllow: false,
      reviewMessage: `Nogra ${role} boundary blocked this action: role isolation failed closed (${error.message})`,
      action: "role-isolation",
      reason: error.message
    };
  }

  captureSessionAnchor(root, input, "PreToolUse");
  captureLiveHookEvent(root, input, {
    eventName: "PreToolUse",
    decision: decisionLabel(roleResult),
    action: roleResult.action || "",
    reason: roleResult.reason || ""
  });
  if (roleResult.denyEligible) {
    emitReview(roleResult);
    process.exit(0);
  }
}

// General gate errors stay silent so Claude Code's native permission system
// remains authoritative. They can never relax the fail-closed role decision
// above.
try {
  const { configured, result } = resolveGateDecision(input);
  if (!configured) {
    process.exit(0);
  }

  if (!role) {
    captureSessionAnchor(root, input, "PreToolUse");
    captureLiveHookEvent(root, input, {
      eventName: "PreToolUse",
      decision: decisionLabel(result),
      action: result.action || "",
      reason: result.reason || ""
    });
  }
  if (!result.reviewMessage) process.exit(0);
  emitReview(result);
} catch {
  process.exit(0);
}
