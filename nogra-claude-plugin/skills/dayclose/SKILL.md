---
name: nogra-dayclose
description: "Close the working day with measurements: sweep open threads (agents, jobs, services), stamp the day in the ledger, update all projections in the same move, run the memory write-loop, name uncommitted work, and measure everything claimed closed (Pinocchio pass). Use when the user runs /nogra:dayclose or ends the day (godnat, luk dagen, rundering)."
---

# Nogra Dayclose

The evening counterpart to the morning brief. A day that ends without a close leaves
threads that rot overnight: agents nobody remembers, services holding ports, projections
that lie by omission, and learnings that never reach memory. This skill closes the day
the way the ledger opened it — with measurements, receipts, and one honest handoff line.

The order is the order truth requires: reality first (what is actually running), then the
ledger (the only writer of "now"), then every projection in the same move, then memory,
then the final measured pass. Never stamp a close you have not measured.

## Boundary

This closes; it does not dispatch new work, does not deploy, and does not decide what
survives the night — the operator owns those judgments. It sweeps, stamps, mirrors,
files, and verifies. Anything discovered mid-close that needs building becomes a named
item in tomorrow's start-block, never tonight's detour.

## Trigger

Use this skill when the user:

- runs `/nogra:dayclose` (add `--weekly` on the weekly digest day);
- says "luk dagen", "runder af", "godnat-rutinen", "kør runderingen";
- asks for a clean shutdown of the session with nothing left behind.

## Flow

1. **Sweep the open threads — reality before paperwork.** Enumerate, with fresh tool
   measurements (never from session memory):
   - running subagents / executor sessions (codex, background Agent tasks) — a dispatch
     mid-flight blocks the close: land it and verify it, or explicitly park it with its
     resume path named in the start-block;
   - background shell jobs and waiters;
   - dev services and ports (dev servers, media origins, tunnels/serve, TUI apps) —
     compare against what the workspace's service law expects;
   - anything scheduled to wake overnight (launchd/cron). Check every survivor against
     the workspace's pinned-model law: nothing autonomous may inherit the session's
     model by default; unattended seats run pinned or not at all.
   For each thread the operator decides: STOP (then kill and MEASURE it dead) or
   deliberate overnight duty (then name why). Silence is not a decision.
2. **Stamp the day in the ledger.** One day-close event in the workspace ledger
   (`.nogra/ledger/events.jsonl`): the day's watermark span, what shipped, what was
   decided, what broke and how it was recovered, what waits on the operator. The ledger
   is the only writer of "now" — this stamp is the close; everything after it mirrors it.
3. **Update every projection in the same move.** Checkpoint gets a "TOMORROW STARTS
   HERE" block (running services, waiting decisions, resume paths). Pulse gets its EOD
   line. Task lists get synced. A projection updated tomorrow is a projection that lied
   tonight — same move, no exceptions.
4. **Run the memory write-loop — measure the window first.** Before deciding what to write,
   measure what memory already carries:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" status --root "<absolute-workspace-root>"
   ```

   The board says whether MEMORY.md is inside its load window, how far `brain/` is behind the
   ledger, and whether the valve has an unanswered `consolidation_due`. If the verdict is over
   the window, OFFER `/nogra:brain consolidate` — never run it inside the close, and never
   without the operator's GO. Then do the write-loop itself: what did today teach that outlives
   today? New laws, corrections, adopted patterns → memory files per the workspace write-loop;
   update the index. Skip what the repo already records. If the operator anchored something today
   ("gem den", "lås den"), confirm it actually landed.
5. **Inbox hygiene.** Triage what landed today (screenshots, drops): file, reference, or
   archive. Artifacts produced today (reports, prompts, logs in the out-tray) get named
   in the checkpoint so tomorrow finds them.
6. **Git honesty.** For every repo touched today: name the uncommitted state explicitly —
   committed (with sha), or PARKED with a reason and an owner. Never leave a dirty tree
   unnamed. Do not commit as part of the close unless the operator says so.
7. **Refresh the Paper's "Lige nu" — the last projection before the measured close.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-now.mjs" --root "<absolute-workspace-root>"
   ```

   It measures (ledger, doors, open decisions, newest finds) and rewrites the page between its
   markers. Run it AFTER the ledger stamp and the projections, so the page mirrors the day that
   just closed and not the one that was still running. A workspace with no `paper` key exits 2
   with one line — note it and move on; it never blocks the close. Tell the operator the page
   was refreshed and still needs their republish.

8. **The Pinocchio pass — measure everything claimed closed.** Last step, always:
   processes claimed dead are measured dead (ps/port checks), services claimed stopped
   answer nothing, stamps claimed written are read back, the checkpoint block exists.
   An absence stated as fact without a measurement is the exact failure this pass
   exists to catch. Only after this pass: report the close in one compact block and
   hand the operator the good-night line.

Finally, leave **one handoff line** where the morning routine (morgenbrief) reads first —
yesterday's close is tomorrow's opening context.

## Weekly digest (`--weekly`)

On the designated day (or when the operator asks), extend the close with a week-level
distillation — pull-first, downstream of the ledger, never a competing authority:

1. Read the week's ledger span and day-close stamps.
2. Distill into the knowledge vault (`brain/log.md` week entry; wiki pages only where a
   doctrine actually changed).
3. **Measure the north star.** If the workspace has a standing goal with a metric (e.g.
   a growth target), measure the week's actual numbers against it and write the delta
   into the digest — evidence accumulating week by week, not adjectives.
4. Name the week's biggest correction (what we stopped doing) — that is usually worth
   more than the feature list.

## Honesty rules

- Never close over a running dispatch without an explicit park decision.
- Never write "stopped/clean/done" for anything you did not measure this session.
- Never predict what happens after close as if it were fact. "Drains by itself",
  "will retire overnight", "resolves on the next run" are claims about the
  future — they require a mechanism receipt (a test name, a queue entry, a
  scheduled job) or they are written as an OPEN item. The first live run proved
  this: a "drains by itself" line survived the close and was false by morning.
- The close report states what remains OPEN just as prominently as what closed —
  a clean shutdown with named leftovers beats a "perfect" one that hides them.
