# Changelog

All notable changes to the Nogra plugin for Claude Code. Versions follow
semantic versioning; each entry lists what changed for users of the plugin.

## 0.9.9 - 2026-09-08

- Repin the `USER.md` profile on `SessionStart:compact`, keeping its advisory
  boundary and the existing recovery pointer. Compact recovery reads only the
  profile; disabled native memory stays disabled.
- Measure the loaded memory index against the shared 200-line / 25,000-byte
  window. Large topic files no longer trigger an index-overflow warning, and
  session start no longer reads every topic body just to measure size.
- Keep the local memory pin when the sync adapter throws unexpectedly. The
  fallback reports local-memory use without exposing exception details.
- Add a "Learned today" section at the top of the bound Paper block: `fund`,
  `rettelse`, `kur` and `kur-stop` ledger events from the last 24 hours, read
  from the ledger alone. `learnedToday(events)` is exported.
- Exclude future-dated learning events from the 24-hour projection, skip
  non-object ledger values, measure ellipsis truncation in Unicode code points,
  and label learned-event timestamps as UTC.
- Add hook-process regression checks for profile continuity, bounded reads,
  disabled memory, adapter failure and UTF-8 byte limits, plus ten
  deterministic learned-today checks, to the runtime smoke suite.
- Fix the lifecycle wiring test that still encoded the pre-2.1.214
  `SessionStart` matcher. The invariant it guards is that the first matcher
  never carries `compact`.

## 0.9.8 - 2026-09-02

- Add one locked ledger door for plugin code (`runtime/local/ledger-append.mjs`).
  The next watermark is the highest existing watermark plus one, never the line
  count; a supplied watermark that collides or skips is refused; appends are
  idempotent by `eventId`; an exclusive lock file with mtime-based stale
  recovery serializes writers. All plugin ledger writers now append through it.
- Add `hooks/pre-compact.mjs`: `PreCompact` stamps a `compaction` event
  (trigger, session, transcript) in the ledger before the context folds.
  Fail-open.
- Observe `SubagentStop` and `PostToolUse` for `Edit|Write|MultiEdit|NotebookEdit`,
  so successful write effects and subagent completions reach the live-hook log
  alongside failures.
- Correct the convergence document: role agents deliberately carry no `model:`
  or `effort:` frontmatter. The runtime profile (`/nogra:settings`) and Claude
  Code's live `/model` are the authority.
- Ship the `PreModelSwitch` / `PostModelSwitch` observer registration that
  0.9.7 built but did not release.
- Known gap: `pace`, `delivery-gate`, `active-intent`, `paper-chapter` and the
  walls ledger helper still write `nogra.event.v1` records without a watermark.
  Routing them through the door is queued.

## 0.9.7 - 2026-08-29

- Add the paper `page` verb and generate chapter order from the ledger instead
  of maintaining it by hand.
- Fix the local-runtime smoke test that still expected the pre-2.1.214
  `SessionStart` matcher set without `fork`.

## 0.9.6 - 2026-08-29

- Resolve the workspace root through `CLAUDE_PROJECT_DIR` first in seven hooks
  and scripts, with smoke tests pinning the contract.
- Include `fork` in the `SessionStart` matcher (added in Claude Code 2.1.214).
- Measure the memory valve against the platform's real load window (25,000
  bytes, roughly 200 characters per index line) and report the longest line and
  the entries over the limit.
- Use the same root resolver in `boot-order` and `session-start`, so the two
  hooks can never disagree about the workspace.
- Wire the task-deleted hook (`PostToolUse` on `TaskUpdate`).
- Label post-compact context as `SessionStart:compact`.
- Fix a permission-rule comment that implied `allow` could override `deny`.
- Accept both `h1` and `h2` headings in paper cards, and carry the paper-now
  finds fix.
- Run the full paper chain in dayclose step 7 (close, open, cards, bind, now,
  audit, republish) with a `paper-published` receipt. Publish remains an
  explicit Manager step; only chapter open/close are chapter events.
- Point the status skill at `/tasks` instead of the removed `/ps`.
- Release note: a cached 0.9.5 build once differed from the candidate under the
  same number. From this release on, a version number names exactly one artifact.

## 0.9.5 - 2026-08-24

- Make paper writers honest: bind and now require both markers and verify that
  the replacement changed the document; the now verb refuses to write when the
  existing paper cannot be read; the chapter audit fails when the paper is
  missing instead of reporting an empty book as covered.
- Resolve the consolidation-due reader with the same shared root resolver as
  the writer, so the alarm also fires in sub-directory sessions, and unify index
  line counting between the session-start nudge and the valve.
- Require the resolved memory home's `archive/` directory for consolidation
  receipts instead of accepting any path with an archive segment.
- Fix review findings: function replacements in card-board rendering so task
  text can never act as a replacement pattern; hand-set section ids preserved;
  done-markers classified after markdown stripping; whitespace-tolerant pace
  matching; bounded ledger tail reads on the walls recall path; zeroed buffers
  and short-read handling in ledger tail reads; the CGNAT host pattern limited
  to 100.64.0.0/10; explicit CLI flags win over workspace config in the paper
  tools; a dead import removed and duplicate ledger scans merged on the status
  path.
- Move deployment-specific boundary logic and vocabulary out of shipped code
  into workspace configuration: `gate.pathClasses`, `promotion` (an unset key
  reports unknown instead of guessing) and `walls.stopWords`. Examples and test
  fixtures no longer carry workspace names, hosts or absolute local paths;
  local-only fixtures are env-supplied with an explicit skip.
- Remove an internal-only skill from the repository and its history.

## 0.9.4 - 2026-08-23

- Add `/nogra:brain` with a session-end memory valve. `runtime/local/brain-valve.mjs`
  and `hooks/session-end.mjs` measure native auto-memory at session end and,
  only past the margin, log one `consolidation_due` event and write one line to
  `inbox/out/consolidation-due-<date>.md`, once per workspace per day,
  fail-open. `hooks/memory-load.mjs` reports it once at the next session start
  and never asks.
- Document the memory window against the platform: Claude Code loads at most
  the first 200 lines / 25 KB of `MEMORY.md`. The alarm margin is 150 lines /
  15 KB with a 150-line checkpoint bound; file count stays free. Line counts use
  `wc -l` semantics.
- Fix the root cause the valve exists for: the consolidation alarm stopped
  firing when hooks moved into the plugin.
- Add `/nogra:brain` verbs: `status` (at most 12 measured lines plus one
  verdict, numbers-only `brain-status` event), `line` (the one-line form used by
  `/nogra:status`), `consolidated --receipt <archive/...>` (validates a real
  consolidator receipt, writes `brain-consolidated`, appends one `MEMORY.md`
  footer line, refuses paths outside `archive/`, idempotent against the ledger),
  `mark` / `stamp` (compile bookkeeping with `brain-compiled` events) and
  `consolidate` (measure first, stop without an explicit GO, then dispatch
  `agents/consolidator.md`). `skills/brain-init` remains as an alias for one
  release.
- Add `/nogra:paper` verbs: `bind` (`scripts/paper-bind.mjs`, byte-identical
  port with `PAPER-BIND` markers and a compatibility read of the old marker name,
  `paper-bound` event with count and sha256), `now` (`scripts/paper-now.mjs`,
  measures the live-status page between idempotent markers using only the
  paper's own CSS classes, `paper-now` event) and `publish` (a documented
  Manager step).
- Bind the paper into `decide` (refresh right after the ledger append, never
  blocking a ruling), `dayclose` (measure the memory window before the
  write-loop, refresh the live page last) and `status` (combined brain/paper
  one-liner).
- Add paper configuration under `.nogra/config.json`
  (`paper { file, artifactUrl, decisions, ledger, doors?, sql?, openMarkers? }`).
  A missing key prints the exact JSON to add and is never written by the skill.
- Add smoke suites for the valve (42 checks) and the paper verbs (25 checks).
  Consolidation never runs without an explicit GO, the paper is a projection and
  never a source, and no transcript is ever read.

## 0.9.3 - 2026-08-22

- Add walls: recorded blockers that resurface before re-diagnosis.
  `runtime/local/walls.mjs` and `hooks/wall-recall.mjs` (`UserPromptSubmit`,
  `PostToolUseFailure`) search the ledger for earlier events that share the
  symptom terms of a detected wall signal and inject the latest matches as
  context; repeated hits without a `wall` record prompt for one. Add the `wall`
  event type (symptom, cause, immediate cure, owner, durable fix, status), the
  `.nogra/state/WALLS.md` projection, `scripts/nogra-wall.mjs record|list|match|project`,
  and open walls in the post-compact pointer and the ground skill. Defaults are
  generic English; workspaces extend `walls.signalPatterns`.
- Reduce the hook map from 33 to 21 entries. Observation events register only
  on `Stop`, `PreCompact`, `PostToolUseFailure`, `PermissionDenied` and
  `StopFailure`; `wall-recall` stays on prompts and failures; a legacy stop shim
  is removed. A pre-cut copy of the hook map is kept in the repository.
- Restrict wall recall on successful tool results to strong signals (security
  errors, permission and authorization failures, connection failures, captcha
  and bot-detection pages); prompts and failed tool calls keep the full signal
  set. Grow the stopword list and raise the minimum term hits from 2 to 3.
- Add the delivery gate: a message to the user is a delivery, not a claim.
  `hooks/delivery-gate.mjs` (`Stop`) blocks loopback links, requires a fresh
  `delivery-receipt` ledger event for internal links (private IPs, `*.local`,
  `*.workers.dev`, configured hosts) and blocks homework phrases without a board
  reference. It downgrades to a system message when the stop hook is already
  active and writes one audit line per decision.
  `scripts/nogra-delivery-receipt.mjs` writes the receipt only with a fresh
  screenshot file. Configuration under
  `deliveryGate { enabled, receiptWindowMinutes, hostPatterns, homeworkPhrases, boardRefPatterns }`.
- Add pace: `hooks/pace-context.mjs` (`UserPromptSubmit`) persists slow-down /
  full-speed phrases into `.nogra/state/PACE.json` and injects one pace line per
  turn while slow; `scripts/nogra-pace.mjs status|slow|normal`; configuration
  under `pace { slowPhrases, normalPhrases }`.
- Add ask-grants: `gate.grants[]` on the running intent binds a verbatim ask to
  one boundary class with optional scope patterns and a TTL (turn, duration or
  intent scoped). `scripts/nogra-grant.mjs add|list|revoke|expire-turn` is the
  deterministic hand; the `authorize` skill documents the ritual. The gate
  evaluates grants after `gate.authorize` and before receipts, stamps one
  `ask-grant-used` ledger line per use, and ticks turn TTLs on every prompt.
  Gate arming can never be granted. The authorize test ladder grew from 13 to
  21 rows.
- Fix four older suite items: a skill description trimmed to the trigger cap,
  two skill frontmatters aligned with the skill-quality contract, the quality
  checker's optional `internal: true` marker, and four git byte-baselines moved
  to the bytes the guard actually writes.

## 0.9.2 - 2026-08-20

- Read `metadata.scopePatterns` as the scope fallback in `convergence-guard.mjs`,
  symmetric with the boundaries fallback. Without it a `transport_register`
  receipt could never allow-match.
- Document command-scope glob semantics in the `authorize` skill: a single `*`
  never crosses `/`, so command patterns with paths need `**`.
- Add the `grade` skill (`/nogra:grade`): a five-step source-quality verdict.
  Seeded, replayable anchor tasting; mechanical field statistics over the whole
  population; a look at a hole class and a typical representative; red, amber
  and green grades where red gates the decision; verdict to the builder before
  anything runs. Binds to the `fund` skill for indexing.
- Render the drawing reference in the gate's context: when an intent grant
  carries `metadata.grantChain.drawing` (`{name, source, artifact}`), the guard
  shows `currentActionDrawing=name(source)` in the convergence context, both
  review paths and the audit line. Receipts without a drawing render `none`.
- Add the `nogra-drawings` skill (`/nogra:drawings`): canonical drawings live in
  the workspace's `drawings/` registry (legacy `tegninger/` accepted); no drawing
  is published as an artifact without its source file and one index line; a
  drawing is read once when grounding on its domain; intent can reference a
  drawing by `{name, source, artifact}` in a brief or grant.
- Classify migration-domain writes by the action's home, not by a word in a
  filename: a file inside a `migrations/` directory, or a `.sql` / `.prisma`
  artifact whose own name declares migration intent, maps to the
  `data-migration` boundary. A script merely named "migration" is ordinary
  workspace write.

## 0.9.1 - 2026-08-16

- Escalate uncovered HIGH and CRITICAL boundaries from ask to deny in
  `bypassPermissions` mode, where an ask is a prompt nobody sees. Ordinary asks,
  covered allows and observe lines are unchanged.
- Treat uncovered routine git verbs as an observe line, never an ask or an
  allow; deploy, destructive and non-git boundaries keep their ask. The
  authorize-ladder smoke matches.
- Carry the intent on audit lines: `brief=<briefId>` on covered, scratch and
  not-covered decisions alike.
- Preserve evidence artifacts byte for byte in a local digest-addressed vault
  when `evidence-save` runs. A mutable working projection may change without
  erasing its historical receipt; active facts still fail closed if neither the
  live bytes nor the exact snapshot exists. One explicitly named invalid legacy
  fact can be recovered only by a same-subject, non-regressing replacement.
- Include the gate's verdict on `PreToolUse` live-log lines as `nogra.reason`
  (the dense `Audit:` sentence), so ask, review and allow decisions can be
  graded from the log.
- Carry the approved brief's boundary grant on dispatch receipts
  (`metadata.authorizedBoundaries`, `metadata.scopePatterns`) instead of a
  hardcoded `workspace-write`. Coverage is enumerated at GO time inside the brief
  hash and cannot widen mid-run. Gate arming, billing, secrets, permissions and
  customer-send are never grantable by receipt; a grant without scope patterns
  degrades to the default.

## 0.9.0 - 2026-08-14

- Carry the 0.8.9 `/nogra:dayclose` skill forward unchanged. The 0.8.9
  session-quality lane is intentionally not carried; hidden-scoring isolation
  supersedes it with the explicit, user-only `/nogra:transcript-diagnostic`.
- Document the role-lease worktree boundary in the dispatch contract:
  `scope.files` patterns match workspace-relative paths, so briefs targeting a
  sister worktree must prefix entries with the worktree path.
- Add the canonical contract spine
  `brief.v1 -> approval.v1 -> run.v2 -> run-event.v2 -> evidence.v1 -> verdict.v1`
  with schema-closed validation, scoped single-use approvals, lifecycle,
  outcome and verdict separation, replay recovery and frozen legacy reads.
- Add English-first Anchor v1 continuity: `/nogra:anchor`, `nogra.anchor.v1`,
  immutable JSON records, atomic current JSON and Markdown projections,
  evidence-gated `verifiedDone`, separate `claimedDone` and `unknown`, approved
  brief and GO binding, ledger and Git freshness, content dedupe, `supersedes`
  and interrupted-projection recovery. Anchor complements Claude Code's native
  rewind checkpoints; it does not grant GO, infer readiness or read transcripts.
- Add factual identity: immutable content-addressed `nogra.evidence.v1`
  receipts, append-only `nogra.fact.v1` ledger records, one active fact per
  stable subject, explicit `supersedes`, non-regressing evidence levels and a
  rebuildable `CURRENT-FACTS.json` projection. Ship verdicts require canonical
  evidence ids, Anchor completion claims bind active facts, and artifact digests
  are checked before evidence can support a fact or verdict.
- Treat native `MEMORY.md` / `USER.md` and hosted sync as the one continuity
  home and transport, and explicitly as advisory projections: memory and sync
  sources are capped at `reported` and cannot create or upgrade verified facts.
- Add strict role isolation. The Manager issues one short-lived,
  run-revision-bound `nogra.role.lease.v1` before a public role starts;
  `PreToolUse` binds the lease to Claude's `agent_type` and `agent_id`; missing,
  expired, swapped-agent and out-of-scope Executor operations fail closed.
  Public Executor and Verifier no longer receive Bash; the Verifier is limited
  to Read, Grep and Glob; the Manager owns command and test probes and canonical
  evidence.
- Add schema-valid `nogra.role.report.v1` returns. Executor reports are claims
  and cannot recommend a verdict; Verifier reports are read-only recommendations
  bound to canonical evidence; the Manager alone finalizes the executor outcome
  and writes `nogra.verdict.v1`. Adversarial regression covers scope escape,
  control-plane writes, agent swaps, role escalation, arbitrary shell, mutation,
  missing evidence and unstructured verifier claims.
- Add explicit boot and native-memory adapter contracts. `nogra.boot.context.v2`
  projects `fresh`, `detected`, `focused`, `resumed` and `recovering`; checkpoint
  existence is detection-only and only Claude Code's native `SessionStart`
  source may produce resume or recovery states. Boot never loads checkpoint
  contents or grants authority.
- Add one shared `nogra.memory.resolution.v1` path resolver for USER pinning,
  sync, diagnostics and consolidation. It honors observable settings,
  `CLAUDE_CONFIG_DIR`, runtime transcript identity and Git repository identity,
  supports an explicit runtime bridge for CLI and remote-only settings,
  respects disabled Auto Memory and fails closed on invalid or escaping default
  paths. `SessionStart` orders the optional sync pull before reading the
  resolved USER pin.
- Add hidden-scoring isolation. `SessionEnd` no longer reads transcripts or
  writes session-quality receipts, and status surfaces no longer project stale
  language judgments. The former numeric quality score, severity ladder and
  GO/stop interpretation are removed.
- Add the optional `nogra.transcript.diagnostic.v1` behind the user-only
  `/nogra:transcript-diagnostic` skill: bounded lexical observations with
  `authority=none`, no score and no verdict. Preview writes nothing; saving
  requires `--write`.
- Restore the tree sync leg on the new runtime: `tree` is a read and check,
  while `tree pull` and `tree push` remain explicit, collision-gated actions
  with receipts. Hooks never move git.
- Preserve the sync fingerprint's NUL domain separator as a visible source
  escape so text tools no longer classify `sync-client.mjs` as binary.
- Restore the Claude Code changelog watcher as an explicit, fail-open
  diagnostic, deliberately not a `SessionStart` hook.
- Add a narrow `workspace-migrate` upgrade lane for existing workspaces. It
  merge-preserves config, updates only `.nogra/` contract lanes, upgrades known
  `nogra.boot_policy.v1` configs to v2 and removes only the retired
  parallel-memory keys. Full setup no longer copies hub-owned `brain/`, `inbox/`
  or `projects/` surfaces into project-local seats.
- Keep legacy Markdown checkpoint migration freshness-conservative: a watermark
  declared by the checkpoint is kept, otherwise `SourceWatermark: 0`; old prose
  is never labelled current because a newer ledger exists.

## 0.8.9 - 2026-08-05

- Add `/nogra:dayclose`, the evening counterpart to the morning brief. Seven
  measured steps: sweep every open thread (agents, background jobs, dev
  services, overnight wakers), stamp the day in the ledger, update every
  projection in the same move, run the memory write-loop, inbox hygiene, git
  honesty (every touched repository named committed or parked), and a final
  pass where everything claimed closed is measured closed. `--weekly` adds a
  week-level digest.
- Require a mechanism receipt for any prediction about what happens after the
  close; otherwise it is written as an open item.
- Make `/nogra:status` load the skill first and measure under its direction,
  so every shown value comes from a fresh, skill-directed read rather than
  session memory.

## 0.8.8 - 2026-07-17

- Make union seats adopt the home seat's consolidated memory on pull instead of
  union-growing it. `unionMerge` is add-only and could never propagate a line
  the home removed, so a seat could grow past budget without converging.
  `syncPull` now adopts when the hosted watermark has advanced past the seat's
  last-seen mark: a clean seat takes the home's memory verbatim; a diverged seat
  gets a three-way `adoptMerge(base, local, remote)` that keeps its genuine
  additions and never revives a discarded line; first contact records the base
  with one honest union-merge. On adopt the hosted content becomes the push
  baseline, so a clean adopt never re-pushes.
- Leave the server, `unionMerge`, the budget and stale-base guards, the replace
  verb and the home seat untouched. Line-level tombstones remain queued.

## 0.8.7 - 2026-07-17

- Close the home-seat tick race structurally. The tick ran pull then push on
  every seat, but the home seat has no base to rebase against. On replace-mode
  seats a write-triggered tick now pushes alone, and a quiet interval tick pulls
  alone. Union seats are unchanged: pull before push remains their rule. Tick
  receipts on the home seat name which mode ran.

## 0.8.6 - 2026-07-17

- Add the budget guard: the server refuses (409 `over_budget`) any union push
  that would grow a bounded file past its limit. The refusal is whole and
  receipted with sizes and the cure (consolidate at the home and replace). A
  file already over budget never blocks the other file's growth. Client side, a
  409 `over_budget` is a stop, never a retry; `stale_base` still self-heals with
  exactly one rebase retry; unknown 409s are no longer blind-retried.
- Make the ground skill read the platform's own documentation and namespace
  before building on or naming anything that touches a platform surface.
- Add a self-hosted OAuth 2.1 authorization server in the sync worker: RFC 8414
  discovery, dynamic client registration (RFC 7591), authorization code with
  PKCE S256 (required), and a consent page approved by a short-lived
  `--approve` token from the mint script. The server is stateless: client ids
  and codes are HMAC-signed blobs. Issued connector tokens are ordinary
  read-and-append sync tokens, never replace-capable, and every opened door
  stamps an `oauth` receipt. Without a signing secret the server answers 501.
- Add a heartbeat in the hosted memory: a scheduled alarm every 30 minutes
  stamps a receipt, reads the seat board and names stalled seats. `go_armed`
  ships as a receipted switch behind the replace scope; nothing acts on it yet.
  New surface: `POST /sync/heartbeat` (append scope), `POST /sync/go` (replace
  scope); status carries the pulse and `doctor` reads it.
- Add the stale-base guard: every pull remembers the watermark it saw
  (`lastSeenWm`) and every union push carries it as `base_wm`. A push built on
  a hosted state the seat never saw gets a 409 `stale_base` and self-heals with
  one pull, rebase and retry. `syncPush` re-reads state at write time so a
  retry's fresh pull is never clobbered.
- Add `/nogra:decide`: record a decision in the workspace decision log
  (Date, Decision, Why, Alternatives considered, Owner, Linked brief, run or
  evidence) with one ledger receipt. Append-only; superseding rulings name what
  they replace.

## 0.8.5 - 2026-07-16

- Find the workspace root upward: `sync-cli` walks up from the current
  directory to the nearest `.nogra/`; outside a workspace it says so and exits 1.
  `CLAUDE_PROJECT_DIR` still wins.
- Inspect the token, never print it: `status` shows seat, scopes and expiry;
  an empty, malformed or expired token fails loudly on `run`, `pull` and `push`
  with its name, byte count and cure. Status also carries the seat board and
  role coherence (a home-mode seat without `memory:replace` gets its 403
  foretold).
- Add `sync-cli doctor`: eight falsifiable checks, each with its cure: root and
  source, enabled, endpoint, token metadata, audience binding, role coherence,
  a live authorized probe (with a 6 s timeout) and bounds in the server's own
  measure, plus the receipt tail with verdicts.
- Make `bind` prove itself: with a healthy token it runs the first pull, stamps
  the board and answers in writing; missing or empty tokens get instructions;
  a dead endpoint points to `doctor` and exits 1.
- Grow the CLI smoke suite from 32 to 52 checks, including a deterministic
  dead-endpoint probe over loopback and a check that the token value is never
  printed.

## 0.8.4 - 2026-07-16

- Add the seat board: every pull carries metadata for all seats (last seen,
  last pushed, dirty), never content. When another seat is active with unpushed
  state, session start injects one honest staleness line; it never blocks.
- Make `replace` consume history on the server: an accepted replace clears the
  hosted turn log so a fresh-cursor pull can no longer resurrect
  pre-consolidation state. Row ids stay monotonic, old cursors stay valid, and a
  refused wipe clears nothing.
- Report `dirty` on every pull, computed from the fingerprint machinery; a landed
  push clears it on the board.
- Forge seat identity in the token: the seat name lives only in the token's
  `seat` claim; tokens minted before seat awareness read as unknown, visibly.

## 0.8.3 - 2026-07-14

- Add the sync tick: `syncTick` runs mid-session on `PostToolBatch`
  asynchronously, debounced to one tick per 20 minutes, except that a write to
  either bounded file beats the debounce. The stamp is written before the network
  calls, so a failing endpoint debounces too, and every tick leaves a receipt.
- Make write detection clock-skew-proof: the tick compares file fingerprints
  (mtime plus size) it has seen before, never file mtime against the wall clock.
- Add `sync-cli run`: pull then push in one call with an aggregate receipt and
  an honest exit code.
- Make `bind` retrofit `memory/sync/` into `.nogra/.gitignore` when missing, so
  the seat file and token can never travel via git.
- Make the malformed-reply smoke real: the stub serves garbage for one pull and
  the suite proves fail-open behaviour.
- Add the session-start sync nudge. Sync has two legs, the memory leg on the
  hosted service and the tree leg on git. When either cannot keep its promise
  (unpushed memory, a failing receipt, a bound but tokenless seat, a silent
  seat, or a tree behind or ahead of its upstream as of the last fetch), session
  start emits one fact line (`<nogra-sync-nudge>`) with the matching move.
  Nothing pulls or pushes git by itself; silent when sync is off or converged.
- Make the ground skill list and read the workspace's canonical drawings for a
  domain before proposing on it, and treat an unreachable source as a stop, not
  a detour.
- Name `run` in the sync skill and README; fit the skill description to the
  trigger-metadata bound.

## 0.8.2 - 2026-07-13

- Add the `replace` verb: one home seat per user may hand the hosted service
  its consolidated memory verbatim instead of union-merging, so removed lines
  finally stay removed. `sync.mode: "replace"` routes the session-end push to
  `/sync/replace`; `bind <endpoint> --home` sets it; status names the seat mode;
  re-binding without the flag never demotes a home. Server side the verb is
  scope-gated (`memory:replace`) with a wipe guard: replacing non-empty state
  with empty is refused whole. Memory bound raised from 2,200 to 3,000
  characters.
- Keep the home mode out of git: it now lives in the gitignored seat file
  `.nogra/memory/sync/mode`, which always wins over pulled config. A seat
  without a seat file still honors a legacy config mode, but the server-side
  scope fence refuses that push without a home token, and every `bind` strips
  the mode from the shared config.

## 0.8.1 - 2026-07-13

- Add `/nogra:sync` with five verbs backed by `scripts/sync-cli.mjs`: `status`
  (enabled, endpoint, token presence, last pull and push, cursor, inbox depth,
  recent receipts), `pull` and `push` on demand, `bind <endpoint>` (enables sync,
  HTTPS only, preserves foreign config keys, leaves a receipt) and `off`. The
  token never passes through the model, in arguments, output or chat; status
  reports presence only. An over-budget push is explained, not hidden. 22
  offline smoke checks including the negatives.
- Add the `boot-order` `SessionStart` hook: any workspace with existing Nogra
  state gets the ground order injected at session start (checkpoint and tasks,
  then the ledger tail, then the pinned profile, then the standing agreement
  for what is about to be touched). Silent on fresh workspaces, static,
  cache-safe and fail-open.
- Add the local sync edges: when `.nogra/config.json` carries `sync.enabled` and
  a token exists (`NOGRA_SYNC_TOKEN` or the gitignored `.nogra/memory/sync/token`),
  `SessionStart` pulls the hosted memory and union-merges it into the native
  memory home before the profile pin reads it, and `SessionEnd` pushes the two
  bounded files back only when they changed. Remote turns land cursor-gated in
  `.nogra/memory/sync/inbox.jsonl` as raw material for the next consolidation.
  Off by default, TLS-only endpoints, fail-open, and every run leaves a receipt
  in `.nogra/memory/sync/log.jsonl`. 21 smoke checks over a stub service.

## 0.8.0 - 2026-07-10

- Pin `USER.md` every session: if the native memory home holds a bounded user
  profile, the `SessionStart` hook pins it into context on top of native
  auto-memory, never as a second copy. An over-bound profile is pinned whole and
  flagged for consolidation. The consolidator contract now maintains the profile
  (creates it from the user and feedback topic files if missing, keeps it under
  the 1,375-character bound), and the workspace `CLAUDE.md` teaches Claude to
  fold durable user facts into it.
- Unwire the retired `.nogra/memory/local/` store completely: init-bundle config
  keys, the workspaces index template, the `boot-context.mjs` fallback and
  `/nogra:create` scaffolding. Negative smokes assert that init and
  create-project never scaffold or reference it.
- Require the consolidator to copy the untouched original to
  `memory/archive/<name>-<date>.md` before trimming or merging any file that
  stays in the root.
- Make the setup self-check structural (`CLAUDE.md` plus paths under `inbox/`,
  `projects/` and `brain/`, nothing else at the root) and let the setup preview
  name the full package.
- Update the README gate copy to the shipped behaviour: default is context plus
  one extra ask, the explicit `gate.autoApprove` opt-in is the only allow lane,
  hard mode can deny, and the gate narrows within Claude Code's permission model.
- Improve failure messages: a corrupt `.nogra/config.json` reports "invalid
  local config" instead of "not initialized"; an unknown brief id gets a domain
  message instead of a raw `ENOENT`; the Node.js 18+ requirement is enforced in
  code with a clear stop.
- Add the memory write-loop: when durable memory grows past what Claude loads,
  the `SessionStart` bound check nudges an explicit, bounded consolidation. On
  GO the Manager dispatches the new `nogra:consolidator` agent, which promotes
  before pruning and moves (never deletes) superseded notes to `memory/archive/`.
- Add `/nogra:ground`: read the plan and state, verify claims against facts,
  match the user's register, then hand the next decision back.

## 0.7.9 - 2026-07-06

- Add the authorize ladder as a permanent smoke (`smoke-gate-authorize-ladder.mjs`).
  It drives the real `PreToolUse` hook against temporary fixtures and proves all
  13 rungs of the standing-GO ladder: no intent asks, opt-in off skips (never
  allows), class plus scope plus opt-in is the only allow, neighbouring classes
  still ask, scope miss asks. Test-only; no runtime behaviour change.

## 0.7.8 - 2026-07-06

- Let `/nogra:authorize` start the intent it binds to. The standing-GO lane
  shipped with a complete read side but no producer, so authorize always ended
  on "no running intent". The skill now offers to start a minimal intent
  (user-confirmed objective, optional scope). Fail-closed behaviour is unchanged:
  no intent still means the gate asks, and without a declared scope the class is
  skip-only.

## 0.7.7 - 2026-07-06

- Align five plugin strings with the shipped behaviour: `brain/` is scaffolded
  by setup, pull-first, never auto-loaded, and `/nogra:brain-init` re-scaffolds
  it if removed. No behaviour change.

## 0.7.6 - 2026-07-06

- Scaffold the complete workspace by default: `/nogra:setup` now writes
  `CLAUDE.md`, `.nogra/`, the two-way `inbox/`, `projects/` and the `brain/`
  knowledge vault (`raw/` to `wiki/` to `index.md`). The brain stays
  pull-first.
- Move durable memory to Claude Code's native Auto Memory
  (`~/.claude/projects/<slug>/memory/`). Claude writes and loads it; Nogra keeps
  no parallel copy. The `SessionStart` hook is now a read-only bound check that
  flags consolidation only when memory drifts past what Claude loads. The
  deprecated `.nogra/memory/local/` store is no longer scaffolded.
- Rewrite the README around the full package (memory, brain, verify) with the
  marketplace install command.

## 0.7.5 - 2026-07-06

- Make the plugin purely local: remove the MCP bridge (`.mcp.json` and
  `scripts/mcp-launcher.mjs`). Briefs, dispatch receipts and verification run on
  the bundled local runtime, and the plugin makes zero network calls.
- Turn the scaffolded `inbox/` into a two-way shared desk: `screenshots/` and
  `drops/` (user to Nogra) and `out/` (Nogra to user: receipts, drafts, "ready
  for GO"), with an `inbox/README.md` and a workspace `CLAUDE.md` section.
- Add the missing Memory section to the README (deterministic every-session
  load, bounds, consolidate rather than hoard, self-learning on correction) and
  align setup and install wording with what setup writes.

## 0.7.4 - 2026-07-06

- Close the memory loop with self-learning: the scaffolded `CLAUDE.md`
  instructs Claude to write a one-line lesson to `MEMORY.md` whenever it is
  corrected or catches its own mistake. Lessons consolidate; they never pile up.

## 0.7.3 - 2026-07-05

- Add a bounded memory layer: `.nogra/memory/local/MEMORY.md` (at most 2,200
  characters) and `USER.md` (at most 1,375) load into every session through a
  `SessionStart` hook. The bound is enforced on read. Claude does the
  remembering; Nogra owns the bound.

## 0.7.2 - 2026-07-05

- Remove the clickable `[Open brief](file://...)` link from the brief approval
  flow. Claude Code's file viewer excludes hidden directories, so a link into
  `.nogra/` could never open. The brief stays in `.nogra/briefs/`, the inline
  approval artifact is the review surface, and the brief is referenced by id
  with its path as plain text.
- Update the MCP layer documentation to the npx-first launcher.

## 0.7.1 - 2026-07-05

- Restore the `brain-init` skill and contracts that were dropped from the 0.7.0
  marketplace build. `/nogra:brain-init` works on a fresh install again.

## 0.7.0 - 2026-07-04

- Scaffold a thin hub by default on fresh installs: empty `inbox/` and
  `projects/` folders next to `.nogra/` and the root `CLAUDE.md`. Existing
  folders are never touched.
- Add `/nogra:brain-init`: scaffolds an opt-in, empty `brain/` knowledge vault
  (`raw/`, `wiki/`, `index.md`, a thin pull-first `brain/CLAUDE.md`).
  Idempotent; a second run writes nothing.
- Trim the shipped workspace `CLAUDE.md` (143 to 93 lines) and `.nogra/README.md`
  (21 to 12 lines) without dropping a rule.
- Add the MCP bridge: a plugin-root `.mcp.json` registers Nogra's MCP server on
  install, exposing the 32 public tools. The server ships separately as
  `nogra-mcp`; the plugin points at it and does not vendor it.
- Add the MCP launcher (`scripts/mcp-launcher.mjs`): resolves a runner from
  PATH (`npx` first, then `uvx`, then `pipx`) and, when none exists, prints one
  instruction line and exits non-zero. It never auto-installs anything and never
  touches the network itself.
- Add the `verifyNudge: "off"` config toggle to turn the observe-only `Stop`
  nudge off per workspace. The default stays on.
- Add the run-scratch write-ops coverage class to the gate escalation ladder:
  after GO, a dispatched run's own scratch housekeeping no longer raises an ask.
  The class is a fixed allowlist of file-op binaries (`rm`, `rmdir`, `mkdir`,
  `mv`, `cp`, `touch`) plus direct `Edit` / `Write` / `MultiEdit` calls, and
  only when every resolved target sits inside the receipt's declared
  `scratchRoots`. Interpreters, arbitrary binaries and compound, piped or
  redirected commands are never eligible. Targets are `..`- and
  symlink-normalized before prefix matching; unresolvable tokens can never count
  as inside.
- Declare a deterministic `scratchRoots` list on dispatch receipts: the run's
  own artifacts directory plus any `--scratch-root` flags.
- Cite every auto-approval in its decision reason:
  `approved <action> — in scope of your GO, receipt <runId>`.
- Add opt-in auto-approval (`gate.autoApprove`, default off): when a tool call
  falls within the scope of an approved, active dispatch receipt, the
  convergence gate lets it flow instead of re-asking. The decision is
  deterministic; anything outside the mechanical boundary and scope match asks.
- Add the arm-self-gate: writes to `.nogra/config.json` are never
  auto-approvable, regardless of any receipt.
- Name active delegations in the boot context and statusline (`gateDelegations`);
  absent when off.

## 0.6.9 - 2026-06-26

- Add an observe-only `Stop` verify nudge: when a session ends on a completion
  claim and no Nogra verification ran, emit one non-blocking line suggesting
  `/nogra:verify`. It never blocks, never re-prompts and fires at most once per
  session.
- Make cross-model verification the default: under the default runtime profile
  the verifier resolves to a different model than the executor. Claude Code's
  native `/model` remains the source of truth.
- Add `/nogra:authorize` to authorize recognized action classes so the
  convergence gate stops re-asking about an approved class; reversible with
  `revoke` and `clear`.
- Correct stale post-compact test assertions left by the 0.6.8 `SessionStart`
  re-homing. No runtime change.

## 0.6.8 - 2026-06-19

- Normalize workspace identity on terminal finalize-run events so returned and
  cancelled ledger and transport events use the run's workspace id instead of a
  generic `local` fallback.
- Add smoke coverage for workspace-id preservation across terminal run state,
  ledger events and transport events.

## 0.6.7 - 2026-06-18

- Add public test-isolation diagnostics for private plugin lanes: local development use
  remains a non-blocking warning, while strict public-grade mode can block a
  private-lane collision before a public rehearsal is trusted.
- Document isolated public plugin testing for users who also run private lanes
  on the same machine.
- Make `SessionStart` and `PostCompact` prefix context cache-safe by removing
  per-turn ledger, checkpoint, receipt and index state from hook output while
  preserving local state pointers, with smoke coverage proving the output stays
  byte-identical after ledger and run mutations.
- Guide the brief skill to use main-loop `AskUserQuestion` for bounded
  risk-intake batches and route-choice questions.
- Keep `PreToolUse` convergence checks and GO behaviour unchanged: GO remains an
  explicit chat act before dispatch, never a modal question.

## 0.6.6 - 2026-06-17

- Add Nogra match reviews at deterministic `PreToolUse` action boundaries
  without replacing Claude Code's permission decisions.
- Add local live hook and event observability under `.nogra/runtime/` and
  `/nogra:watch`, without storing prompt bodies, tool output, file contents or
  full shell commands.
- Add a read-only statusline projector that reuses the `/nogra:status` payload
  and fails open.
- Add deterministic review for instruction-surface writes such as `CLAUDE.md`,
  `.claude` instruction subpaths, `SKILL.md`, plugin manifests and Nogra hooks.
- Add the five-anchor local index and status metadata for risk intake,
  behaviour score, connections and risk registry, decision shape and expansion
  guidance.
- Add dispatch sizing, agentic-loop return handling and plain partial or
  blocked continuation language when a runtime turn limit stops work early.
- Add skill quality gates, gotcha references and Bash-safe absolute-path command
  recipes across the setup, brief, dispatch, verify, create, update and status
  flows.
- Harden public executor and verifier agent contracts with explicit tool
  allowlists that omit nested subagent spawn.
- Add `psql` mutation detection, read-only inspection softening, conservative
  public fetch handling and production deploy detection to the convergence gate.
- Add explicit off and uninstall guidance and clarify privacy and help copy.
- Give user-invocable skills lowercase `nogra-*` display labels while preserving
  `/nogra:<skill>` command paths.
- Align `/nogra:status`, `/nogra:adapt`, setup files and continuity docs with the
  current `.nogra/state/*` layout.

## 0.6.5 - 2026-06-08

- Add a thin intent-router contract to the help docs, the bundled workspace
  `CLAUDE.md` and the README: explicit Nogra intent maps to the matching skill,
  while ordinary work stays direct.
- Restore the public plugin display name to lowercase `nogra workflow`.
- Remove automatic-offer scoring, sensitivity controls and the `PreToolUse`
  command tripwire. Nogra is pull-first: explicit `/nogra:*` requests start
  Nogra flows, ordinary work stays direct, and Claude Code's native permission
  model remains responsible for tool permissions.
- Simplify core hooks to session boot context and workspace-hub project focus.
- Split lifecycle state across event-aware hooks: `SessionStart` no longer
  matches compact, `PostCompact` emits only a thin continuity pointer, and
  `SessionEnd` silently updates the local session anchor.
- Add init migration cleanup for obsolete automatic-offer routing controls in
  existing `.nogra/config.json` files.
- Remove separate brief and workspace release-version fields. The plugin version
  is the product release identity; schema ids remain the artifact-format
  contracts.

## 0.6.3 - 2026-06-07

- Change the brief sizing preview from a binary prompt into a three-level
  Manager surface: `silent`, `inform` or `ask`.
- Add Manager-owned split guidance with linked-versus-parallel criteria and
  explicit escalation criteria for when sizing must be shown.
- Add `operatorDecomposed` preview deduplication so an already-split phase does
  not re-ask on coupled follow-up work.

## 0.6.2 - 2026-06-07

- Keep workspace-hub boot thin: project questions use the workspace index, and
  project focus reads the selected project's local checkpoint only after the
  user chooses it.
- Extend `SessionStart` continuity context with ledger watermarks and
  checkpoint freshness so resumed sessions can tell fresh checkpoints from
  stale projections without loading full project state.
- Add local-language no-Nogra bypass handling and keep automatic offers
  advisory.

## 0.6.1 - 2026-06-06

- Add `ledger-smoke` as a bounded diagnostic for local ledger watermarks.
- Clarify status wording around plugin and workspace version fields.
- Omit blank `source` and `model` fields from session-anchor writes when the
  hook input does not provide them.

## 0.6.0 - 2026-06-06

- Surface local continuity migration state in `/nogra:status` and point
  prior-layout workspaces at `/nogra:setup` for a merge-only layout update.

## 0.5.9 - 2026-06-06

- Resolve missing `routingPolicy` and `runtimePolicy` visibly to release
  defaults for prior-layout workspaces.
- Add setup migration for checkpoints without `SourceWatermark` and workspaces
  without the `.nogra/ledger/` lane.
- Extend the local runtime smoke with a prior-layout migration case.

## 0.5.8 - 2026-06-06

- Add local session continuity anchors: hooks capture `sessionId` and a
  transcript anchor into bounded local runtime state without reading transcript
  contents.
- Add append-only `.nogra/ledger/` events with monotonic `ledgerWatermark`
  values for brief, dispatch, verification and terminal run records.
- Report checkpoint freshness by comparing the checkpoint `SourceWatermark` with
  the current ledger watermark.

## 0.5.7 - 2026-06-05

- Add reviewer-facing working examples and sample workspaces: setup, build a
  small local task tracker, save a local checkpoint.
- Add README no-data and support guidance: no account, no network calls,
  nothing collected, stored or shared by Nogra.
- Promote the public listing copy to `Nogra workflow` with the approve, run,
  verify description.

## 0.5.6 - 2026-06-05

- Add promoted brief file-link metadata so approval returns can show a plain
  `[Open brief](file://...)` link with URL-encoded local paths.

## 0.5.5 - 2026-06-05

- Make local root resolution command-aware: setup targets the requested
  directory even when a parent `.nogra/` exists, while control-plane and ledger
  commands resolve nested paths to the nearest parent workspace.

## 0.5.4 - 2026-06-05

- Resolve control-plane and ledger calls from nested working directories to the
  nearest parent `.nogra/` workspace, while fresh setup falls back to the
  requested root.

## 0.5.3 - 2026-06-05

- Republish the reconciled runtime, setup and create-project payload under a
  fresh version so installs on 0.5.2 receive the routing fixes cleanly.

## 0.5.2 - 2026-06-04

- Add a read-only draft brief sizing preview before save and promote, so
  oversized work can be split before approval.

## 0.5.1 - 2026-06-03

- Derive execution sizing after brief approval and carry the max-turn budget
  through dispatch and handoff.
- Add safe-continuation reporting for pre-flight blocks.
- Recenter verification on independent tree, artifact and command evidence;
  executor self-reports are claims.

## 0.4.3 - 2026-05-28

- Lowercase the `unverified` verification verdict to match the other verdict
  words.
- Require a reason on every non-ship verdict: what is missing, deviating or
  blocking, and what evidence would move the result to ship.
- Preserve fine-grained `verdict` and `reason` fields on validation records and
  refuse to record a non-ship verification without a reason.

## 0.4.2 - 2026-05-28

- Rewrite the README and listing hook in plain newcomer language: approve a
  short plan, run it, verify the result against that plan.
- Correct install guidance with the real setup order, an explicit Node.js 18+
  prerequisite and a pre-flight guard that stops before writing partial files.
- Define "Manager phase" and keep skill intent readable in command surfaces.
- Reconcile the brief handoff guidance with the compact approval surface.
- Fix manifest metadata: owner and author email, repository metadata and the
  `nogra-claude` marketplace name.

## 0.4.1 - 2026-05-28

- Keep full brief payloads and dispatch telemetry in local `.nogra/` artifacts
  while chat receives the compact approval or dispatch confirmation.
- Let the brief contract remain the authority for payload shape.
- Add a runtime-profile glossary entry.

## 0.4.0 - 2026-05-27

- Remove the default statusline bundle, the offer skill and the playbook and
  version-field surfaces from the plugin payload while keeping `/nogra:status`.
- Split dense skill material into references for setup, status, brief and
  dispatch.
- Keep toggle handling mechanical through `/nogra:on` and `/nogra:off`.
- Apply contextual Manager-role wording.

## 0.3.5 - 2026-05-27

- Clean wording across README, setup, adapt, settings, help, routing, brief,
  dispatch, verify and statusline guidance.
- Remove hardcoded sensitivity-step examples, duplicate verification wording,
  provider brand leakage and internal claim-strength vocabulary from
  user-facing guidance.

## 0.3.4 - 2026-05-26

- Run natural-language pre-flight guard assertions case-insensitively while
  `NOGRA_*` symbol checks stay case-sensitive.
- Clean setup, help and runtime wording the previous check missed.

## 0.3.3 - 2026-05-26

- Define "local runtime" in `skills/help/references/runtime.md`: the
  plugin-bundled scripts under `scripts/` that maintain `.nogra/` state.
- Standardize the vocabulary across skills, contracts and hooks.

## 0.3.2 - 2026-05-26

- Remove experimental vocabulary from public skill docs and sweep skill,
  contract, agent and hook docs for codename leaks.
- Extend pre-flight checks to enforce the sweep mechanically.

## 0.3.1 - 2026-05-26

- Rewrite README copy in positive form and describe the product as brief,
  dispatch, verify plus the local `.nogra/` ledger.
- Extend pre-flight checks for symbol leaks and defensive phrasing.

## 0.3.0 - 2026-05-26

- Rename the setup command to `/nogra:setup` to avoid a collision with Claude
  Code's built-in setup command. Setup writes `.nogra/config.json` plus
  `CLAUDE.md`; project-state templates move to `/nogra:adapt`.
- Add the NOTICE file for attribution under Apache 2.0 section 4(d).
- Soften the statusline orange from xterm-208 to xterm-214.

## 0.2.9 - 2026-05-26

- Change the `PreToolUse` offer guard from `deny` to native
  `permissionDecision: "ask"`, asked once per routed prompt.
- Remove hook-owned writes from the `/nogra:on` and `/nogra:off` hooks; the
  skills own `.nogra/config.json` updates.

## 0.2.8 - 2026-05-25

- Remove budget config detail and dev-state language from the README and
  lowercase plugin display names.
- Align routing sensitivity language and keep hit-rate telemetry behind
  `NOGRA_STATUSLINE_DEBUG=1`.
- Trim the init-bundle `CLAUDE.md` template to identity-only content; routing
  thresholds and runtime preferences move to reference docs.
- Remove orphan renderer references from the manifest and docs and enforce that
  manifest file references resolve.
- Harden the offer guard so promptless `PreToolUse` events still stop first
  tool use after an offer, while `nogra:` tools stay allowed.

## 0.2.7 - 2026-05-25

- Clean public marketplace metadata and docs of old marketplace names and
  private source paths.
- Make the local runtime smoke harness portable when run from a copied or
  cached plugin package.

## 0.2.6 - 2026-05-25

- Reduce plugin-mode init to the minimal footprint: `.nogra/config.json` plus
  root `CLAUDE.md` when missing. Project-state expectations move to adapt time.

## 0.2.5 - 2026-05-23

- Change runtime policy to a two-state model: `default` writes no concrete
  executor or verifier choice; `custom` carries user-selected model and effort.
- Show runtime state as Default or Custom in the optional statusline.
- Reduce bundled brief-writing guidance to six core rules and tighten stop
  criteria around pre-flight checks.

## 0.2.4 - 2026-05-22

- Treat routing signals and runtime-policy facts as advisory inputs for Manager
  judgment.
- Check static preview quality and interaction craft as separate claims in
  UI-heavy briefs.
- Add claim-strength discipline for methodology notes: observation,
  hypothesis, finding, locked doctrine.

## 0.2.3 - 2026-05-22

- Add non-blocking diagnostics for multiple installed plugin refs and
  marketplace version drift.
- Add deterministic brief overview text alongside draft saves and promotions.
- Standardize verification-status tokens on `deviation` and
  `decision_required`.
- Add pre-flight environment checks to brief stop criteria.

## 0.2.2 - 2026-05-21

- Clarify the role and runtime split: Nogra ships workflow roles, Claude Code
  supplies the runtime.
- Derive model, effort and max-turn hints from agent frontmatter.
- Record the execution role and runtime pairing on dispatch receipts, run
  state, status payloads, events and validation artifacts.
- Add a release-gate check for the `agents/` bundle.

## 0.2.1 - 2026-05-19

- Make acceptance criteria verifiable with common Claude Code primitives;
  browser screenshots, Playwright, Puppeteer, local HTTP servers and console or
  network checks are optional adapter evidence.
- Keep `nogra:executor` as an internal route while the product surface says
  Executor and Verifier.
- Infer verification status for local runs when all acceptance rows are met.

## 0.2.0 - 2026-05-19

- Add plugin-bundled public contracts, schemas, templates and init assets.
- Add `scripts/nogra-local.mjs`, a dependency-free local runtime for status,
  init, brief validation, save and promote, dispatch receipts, handoff contracts
  and verification support.
- Use local plugin contracts and `.nogra/` records for default workflows.

## 0.1.2 - 2026-05-19

- Keep local-language routing phrases in workspace dictionaries with an
  explicit English fallback.

## 0.1.1 - 2026-05-18

- Let the Manager declare evidence and tool needs once; the adapter derives
  tool families mechanically.

## 0.1.0 - 2026-05-18

- Add dispatch scope-shaping guidance for one-run, phased and review execution.
- Add optional brief execution-shape guidance.
- Add the local ledger helper for safe `.nogra/` writes, terminal run
  finalization and consistency checks.
- Add statusline support for active local transport runs.
- Add smoke checks for routing, ledger consistency and statusline rendering.
- Add marketplace metadata for author, license, homepage and repository.
