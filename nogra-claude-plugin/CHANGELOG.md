# Changelog

## Unreleased

## 0.4.6 - 2026-05-29

- Added `/nogra:create` as a skill-backed local runtime flow for creating
  `projects/<workspaceId>/` under a Manager hub with project-local `.nogra/`
  state and hub-index registration.
- Expanded `/nogra:setup` so the init bundle creates the standard `.nogra/`
  domain structure instead of only writing config.

## 0.4.5 - 2026-05-29

- Added Manager hub boot context so a hub workspace can list indexed Nogra
  projects instead of forcing the user to `cd` into each project.
- Added read-only project focus from the hub: a prompt like "Client App" can
  focus the indexed project and point Claude at that project's local
  `.nogra/state/*` files without writing state, dispatching or loading full
  history.
- Shipped the shared local `boot-context` and `project-focus` runtime modules in
  the public package so the behavior is available outside the internal lab.

## 0.4.4 - 2026-05-29

- Hardened `/nogra:on` and `/nogra:off` routing so hooks only treat slash
  commands or the internal command wrapper as toggle intent.
- Fixed the false-positive where ordinary text such as "Nogra on Reddit"
  matched `nogra on` and surfaced a toggle request.
- Kept hooks as soft guardrails: `UserPromptSubmit` may surface toggle context,
  while the `on` and `off` skills remain the actors that write local config.

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

- Removed internal-experimental vocabulary from public skill docs: "Kasper"
  persona-reference and "contamination/design-DNA hypothesis" research-vocab in
  `skills/verify/SKILL.md` replaced with neutral equivalents.
- Swept skill, contract, agent, and hook docs for other persona-names,
  research-terms, dogfood-vocab, and project-codename leaks; applied fixes
  where found.
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
