# Claude Code convergence — 2.1.251 (2026-08-31)

Read of the upstream changelog against the candidate, prioritized. Each item names the
platform change verbatim-close, what it means for Nogra, and the concrete next step.
Watermark: `claude-changelog-seen.json` lastSeen 2.1.251.

## P1 — enforceable laws (new hook events)

### PreModelSwitch / PostModelSwitch
Platform: "Added `PreModelSwitch` and `PostModelSwitch` hook events (block, confirm, or
annotate a model switch)."
Nogra: the pinned-model law (dayclose: "unattended seats run pinned or not at all") has
been convention-only — a rule in prose that nothing enforced. A PreModelSwitch hook can
carry it: annotate every switch into the ledger, and (workspace-config-gated) require
confirmation when an unattended session tries to leave its pinned model.
Docs verified 2026-08-31: event names and matcher (matches the canonical name of the
model being switched to) are documented; PreModelSwitch can return `permissionDecision`
allow/deny/ask (ask only in interactive `/model`, refusal elsewhere; 30s default
timeout). The **full stdin payload schema is not in the public guide** — so the
candidate does not guess field names. Shipped instead: both events are registered on
the generic payload-agnostic observer (`observe-event.mjs`), so every model switch is
MEASURED into the live-hook log from the first occurrence. Enforcement
(`hooks/model-switch.mjs`, workspace-gated `modelPolicy`) comes only after a real
payload has been observed — measure before you enforce. Never block by default: Nogra
invites, it does not enforce.

### SessionStart resume: staleness + re-cache cost
Platform: "SessionStart resume hooks now receive session staleness and the estimated
re-cache cost."
Nogra: the ground law ("on drift, run /nogra:ground") gets a measurable trigger — a
stale resume is exactly when projections may lag the ledger. boot-order.mjs can read the
staleness field and strengthen its nudge instead of nudging identically always.
Docs check 2026-08-31: the staleness/re-cache fields are **not yet in the public hook
docs** — the observer registration above will capture the real resume payload, and the
boot-order read is built from that observation, not from a guessed field name.

## P2 — platform now carries what we worked around

- **Chrome actions now always go through Claude Code's permission checks.** The
  two-eyes entry policy (extension = gate's eye, Playwright = builder's eye) gains
  platform enforcement underneath; document in the workspace guidance, no code.
- **Plugin commands pointing outside the plugin dir are rejected (path traversal).**
  Candidate manifest audited 2026-08-31: no `..` or absolute paths. Keep it that way —
  the platform now fails loudly instead of silently following.
- **Background sessions could start without plugin skills during a concurrent
  marketplace refresh (fixed upstream).** This matches the house's 24/08 "plugin was
  silently off" incident class. No workaround ships in the candidate; note kept here so
  nobody reintroduces one.

## P3 — doc and ceremony opportunities

- **`claude attach/logs/stop/respawn` are now first-class.** The shift ceremony
  (nightclose → daystart, card 141 in the house) can name exact commands for session
  handover instead of prose.
- **Teammate final answers now arrive in idle notifications; subagent senders are
  framed as in-session workers.** Transport/dispatch docs can drop defensive wording
  about lost teammate answers.
- **`/cost` exposes a `prompt_cache` object and spend-limit fields.** The statusline
  projection could surface cache health next to bridge/dirty state — optional, low.
- **`CLAUDE_CODE_SUBAGENT_MODEL` is now a default, not an override.** CORRECTED 0.9.8
  (measured, not assumed): the role agents carry NO `model:`/`effort:` frontmatter, on
  purpose — `smoke-local-runtime` pins "executor role frontmatter should not hardcode
  model". Authority for the role model is the plugin runtime profile (`/nogra:settings`,
  `RELEASE_RUNTIME_FALLBACK`: executor sonnet / verifier opus, cross-model verify) plus
  Claude Code's live `/model`. Consequence to know: with no frontmatter model, a set
  `CLAUDE_CODE_SUBAGENT_MODEL` (or `_FORCE`, 2.1.257) governs every role — the dispatch
  receipt must keep naming the resolved runtime so the operator can see it.

## Changelog form convergence

Upstream keeps one entry per released version, verb-first, one line per change.
Candidate gap found during this read: version 0.9.7 shipped with the changelog stopping
at 0.9.5 — 0.9.6 and 0.9.7 entries were backfilled from the release commits in the same
sweep as this document. Standing rule going forward: **no version bump without its
changelog entry in the same commit** (upstream's discipline, adopted).
