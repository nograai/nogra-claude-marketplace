#!/usr/bin/env node
// Nogra — the BOOT ORDER, bound. (The covenant's own rule, applied to booting:
// "an agreement that lives in one session is a mood — the good partner has to boot
// every time, not be hoped for.")
//
// When a workspace has existing Nogra state (a checkpoint exists), every session —
// regardless of which model answers — gets the ground order injected at start. Not as
// a suggestion buried in docs the session may skip, but as boot context it must hold.
// Static text, cache-safe. Silent on fresh workspaces (no state = nothing to resume).
// Fail-safe: any error emits nothing and never breaks session start.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context || "" },
    }),
  );
}

const ORDER = `<nogra-boot-order>
This workspace has existing state — you are RESUMING work, not starting fresh. Before you
propose or build anything, ground in this order (regardless of which model is answering):
1. .nogra/state/SESSION-CHECKPOINT.md and CURRENT-TASKS.md — the projections of where work stands.
2. The ledger tail (.nogra/ledger/) — the truth; if a projection disagrees, the ledger wins.
3. The pinned user profile and memory index already in your context — honor them; do not rediscover the person.
4. THE STANDING AGREEMENT for whatever you are about to touch: the brief, the plan, the
   drawing. Read it before building on it. Yesterday's agreement is law until the operator
   changes it — a GO on planned work inherits the plan and NEVER authorizes shortcuts around it.
If you act before these reads, say so honestly. One green box never auto-approves the rest
of the task list. The drawings are law; you are the builder, not an echo.
</nogra-boot-order>`;

try {
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const hasState = existsSync(join(root, ".nogra", "state", "SESSION-CHECKPOINT.md"));
  emit(hasState ? ORDER : "");
} catch {
  emit("");
}
