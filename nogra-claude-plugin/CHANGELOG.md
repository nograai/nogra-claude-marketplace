# Changelog

## 0.7.4 - 2026-07-06

- Closed the memory loop with self-learning: the scaffolded CLAUDE.md now instructs Claude to write a
  one-line lesson to MEMORY.md whenever it is corrected or catches its own mistake, so the bounded
  memory improves every session — self-learning, but bounded (lessons consolidate, never pile up).

## 0.7.3 - 2026-07-05

- Added a bounded memory layer: .nogra/memory/local/MEMORY.md (<=2200 chars) and USER.md
  (<=1375) load into every session deterministically via a SessionStart hook; the bound is
  enforced on read (oldest content drops when full). Claude does the remembering; Nogra owns
  the bound. Self-contained (no extra runtime).

## 0.7.2 - 2026-07-05

- Removed the clickable `[Open brief](file://...)` link from the brief approval
  flow: Claude Code's file viewer excludes hidden dot-directories, so a link
  into `.nogra/` can never open — it was a promise no click could keep. The
  brief stays in `.nogra/briefs/` (trust-state, not relocated); the inline
  approval artifact is the review surface, and the brief is referenced by id
  with its path as plain code text.
- Docs: the MCP layer section now reflects the npx-first launcher (Node/npx is
  always present, so no uv/Python is required) — matching the shipped behavior.

## 0.7.1 - 2026-07-05

- Fixed: the brain-init skill + contracts (skills/brain-init/, contracts/brain-init/)
  were dropped from the 0.7.0 marketplace build; /nogra:brain-init now works on a fresh install.

## 0.7.0 - 2026-07-04

- Fresh installs now scaffold a **thin hub by default**: empty `inbox/` and
  `projects/` folders (each a single `.gitkeep`) land next to `.nogra/` and
  root `CLAUDE.md`, so incoming files and hub sub-projects have a home from
  day one. Same `create_if_missing` convention as the other lanes; existing
  folders are never touched.
- Added the **`/nogra:brain-init` skill**: scaffolds an opt-in empty `brain/`
  knowledge vault (`raw/`, `wiki/`, `index.md`, thin pull-first
  `brain/CLAUDE.md`) on demand via the local runtime's new `brain-init`
  command. Never created by setup, never auto-loaded, idempotent — a second
  run preserves everything and writes nothing. Setup output and the shipped
  workspace `CLAUDE.md` mention it in one line each.
- Trimmed the shipped workspace `CLAUDE.md` (143 -> 93 lines) and
  `.nogra/README.md` (21 -> 12 lines) to minimum lines without dropping any
  rule.
- Added the **MCP bridge**: the plugin now carries Nogra's own MCP server with
  it. A plugin-root `.mcp.json` registers the server automatically on install,
  exposing the 32 public tools (briefs, transport, registry, events, redaction)
  in public mode — private/dev-lane tools are excluded at the server boundary.
  The server ships separately as `nogra-mcp` on PyPI; the plugin only points at
  it, it does not vendor it.
- Added the **MCP launcher** (`scripts/mcp-launcher.mjs`) between `.mcp.json`
  and the server: resolves a runner from PATH — `npx` first, `uvx` second,
  `pipx` third — and when none exists prints exactly one instruction line on
  stderr and exits non-zero. `npx` is tried first because Node (and therefore
  `npx`) is always present wherever Claude Code runs, while `uv`/`pipx` are
  not; npm's `@nograai/mcp` ships standalone platform binaries, so the npx
  rung needs no Python at all. `uvx`/`pipx` remain as fallbacks for the PyPI
  `nogra-mcp` package. It never auto-installs anything and never touches the
  network itself; signals are forwarded and the server's exit code passes
  through on every rung.
- Added a **verify-nudge config toggle**: `verifyNudge: "off"` in
  `.nogra/config.json` turns the observe-only Stop nudge off for that
  workspace. An OFF switch, not an amputation — the default stays ON for every
  install, the hook stays fail-open, and only the exact value `"off"` disables
  it.
- Added the **run-scratch WRITE-OPS coverage class** to the gate escalation
  ladder: after GO, a dispatched run's own scratch housekeeping no longer
  raises a raw operator ask. The class is a fixed allowlist of pure file-op
  binaries (`rm`, `rmdir`, `mkdir`, `mv`, `cp`, `touch`) plus direct
  `Edit`/`Write`/`MultiEdit` tool calls, and only when EVERY resolved target
  sits inside the dispatch receipt's declared `scratchRoots`. Purely
  deterministic — allowlist membership plus path containment; zero model
  judgment.
- **Exec is fail-closed**: interpreters and arbitrary binaries (`node`,
  `python3`, `sh`, `npx`, `uvx`, ...) are never eligible for run-scratch
  coverage and ask exactly as before, even when every path argument is inside
  a scratch root — an exec's effects are not bounded by its argument paths.
  Compound, piped and redirected commands are fail-closed the same way: any
  Bash command that is not a single plain invocation of an allowlisted
  write-op binary is never eligible.
- **Escape containment**: targets are `..`-normalized and symlink-normalized
  BEFORE prefix-matching against declared roots; any target resolving outside
  the roots asks, and `mv`/`cp` crossing the scratch boundary in either
  direction asks. Unresolvable tokens (`$VAR`, `~`, globs, braces) on a
  scratch path can never count as inside and ask.
- The dispatch receipt now declares a deterministic additive `scratchRoots`
  list at dispatch time: the run's own artifacts dir by default, plus any
  roots passed via the repeatable `--scratch-root` flag (normalized and
  deduped). A root that cannot be named deterministically is omitted, never
  approximated.
- **Citation surface**: every auto-approval — the existing receipt scope-match
  class AND the new run-scratch class — now carries the grep-provable citation
  `approved <action> — in scope of your GO, receipt <runId>` in its decision
  reason.
- Unchanged, locked: gate-arming/arm-self-gate (still never auto-approvable,
  still evaluated before run-scratch), non-goal precedence, hard mode,
  never-auto-approvable classes, gray-zone always-ask, and the default
  `gate.autoApprove` OFF behavior (byte-identical for default workspaces).
- Added **auto-approval** (opt-in, default OFF — `gate.autoApprove` must be
  explicitly `true`). When a tool call falls within the scope of an approved,
  active dispatch receipt, the convergence gate can let it flow instead of
  re-asking — a GO that already covers the action. Every auto-approval carries
  a citation back to its receipt; nothing is trusted, it is enforced against a
  boundary the human set in the brief. The gate is purely deterministic:
  receipt provenance decides, with zero model judgment in the decision path;
  anything outside the mechanical boundary/scope match always asks.
- Added the **arm-self-gate**: writes to `.nogra/config.json` (where standing
  delegations are armed) are *never* auto-approvable. Arming the gate always
  requires explicit human review — deterministically, regardless of any
  receipt. Elevation is never self-conferred, including elevation of the gate
  itself.
- Added **delegation visibility**: when auto-approval is enabled, the boot
  context and statusline name it (`gateDelegations`); byte-absent when off.
  A standing delegation can never be silent.

## 0.6.9 - 2026-06-26

- Added an observe-only `Stop` verify-nudge: when a session ends on a completion
  claim (verified / all passed / done / tests green / safe to merge) and no
  Nogra verification ran this session, Nogra emits one non-blocking line
  suggesting `/nogra:verify`. It never blocks the stop, never re-prompts the
  model, and fires at most once per session — a preference signal, not a gate.
- Made cross-model verify the default: under the default runtime profile the
  verifier resolves to a different model than the executor, so the "done" check
  is less likely to inherit the executor's blind spots. Claude Code's native
  `/model` remains the source of truth; pinning a single model overrides it.
- Added `/nogra:authorize` to authorize recognized action classes (e.g.
  git-history) so the convergence gate stops re-asking about an approved class;
  reversible at any time with `revoke` / `clear`.
- Corrected stale post-compact test assertions left by the 0.6.8 SessionStart
  re-homing so the smoke and routing-preconditions tests assert the shipped
  design (post-compact on the `SessionStart`/`compact` channel, `hookEventName`
  "SessionStart"); polished public docs wording. No change to published 0.6.8
  runtime behavior.

## 0.6.8 - 2026-06-19

- Normalized terminal finalize-run workspace identity so returned/cancelled
  ledger and transport events use the run/config workspace id instead of falling
  back to generic `local` when finalize input omits `workspaceId`.
- Added smoke coverage proving terminal run state, ledger events and transport
  events preserve the same workspace id.

## 0.6.7 - 2026-06-18

- Added public test isolation diagnostics for private Nogra lanes such as
  `nogra-private-beta`. Normal local dogfood remains a non-blocking warning,
  while strict public-grade mode can block private-lane collisions before a
  public plugin rehearsal is trusted.
- Documented isolated public plugin testing for users who also dogfood private
  Nogra lanes on the same machine.
- Made `SessionStart` and `PostCompact` prefix context cache-safe by removing
  per-turn ledger, checkpoint, receipt and index state from model-context hook
  output while preserving local state pointers.
- Added smoke and lifecycle coverage that proves cache-safe hook output omits
  volatile prefix fields and stays byte-identical after ledger/run mutations.
- Guided the brief skill to use main-loop `AskUserQuestion` for bounded
  risk-intake batches and route-choice questions already present in the brief
  flow.
- Kept `PreToolUse` convergence checks and execution GO behavior unchanged;
  GO remains an explicit chat act before dispatch, never a modal question.

## 0.6.6 - 2026-06-17

- Added a thin intent-router contract to help/reference docs, the bundled
  workspace `CLAUDE.md` and reviewer README: explicit Nogra intent maps to the
  matching skill, while ordinary work stays direct.
- Added Nogra match reviews at deterministic `PreToolUse` action boundaries
  without replacing Claude Code permission decisions.
- Added local live hook/event observability under `.nogra/runtime/` and
  `/nogra:watch` so operators can inspect recent Claude Code hook events without
  storing prompt bodies, tool output, file contents or full shell commands.
- Added a read-only statusline projector that reuses the local `/nogra:status`
  payload and fails open instead of maintaining separate state.
- Added deterministic review for instruction-surface writes such as `CLAUDE.md`,
  `.claude` instruction subpaths, `SKILL.md`, plugin manifests and Nogra plugin
  hooks.
- Added Nogra's five-anchor local index and status metadata for risk intake,
  behavior score, connections/risk registry, decision shape and expansion
  guidance.
- Added dispatch sizing, agentic loop return handling and plain
  partial/blocked continuation language when a runtime turn limit stops work
  before a normal executor or verifier report.
- Added skill quality gates, gotcha references and Bash-safe absolute-path
  command recipes across setup, brief, dispatch, verify, create, update and
  status flows.
- Hardened public executor/verifier Agent contracts with explicit tool
  allowlists that omit nested subagent spawn, context-bundle/prior-finding
  handoff guidance and smoke assertions for the public no-nested-spawn wall.
- Added `psql` mutation detection, read-only inspection softening, conservative
  public fetch handling and production deploy detection to the local
  convergence gate.
- Added explicit off/uninstall guidance and clarified privacy/help copy so users
  get workspace-vs-plugin answers and pull-first behavior stays clear.
- Gave user-invocable skills lowercase `nogra-*` display labels while
  preserving `/nogra:<skill>` command paths from their skill directories.
- Aligned `/nogra:status`, `/nogra:adapt`, setup files and continuity docs with
  the current `.nogra/state/*` and five-anchor local layout.
- Removed core automatic-offer scoring, sensitivity controls and the PreToolUse
  command tripwire. Nogra core is now pull-first: explicit `/nogra:*` requests
  start Nogra flows, ordinary work stays direct, and Claude Code's native
  permission model remains responsible for tool permissions.
- Simplified core hooks to session boot context and workspace-hub project
  focus only.
- Split lifecycle state across event-aware hooks: `SessionStart` no longer
  matches compact, `PostCompact` emits only a thin continuity pointer, and
  `SessionEnd` silently updates the local session anchor.
- Added init migration cleanup for obsolete automatic-offer routing controls in
  existing `.nogra/config.json` files while preserving language/runtime values.
- Removed separate brief/workspace release-version fields from fresh records,
  schemas, init config and status output. The plugin version is now the product
  release identity; schema ids remain the artifact-format contracts.

## 0.6.5 - 2026-06-08

- Added a thin intent-router contract to help/reference docs, the bundled
  workspace `CLAUDE.md` and reviewer README: explicit Nogra intent maps to the
  matching skill, while ordinary work stays direct.
- Restored the public plugin display name to lowercase `nogra workflow` across
  marketplace manifests so Claude Code menus match the intended listing label.
- Removed core automatic-offer scoring, sensitivity controls and the PreToolUse
  command tripwire. Nogra core is now pull-first: explicit `/nogra:*` requests
  start Nogra flows, ordinary work stays direct, and Claude Code's native
  permission model remains responsible for tool permissions.
- Simplified core hooks to session boot context and workspace-hub project
  focus only.
- Split lifecycle state across event-aware hooks: `SessionStart` no longer
  matches compact, `PostCompact` emits only a thin continuity pointer, and
  `SessionEnd` silently updates the local session anchor.
- Added init migration cleanup for obsolete automatic-offer routing controls in
  existing `.nogra/config.json` files while preserving language/runtime values.
- Removed separate brief/workspace release-version fields from fresh records,
  schemas, init config and status output. The plugin version is now the product
  release identity; schema ids remain the artifact-format contracts.

## 0.6.3 - 2026-06-07

- Changed brief sizing preview from a binary user prompt into a three-level
  Manager surface: `silent`, `inform`, or `ask`.
- Added Manager-owned split guidance with linked-versus-parallel criteria and
  explicit escalation criteria for when sizing must be shown to the user.
- Added `operatorDecomposed` preview deduplication so a phase that was already
  split in the same brief flow does not re-ask on coupled follow-up work, while
  clamped work still requires user confirmation.

## 0.6.2 - 2026-06-07

- Promoted the clean Continue/project-focus path validated on live BoligScout:
  workspace-hub boot stays thin, project questions use the Nogra workspace
  index, and project focus reads the selected project's local checkpoint only
  after the user chooses it.
- Extended SessionStart continuity context with ledger watermarks and checkpoint
  freshness so resumed sessions can distinguish fresh checkpoints from stale
  projections without loading full project state.
- Added local-language no-Nogra bypass handling and kept automatic Nogra offers
  advisory: scoped work stops for a brief/direct choice, while pure questions
  stay direct.

## 0.6.1 - 2026-06-06

- Added `ledger-smoke` as a bounded diagnostic command for testing local ledger
  watermarks without creating brief artifacts or touching app code.
- Clarified then-current status wording around plugin and workspace version
  fields.
- Removed blank `source` and `model` fields from session-anchor writes when the
  hook input does not provide them.

## 0.6.0 - 2026-06-06

- Updated `/nogra:status` guidance to surface local continuity migration state
  and point prior-layout workspaces at `/nogra:setup` for a merge-only layout
  update.

## 0.5.9 - 2026-06-06

- Added compatibility status for prior-layout local workspaces: missing
  `routingPolicy` and `runtimePolicy` now resolve visibly to release defaults
  instead of appearing as null runtime state.
- Added setup migration for existing checkpoints without `SourceWatermark` and
  existing workspaces without the `.nogra/ledger/` continuity lane.
- Extended local runtime smoke with a prior-layout workspace migration case.

## 0.5.8 - 2026-06-06

- Added local session continuity anchors: existing hooks capture `sessionId` and a
  transcript anchor into bounded local runtime state without reading transcript
  contents.
- Added append-only `.nogra/ledger/` events with monotonic `ledgerWatermark`
  values for brief, dispatch, verification and terminal run records.
- Added checkpoint freshness reporting by comparing checkpoint `SourceWatermark`
  with the current ledger watermark, so boot/status can detect stale projections
  deterministically.

## 0.5.7 - 2026-06-05

- Added reviewer-facing working examples and sample workspaces for Anthropic
  submission: setup, build a small local task tracker, and save a local
  checkpoint.
- Added README no-data and support guidance for the local-only plugin: no
  account, no network calls, nothing collected, stored or shared by Nogra.
- Promoted the public listing copy to `Nogra workflow` with the concise
  approve-run-verify description.

## 0.5.6 - 2026-06-05

- Added promoted brief file-link metadata so approval returns can show a bare
  `[Open brief](file://...)` markdown link with URL-encoded local paths, without
  editor-specific schemes, line-number suffixes or code-span wrapping.

## 0.5.5 - 2026-06-05

- Made local root resolution command-aware: setup commands target the requested
  directory even when a parent `.nogra/` exists, while existing workspace
  control-plane and ledger commands still resolve nested paths to the nearest
  parent `.nogra/` workspace.

## 0.5.4 - 2026-06-05

- Hardened local runtime root resolution so control-plane and ledger calls from
  nested working directories resolve to the nearest parent `.nogra/` workspace
  while fresh setup still falls back to the requested root when no `.nogra/`
  exists.

## 0.5.3 - 2026-06-05

- Promoted the reconciled runtime, setup and create-project payload under a
  fresh version key so installs already on 0.5.2 receive the routing fixes and
  expanded local workspace layout cleanly.

## 0.5.2 - 2026-06-04

- Added a read-only draft brief sizing preview before brief save/promote, so
  oversized work can be split or reduced before approval while dispatch remains
  the authority for concrete `executionMaxTurns`.

## 0.5.1 - 2026-06-03

- Added Manager-derived execution sizing after brief approval and carried the
  resulting max-turn budget through dispatch and handoff.
- Added safe-continuation reporting for pre-flight blocks, so a blocked
  executor can return the safe route without executing past the stop criterion.
- Recentered verification on independent tree/artifact/command evidence:
  executor self-reports are claim surfaces, whether complete, truncated or
  missing.

## 0.4.3 - 2026-05-28

- Lowercased the `unverified` verification verdict across dispatch and verify
  surfaces so it matches the rest of the product-surface verdict words.
- Added a verify-phase forcing reason for every non-ship verdict: what is
  missing, deviating or blocking, and what evidence would move the result to
  ship.
- Added an additive local-runtime backstop that preserves fine-grained
  `verdict` and `reason` fields on validation records and refuses to record a
  non-ship verification without a reason.

## 0.4.2 - 2026-05-28

- Reworked the README and listing hook into plain-language newcomer framing:
  approve a short plan, run it, then verify the result against that plan.
- Corrected install guidance with the real setup order, explicit Node.js 18+
  prerequisite and a setup pre-flight guard that stops cleanly before writing
  partial files when Node is unavailable.
- Made skill descriptions and runtime vocabulary more user-facing by defining
  "Manager phase", moving the sensitivity formula out of the user flow and
  keeping skill intent readable in command surfaces.
- Reconciled the brief Handoff-Line guidance with the compact approval surface
  and added a dispatch confirmation example for the reduced chat print.
- Fixed manifest metadata drift from
  `manager/nogra-public-readiness-audit-0.4.1-2026-05-28.md`: owner/author
  email now uses the Nogra domain, repository metadata points at
  `nograai/nogra-claude-marketplace`, and source/nested marketplace manifests
  use the `nogra-claude` marketplace name.

## 0.4.1 - 2026-05-28

- Tightened brief and dispatch skill output rules so full brief payloads and
  dispatch telemetry stay in local `.nogra/` artifacts while chat receives the
  compact approval or dispatch confirmation surface.
- Rephrased brief-contract guidance so the contract remains the authority for
  payload shape instead of hardcoding the public schema name in prose.
- Added a runtime-profile glossary entry to keep model/effort preferences
  distinct from the bundled local runtime scripts.

## 0.4.0 - 2026-05-27

- Promoted the Brief #4 structural release: removed the default statusline
  bundle, offer skill and playbook/version-field surfaces from the plugin
  payload while keeping `/nogra:status` available.
- Split dense skill material into references for setup, status, brief and
  dispatch guidance, reducing default skill-body load without removing the
  underlying workflow contracts.
- Kept toggle handling mechanical through `/nogra:on` and `/nogra:off`, with
  hooks surfacing visible context while skills own config writes.
- Applied contextual Manager-role wording so internal phase guidance is precise
  while agent-facing role anchors remain addressable.

## 0.3.5 - 2026-05-27

- Cleaned live wording surfaces across README, setup, adapt, settings, help,
  routing, brief, dispatch, verify and statusline guidance.
- Removed hardcoded sensitivity-step examples, duplicate verification wording,
  deploy from the offer topic gate, provider-specific brand leakage and
  internal claim-strength vocabulary from user-facing guidance.
- Rephrased defensive copy into positive user-facing instructions while keeping
  Nogra's explicit brief, dispatch, evidence and verification behavior intact.

## 0.3.4 - 2026-05-26

- Fixed preflight guard integrity: natural-language guard assertions now run
  case-insensitively, while canonical `NOGRA_*` symbol checks remain
  case-sensitive.
- Re-ran the hardened guard and cleaned setup/help/runtime wording that the
  previous case-sensitive modal phrase check missed.
- Extended negative-test discipline to cover lowercase, sentence-start-capital
  and uppercase variants for natural-language guard patterns.

## 0.3.3 - 2026-05-26

- Added glossary definition of "local runtime" in
  `skills/help/references/runtime.md`: local runtime means the plugin-bundled
  scripts under `scripts/` that maintain `.nogra/` workspace state.
- Standardized vocabulary: replaced redundant "plugin-local runtime" with
  canonical "local runtime" across skills, contracts and hooks. The
  plugin-bundling is implicit in the defined term.
- Extended preflight checks to enforce no bare "plugin-local runtime" in public
  docs mechanically.

## 0.3.2 - 2026-05-26

- Removed internal-experimental vocabulary from public skill docs: persona and
  research references in `skills/verify/SKILL.md` replaced with neutral
  equivalents.
- Swept skill, contract, agent, and hook docs for other persona-names,
  research terms, private evaluation vocabulary, and project-codename leaks;
  applied fixes where found.
- Extended preflight checks to enforce no-internal-experimental-vocab in public
  docs mechanically, excluding CHANGELOG, LICENSE and NOTICE historical
  exemptions.

## 0.3.1 - 2026-05-26

- Polished README copy doctrine: replaced defensive "does not X" and
  "without Y" framings with positive-form descriptions. Same information, no
  implicit alternative suggestion.
- Removed "local runtime" jargon in favor of three-primitive framing ("brief,
  dispatch, verify, plus the local .nogra/ ledger"). Matches nogra.ai landing
  vocabulary.
- Removed internal hook-context symbol from public README; replaced it with
  neutral "judgment-fallback marker" description.
- Extended preflight checks to enforce no-symbol-leak, no-modal-scare-phrases,
  and no-known-defensive-patterns mechanically.

## 0.3.0 - 2026-05-26

- Renamed the setup command to `/nogra:setup` to avoid collision with Claude
  Code's built-in setup command in the autocomplete picker. The new setup
  command writes `.nogra/config.json` plus `CLAUDE.md`; project-state
  templates moved to `/nogra:adapt` time-of-need generation per Item 1.10
  scope split.
- Added NOTICE file for explicit attribution per Apache 2.0 section 4(d).
- Polished stable copy: removed backward-compat scare framing from README,
  removed internal tooling names from public changelog, and confirmed skills do
  not lead with local-mode wording.
- Dampened statusline orange saturation from xterm-208 to xterm-214.
- Extended preflight checks to enforce NOTICE-required, setup-rename-applied,
  no internal tooling-name leak, and no backward-compat scare-language
  mechanically.

## 0.2.9 - 2026-05-26

- Changed the PreToolUse offer guard from hard `deny` to native
  `permissionDecision: "ask"` so Claude Code asks the user before continuing
  direct instead of surfacing a tool error to Claude.
- Made the PreToolUse prompt ask once per routed prompt by recording the ask in
  local routing telemetry, preventing repeated permission prompts on every
  subsequent tool call for the same user request.
- Removed hook-owned writes and `decision: "block"` from `/nogra:on` and
  `/nogra:off` routing hooks. Hooks now only add visible context; the on/off
  skills own `.nogra/config.json` updates and user-visible confirmation.

## 0.2.8 - 2026-05-25

- Removed internal budget config detail from README runtime examples while
  keeping detailed settings reference docs available through `/nogra:help`.
- Polished stable copy: removed defensive statusline framing and internal
  dev-state language from README; lowercased plugin displayName values for
  visual consistency with other Claude Code plugins.
- Aligned routing sensitivity language with the HIT-drop doctrine: skill
  descriptions and README skill listings now refer to sensitivity, while HIT
  telemetry remains development-only behind `NOGRA_STATUSLINE_DEBUG=1`.
- Extended preflight checks to enforce no connector language, no
  dev-state leak, lowercase displayName values, and no sensitivity-metric
  jargon in public docs.
- Removed tier-language and Manager/Nogra category-conflation from stable copy.
  Identity-anchor in init-bundle CLAUDE.md now says "user's Manager" with
  Manager as chat-layer role and Nogra as workspace discipline.
- Extended preflight checks to mechanically enforce no forbidden
  compound concepts, no CLAUDE.md self-licensing language, and canonical
  Manager identity-anchor phrasing.
- Trimmed init-bundle CLAUDE.md template to identity-only content. Routing
  thresholds, runtime preferences and status reporting mechanics moved to
  plugin reference docs accessible via `/nogra:help`.
- Extended preflight checks to enforce CLAUDE.md template stays
  config-schema-free.
- Removed orphan optional renderer references from stable manifest and docs;
  the renderer feature is not shipped in this release.
- Extended preflight checks to enforce manifest file references resolve
  to existing files, preventing future orphan-reference drift.
- Removed the HIT% telemetry metric from default statusline output to keep the
  user surface clean. HIT% remains available behind
  `NOGRA_STATUSLINE_DEBUG=1` for development; the telemetry layer is tracked
  separately and not relied on by default surfaces.
- Hardened the Nogra offer guard so promptless `PreToolUse` events still stop
  first tool use when the previous user prompt triggered a brief/direct offer.
- Kept `nogra:` tools allowed through that promptless guard so the required
  offer or brief flow can proceed instead of blocking itself.
- Added routing smoke coverage for promptless high-scope tool use, promptless
  `nogra:offer`, and direct follow-up clearing of pending routing state.

## 0.2.7 - 2026-05-25

- Cleaned public marketplace package metadata and docs so the copied package no
  longer exposes old marketplace names, private source paths or internal launch
  language.
- Made the local runtime smoke harness portable when run from a copied or cached
  plugin package outside the source repository layout.
- Updated the optional Nogra Codex plugin metadata to the public
  `nogra-marketplace` repository and added display metadata for marketplace
  surfaces.

## 0.2.6 - 2026-05-25

- Reduced plugin-mode init to the minimal local footprint:
  `.nogra/config.json` plus root `CLAUDE.md` when missing.
- Moved project-specific state expectations to adapt-time guidance so init no
  longer pre-fills empty checkpoint, task, decision or project-structure files.
- Updated status guidance to keep workspace mode hidden from the human status
  surface while local is the only shipped mode.
- Extended the local runtime smoke test to assert the new minimal init
  contract.

## 0.2.5 - 2026-05-23

- Changed runtime policy to a two-state model: `default` means no concrete
  executor/verifier runtime choice is written, while `custom` carries
  user-selected executor/verifier model and effort guidance.
- Documented this release's default runtime resolver as Sonnet/medium for both
  executor and verifier, with legacy `roles.agent` read as an executor fallback.
- Updated the optional statusline to show runtime state as Default/Custom only;
  concrete live model/effort display remains Claude Code's own surface truth.
- Cleaned local plugin role, skill and init surfaces so runtime details live in
  runtime policy and dispatch metadata instead of generated brief prose.
- Reduced bundled brief-writing guidance to six core rules and tightened stop
  criteria around pre-flight checks and non-zero exit handling.

## 0.2.4 - 2026-05-22

- Added methodology guidance that treats existing routing sensitivity/signals and
  runtime-policy facts as advisory inputs for Manager judgment, without adding
  budget routing behavior or parallel score tables.
- Clarified UI-heavy brief and verification guidance so static preview quality
  and interaction/use craft are checked as separate claims when visual product
  work makes that relevant.
- Added claim-strength discipline for methodology notes: observation,
  hypothesis, finding and locked doctrine.
- Framed tunnel/live-preview assumptions as examples of pre-flight stop
  criteria, not universal framework rules.

## 0.2.3 - 2026-05-22

- Added non-blocking plugin diagnostics for multiple installed Nogra plugin
  refs and marketplace/plugin version drift.
- Added deterministic brief overview text alongside local brief draft saves and
  promotion refreshes.
- Standardized verification-status guidance on English-first tokens:
  `deviation` and `decision_required`.
- Added brief stop-criteria guidance for pre-flight environment checks before
  executor scope work begins.
- Removed pre-launch tier and hosted architecture claims from public plugin
  copy and bundled guidance.

## 0.2.2 - 2026-05-21

- Clarified the role/runtime split for plugin-provided executor and verifier
  contracts: Nogra ships workflow roles, while Claude Code supplies the runtime
  that takes those roles.
- Updated local handoff contracts to expose plugin-scoped roles and derive
  model/effort/maxTurns hints from agent frontmatter instead of hardcoded prose.
- Added explicit execution role/runtime pairing to dispatch receipts, run state,
  status payloads, events and validation artifacts.
- Added optional verifier role/runtime pairing to terminal run state and events
  when an independent verifier-role pass is actually used.
- Added a release-gate check for the plugin `agents/` bundle so executor and
  verifier role contracts must exist with valid frontmatter before shipping.

## 0.2.1 - 2026-05-19

- Clarified native-first evidence discipline: Nogra acceptance criteria
  must be verifiable with common Claude Code primitives; browser screenshots,
  Playwright, Puppeteer, local HTTP servers and console/network checks are
  optional adapter evidence, not default acceptance gates.
- Cleaned executor/verifier user-facing role language so `nogra:executor`
  remains an internal Claude Code plugin-agent route while the product surface
  says `Executor` / `Verifier` plus runtime when needed.
- Added verification-status inference for local runs when all acceptance rows
  are met and no deviations are recorded.

## 0.2.0 - 2026-05-19

- Added plugin-bundled public contracts, schemas, templates and init assets for
  the default local runtime.
- Added `scripts/nogra-local.mjs`, a no-dependency local runtime for status,
  init, brief validation/save/promote, dispatch receipts, handoff contracts and
  verification support.
- Changed the product boundary so default workflows use local plugin contracts
  and `.nogra/` records.
- Normalized existing plugin workspaces to the local runtime while
  preserving their config files.
- Documented the local workspace architecture in the bundled architecture note.

## 0.1.2 - 2026-05-19

- Kept local-language routing phrases in workspace dictionaries while retaining
  an explicit English routing fallback in the plugin defaults.

## 0.1.1 - 2026-05-18

- Clarified execution-shape guidance so Manager declares evidence/tool needs
  once and the adapter derives toolbank families mechanically.

## 0.1.0 - 2026-05-18

- Added Nogra dispatch scope-shaping guidance for one-run, phased and review
  execution choices without turning execution shapes into hard enums.
- Added optional brief execution-shape guidance so adapter tools can derive
  toolbank families from Manager-authored evidence/tool needs without requiring
  a provider-tool enum.
- Added the local ledger helper for safe `.nogra/` writes, terminal run
  finalization and consistency checks.
- Added statusline support for active local transport runs without provider
  polling or synthetic heartbeats.
- Added smoke checks for routing, ledger consistency and statusline rendering.
- Added marketplace metadata for author, license, homepage and repository.
