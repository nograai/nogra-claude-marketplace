# Changelog

## 0.8.8 — 2026-07-17 "the adopt release" (the house's truth wins)

- **Union seats now ADOPT the home's consolidated truth on pull — they no longer union-grow it.**
  `unionMerge` is add-only by construction: it can append an unseen line but can never propagate a
  line the home *removed*. So when the home consolidated (dropped stale lines, replaced the sky), a
  union seat pulling it kept its own stale copy and merged the home's new lines on top — growing
  monotonically past budget, never converging. Proven live (URET #260): a union seat pulled a
  2849-char home consolidation and ended at 3653 chars with the same checkpoint line three times.
- **The fix, client-only, on the drawn law** (DECISIONS #43 "the bench is a projection that must
  adopt the house's truth", #57 "bench seats only clean their local copy and never re-push a line
  the cloud has discarded", #127 the RAMMEN watermark motor). `syncPull` gains an adopt branch
  behind a conservative gate: when the sky's watermark has advanced past the seat's last-seen mark
  and the seat is a union seat (never the home, which IS the truth), it adopts —
  - **clean seat:** takes the home's memory/user verbatim (line-removals finally land);
  - **diverged seat** (dirty + advanced): a three-way `adoptMerge(base, local, remote)` = the home's
    truth plus the seat's *genuine* additions (local minus the last adopted base), so a home-discarded
    line is never revived and a real unpushed line is never lost;
  - **first contact / no stored base yet:** an honest one-time union-merge that records the base, so
    the next advanced pull adopts cleanly — a named, self-healing gap, not a silent one.
  On adopt the sky's content becomes the seat's push-baseline, so a clean adopt never spuriously
  re-pushes, and the `stale_base` cure now flows through adopt for free.
- **Untouched by design:** the server, `unionMerge` itself, the budget/front-6/race-streg guards,
  the replace verb, and the home seat. Line-level tombstones remain drawn for a later release
  (DECISIONS #59). Verified independently at the bench: client-smoke 87/87 ×3, sync-cli 52/52,
  server 89/89, and today's 3653 ghost as an ordret FAIL→PASS test (URET #262).

## 0.8.7 — 2026-07-17 "the crown release" (the crown never rebases)

- **The crown never rebases — the home-seat tick race closed structurally.** Proven three
  times by receipts (16/07 "replace 3098c -> 3098c": a pull union-merged ghosts back 104ms
  before replace read the file; the home seat's two failed cure attempts on 17/07 — the
  tick's write-trigger fired on every save and pulled the dirty sky back into the freshly
  cleaned file; the bench's 12-minute re-infection): the tick ran pull→push identically on
  every seat, but the HOME seat has no base to rebase against — the crown IS the base.
  The law, one sentence: "When the crown writes, the crown speaks. The crown listens only
  when it has nothing to say." In code: on replace-mode seats a write-triggered tick pushes
  ALONE (replace, no pull in the same tick — the cure reaches the sky untouched), and a
  quiet interval tick pulls ALONE (ingesting union seats' contributions for the next
  consolidation — safe now that the stale and budget guards keep the sky clean). Union
  seats are byte-identically unchanged: pull-before-push remains their law (front 6).
  Tick receipts on the home seat carry the crown's voice: `crown: speaks` / `crown: listens`.
  Evidence: 10 new smoke checks including the 16/07 scenario verbatim ("dirty sky + fresh
  cure + write-tick → the cure must win"), client smoke 75/75 ×3, full suite green.
  House dogfood (operator's hand: one consolidation, receipt showing push without pull)
  completes the drawing's acceptance.

## 0.8.6 — 2026-07-17 "the guard release" (the walls hold — for every seat)

- **The budget guard — the last ghost hole closed: a union may never RESULT in over-budget
  state.** The server now refuses (409 `over_budget`) any union push that would grow a bounded
  file past its limit — the morning ghost of 17/07 (06:29) was exactly such a merge: a legacy
  seat union-pushed its old 3098-char brain into a cleaned 2743-char sky, and the merge was
  STORED with only a warning. The refusal is whole (no partial merge, no turns, no seat-board
  stamp) and receipted with sizes and the cure: "union can add but never clean — consolidate at
  the home and replace." A file already over budget from before never blocks the OTHER file's
  honest growth, and the home's `replace` remains the one cure verb. Side effect that matters:
  this guard also catches pre-0.8.6 seats WITHOUT `base_wm` — a ghost payload is by definition
  the old big brain, so the wall holds even before every seat upgrades. Client side (this
  release): a 409 `over_budget` is an honest STOP, never a retry (a pull only makes the local
  union bigger) — receipt carries `refused: over_budget`, the return names the cure, and the
  session-start knock surfaces it to the operator. Guard chain hardened: `stale_base` still
  self-heals with exactly one rebase retry, and if the REBASED push hits the budget wall the
  client stops honestly (front6 → budget chain proven in smoke). The MCP `memory_append` names
  the refusal the same way. Narrowed on purpose: unknown 409s no longer blind-retry — only
  `stale_base` does. Evidence: server 89/89 ×3 (7 new guard tests incl. the morning scenario
  verbatim), client smoke 65/65 ×3 (+5).

- **Ground hardened: docs are drawings (hard block).** The ground skill gains a mandatory
  step: read the platform's own documentation and namespace BEFORE building on or naming
  anything that touches a platform surface. Born from a real naming defect: the 0.8.5
  `doctor` verb collides in conversation with Claude Code's own `claude doctor` / `/doctor`
  — no technical collision, but the operator had to ask which one was meant, and that
  question is the defect. Ruled a hard block by the operator, not a guideline.

- **The door for the windows — a real OAuth 2.1 authorization server, self-hosted in the
  worker (trin 02 complete).** claude.ai and the phone can now become windows onto the one
  clock: RFC 8414 discovery, dynamic client registration (RFC 7591), authorization-code +
  PKCE S256 (required, never optional), and a consent page where approval is the OPERATOR'S
  HAND — a 10-minute `--approve` token from the mint script whose only power is opening the
  door (scope `oauth:approve`, reads nothing). The whole AS is stateless: client-ids and
  codes are HMAC-signed blobs — no client table, no code table, signatures ARE the state.
  Issued connector tokens are ordinary seat-forged sync tokens (read+append, NEVER replace
  — a window never holds the crown) so the existing fence verifies them unchanged, and the
  seat board NAMES the window. Every opened door stamps an `oauth` receipt in the clock.
  Fail-closed line moved to where it belongs: no signing secret, no AS (501).

- **The pulse lives in the brain — the clock breathes on its own (trin 03 complete).** The
  user DO now schedules its own heartbeat (a DO alarm every 30 minutes — the drawing's own
  economy line): each beat stamps a receipt, looks at the seat board and NAMES stalled seats
  — the stall signal born in the clock itself, not only at a seat's pull. `go_armed` ships
  as the episode's socket (trin 04 plugs in here): a receipted switch behind the crown's
  scope (`memory:replace`), and nothing acts on it yet, by design. New surface:
  `POST /sync/heartbeat` (append scope) · `POST /sync/go` (crown) · status carries the pulse
  home, and `doctor` reads it aloud. Watermark law: breathing is not a change of mind.

- **The stale-base guard — ghost front 6 closed in code, not just in law.** Every pull now
  remembers the watermark it saw (`lastSeenWm`); every union push carries it as `base_wm`.
  A push built on a sky the seat never looked at gets a 409 `stale_base` from the server and
  self-heals: pull, rebase, exactly one retry. Born from the night of 16/07, where a cure was
  overwritten by its own step order ("replace 3098c -> 3098c"). Legacy seats without `base_wm`
  still pass (fail-open for compatibility). Client fix in the same cut: `syncPush` re-reads
  state at write time so a retry's fresh pull is never clobbered by a stale in-memory object.

- **The decide skill — a ruling becomes law, receipted.** `/nogra:decide` records an operator
  decision in the workspace decision log using the drawn shape (Date · Decision · Why ·
  Alternatives considered · Owner · Linked brief/run/evidence) and leaves one ledger receipt.
  Append-only; superseding rulings name what they replace. Claude offers candidate wordings and
  names (English first) — the operator rules and names, always. Born from the operator's own
  design: "intent + source = truth, PLUS N decisions with WHY and HOW."

## 0.8.5 — 2026-07-16 "the doctor release" (the seat closes its own loop)

Born the same day as 0.8.4, from the same war: every manual step the operator had
to take to verify a seat was a product gap wearing a task costume. Four stones,
built one GO at a time; no operator is ever the sync engine again.

- **The root is found upward (S-A).** `sync-cli` walks up from cwd to the nearest
  `.nogra/`; run it from any subdirectory and it binds to the right truth. OUTSIDE
  a workspace it says so LOUDLY and exits 1 — the silent "no changes" that cost a
  round on 16/07 (running from `~`) cannot happen again. `CLAUDE_PROJECT_DIR` still wins.
- **The honest seat (S-B).** The token is INSPECTED, never printed: `status` shows
  seat · scopes · exp (metadata only — the value never leaves the process, smoke-
  enforced). An empty (1 byte!), malformed or expired token fails LOUD on called
  verbs (run/pull/push) with its name, its byte count and its cure — 0 bytes looked
  exactly like success on 16/07, twice. Status now also carries `you`, the full
  seat board (dated "as of last pull") and ROLE COHERENCE: a home-mode seat without
  `memory:replace` gets its 403 foretold, with the cure. Hook edges stay fail-open.
- **The doctor (S-C).** `sync-cli doctor` — the day's two-hour hunts as ONE call:
  eight falsifiable checks, each with its cure. Root(+source) · enabled · endpoint ·
  token metadata · aud binding (the 403 class caught locally) · role coherence · a
  LIVE authorized probe (200 = wm + turns + the seat board by name + latency; 401 =
  "can only be signature/expiry" — authz law quoted in the cure; 403 = aud/scope;
  6s timeout) · bounds in the server's own measure + the receipt tail with verdicts.
- **bind proves itself (S-D).** With a healthy token, `bind` runs the first pull
  itself (which stamps the board) and answers in writing: "seat 'x' is on the board
  (set <ts>)". Missing/empty tokens get honest instructions and a promise: run
  `bind` again after placing it. A dead sky points to `doctor`, exit 1. The nine
  manual board confirmations of 16/07 are dead.
- Smokes: cli 32 -> 52 (+20 guards, incl. "the value is never printed" and a
  deterministic dead-sky probe via loopback). Client suite untouched, 55/55.

## 0.8.4 — 2026-07-16 "the seat release" (seat-awareness, built on the D1-D5 verdicts 15/07; konge-beviset stod samme dag, URET #196)

Sync learns WHO: the clock keeps a seat board, and a seat can never again believe
it is in sync when it is not.

- **The stall-signal (the knock's third leg).** Every pull carries the sæde-tavle home
  (seats' last_seen · last_pushed · dirty — metadata only, never content). When ANOTHER
  seat is active with unpushed state, session start knocks: facts name the seat and the
  Manager weaves an honest staleness line into answers it touches — never blocks, never
  waits. Born from the ghost-war 15/07: three live races this board would have called out.
- **Replace consumes history (server, ghost-front 4 — 16/07).** An accepted `replace` now
  CLEARS the cloud turn log: consolidation ate that history, and leaving it made every
  fresh-cursor pull resurrect the pre-consolidation past into a clean seat (caught live:
  a re-minted seat's first pull replayed two fat old turns straight into a just-cleaned
  brain). Rowids stay monotonic, old cursors stay valid; a refused wipe clears nothing.
  Receipt says how many turns were consumed. Server suite 64/64.
- **The seat reports honestly.** The pull sends one bit — `dirty` — computed from the
  fingerprint machinery that already knows. A landed push clears it on the board.
- **Identity is mint-forged (D1).** The seat's name lives ONLY in the token's `seat`
  claim; tokens minted before seat-awareness read as "ukendt" — visible, never invisible.
  (Server side: `mint-token.mjs --seat <navn>`, seat_board in the user-DO, board on
  /sync/pull, /sync/status and the MCP sync_status tool — the chat surface is a seat too.)
- Process laws booked the hard way: after consolidation = pure push, never pull-first ·
  clean the CLOUD first, empty the seats after (union can never clean).

## 0.8.3 — 2026-07-14

The pulse release: sync stops being an act and becomes a heartbeat — push/pull is
never a manual step again.

- **The tick — RAMMEN's third trigger, live.** `syncTick` runs mid-session on
  `PostToolBatch` (async, zero added latency): debounced to one tick per 20 minutes,
  except a write to either bounded file beats the debounce (push-on-write). The stamp
  is written BEFORE the network calls, so a failing endpoint debounces too — no hot
  loop, and every tick leaves its own receipt (`op:"tick"`, trigger named).
- **Write-detection is clock-skew-proof (grade catch).** The tick's fast-path never
  compares file mtime to the wall clock — they are different clocks and they skew
  (measured live: tmpfs mtime ~4ms behind `Date.now()`, which silently swallowed
  push-on-write). Each tick remembers the bounded files' fingerprints (mtime + size);
  a write is any fingerprint not seen before.
- **The run verb — the one door.** `sync-cli.mjs run` does pull→push in a single
  call with an aggregate receipt (`op:"run"`), honest exit (1 on push failure). The
  same engine the automatic edges and the tick use; "sync now" is now one word.
- **bind guarantees the gitignore law.** `bind` retrofits `memory/sync/` into
  `.nogra/.gitignore` when missing (idempotent, receipted) — the seat file and token
  can never travel via git, even on workspaces initialized before sync existed.
- **The malformed-reply smoke is real now (grade catch).** The stub cloud actually
  serves garbage for one pull; the smoke proves fail-open: note admits the failure,
  local files untouched, error receipt logged. (The old check was a tautology.)
- **The knock-knock (operator's design, verdict "DONE" on the spot) — and it watches
  the WHOLE workspace.** Sync is one system with two legs: the BRAIN rides the hosted
  clock (automatic — pull/push/tick), the TREE rides git (curated commits, operator-
  gated). When either leg couldn't keep its promise — unpushed memory, a failing
  receipt, a bound-but-tokenless seat, a silent seat, **or a tree behind/ahead of its
  upstream (as of the last fetch)** — session start gets ONE honest fact-line
  (`<nogra-sync-nudge>`) offering the matching move: `/nogra:sync run`, a git pull, or
  a curated push that stays the operator's call. The hook emits facts; the Manager
  delivers them in the operator's own register. Nothing here ever pulls or pushes git
  by itself. Knocks BEFORE the pull so "diff" means truth, not fresh-merge noise.
  Silent when sync is off (off is a choice, not a fault) and when everything converged.
- **Ground reads the drawings first (operator's correction, made law).** The ground
  skill gains a step: before proposing on a domain, list and read the workspace's
  canonical drawings for it (a `tegninger/`/`drawings/` registry, or one named in the
  map) — the operator may already HAVE the thing you are about to invent. And a rule:
  a wall is a STOP, never a detour — an unreachable source (403, missing file) means
  stop, say so, hunt local copies; never substitute inference for the drawing.
- **Docs truth-synced.** The sync skill and README now name `run`; skill description
  fits the trigger-metadata bound.

## 0.8.2 — 2026-07-13

The home release: one seat owns consolidation, and the cloud finally learns to forget.
Both changes were proven in production the day they were built — the first replace-push
landed 11:05:54Z and made a consolidation durable for the first time, and the seat-file
fix closed a real incident where "home" traveled to a second machine via git.

- **The home verb: replace.** One seat per user — the HOME, where consolidation lives — may
  now hand the cloud its consolidated state verbatim instead of union-merging. Union-only
  clouds never forget (proven 13/07: a consolidation removed three resurrected index lines,
  one pointing at retired infrastructure — and the next pull would have brought them all
  back). Client: `sync.mode: "replace"` in config routes the session-end push to
  `/sync/replace` (no turns ride along); `bind <endpoint> --home` sets it; status names the
  seat (`home (replace)` vs `remote (union)`); re-bind without the flag never demotes a home.
  Server-side the verb is scope-gated (`memory:replace`, minted with `--home`, never on an
  append token) with a wipe-guard: replacing non-empty state with empty is refused whole,
  with a receipt. Memory bound raised 2200 → 3000 (operator decision, ledger #123 — 2200
  left 5 chars of headroom after a clean consolidation). Smokes: +11 checks across
  client/cli (27+27 green), 9 new server tests (49 green).

- **The seat file: "home" can never travel via git.** Learned live the same day it shipped:
  the home mode briefly lived in `.nogra/config.json`, which is committed — so it traveled
  by git to a second machine and marked THAT seat home too (only the `memory:replace` scope
  fence caught it). The mode now lives in `.nogra/memory/sync/mode` — a gitignored SEAT FILE
  — and where a seat file exists it always wins over any pulled config (tested invariant).
  A seat with NO seat file still honors a legacy config-mode — but the server-side
  `memory:replace` scope fence refuses that push without a home token (403, fail-open
  receipt), and every `bind` strips the mode from the shared config, so the legacy path
  drains itself. `bind --home` writes the seat file and keeps the shared config mode-free;
  status names the effective mode and its source. Smokes: cli 28, client 29, all green.

## 0.8.1 — 2026-07-13

The sync release: the hosted-brain edges ship as a whole — hooks, client and the human
handle — so wiring a seat is one command, never a hand-built bridge. Proven the day it
was cut: the first machine to move in this way was our own (nogra-house, 13/07, its own
hooks pulling the brain on their very first run, 6/6 green).

- **`/nogra:sync` — sync as a function, not a terminal incantation.** One skill, five
  verbs, all backed by `scripts/sync-cli.mjs`: `status` (enabled, endpoint, token
  PRESENCE, last pull/push, cursor, inbox depth, recent receipts — facts, not vibes),
  `pull` / `push` on demand (fail-open, receipt per run, never re-run to "make it
  green"), `bind <endpoint>` (wires a seat: enables sync, HTTPS-only with refusal,
  preserves every foreign config key, leaves a receipt), and `off` (disable, keep the
  endpoint). The binding contract: **the token never passes through the model** — not
  as an argument, not in output, not in chat; status reports presence only, and storing
  the value is the operator's own hand. If the last push says over-budget, the skill
  says what it means (the home consolidates; remote surfaces only remember) instead of
  hiding it. 22 offline smoke checks (`smoke-sync-cli.mjs`) incl. the negatives:
  plain-http refusal, uninitialized workspace, token-silence under both env and file.

- **The boot order, bound.** A new `boot-order` SessionStart hook: any workspace with existing
  Nogra state now gets the ground order injected at every session start, regardless of which
  model answers — checkpoint + tasks, then the ledger tail, then the pinned profile, then THE
  STANDING AGREEMENT for whatever is about to be touched. Yesterday's agreement is law until the
  operator changes it; a GO inherits the plan and never authorizes shortcuts around the drawing.
  Silent on fresh workspaces, static and cache-safe, fail-open. (The covenant's own rule applied
  to booting: a partner that boots right cannot be a session's mood.)

- **Nogra Sync: the local edges (pull at session start, push at session end).** When
  `.nogra/config.json` carries `sync.enabled` and a token exists (env `NOGRA_SYNC_TOKEN` or the
  gitignored `.nogra/memory/sync/token`), the SessionStart hook pulls the hosted brain and
  union-merges it into the native memory home BEFORE the profile pin reads it, and the SessionEnd
  hook pushes the two bounded files back — only when they changed (never pay for unchanged
  state). Remote turns land cursor-gated in `.nogra/memory/sync/inbox.jsonl` as raw material for
  the next consolidation: remote surfaces may remember; only the home cleans up. OFF by default,
  TLS-only endpoints, fail-open always (a broken network never breaks a session), and every run
  — success, skip or failure — leaves a receipt in `.nogra/memory/sync/log.jsonl`. The client
  mirrors the cloud's union-merge semantics exactly so both sides converge. 21 smoke checks over
  a stub cloud (`smoke-sync-client.mjs`), including the negatives (bad token, offline, disabled,
  plain-http refusal), sabotage-tested.

## 0.8.0 — 2026-07-10

The memory release: the full Layer-1 loop (a bounded `USER.md` profile, pinned every session,
maintained by the consolidator) plus the write-loop that keeps durable memory under the load
window. Graded jointly before release (2 HIGH + 5 minor defects, all found and fixed below).

- **The Layer-1 pin: USER.md loads every session.** If the native memory home holds a `USER.md`
  (the bounded user profile), the SessionStart hook now pins it into context every session — on
  top of native auto-memory, never a second copy (the file lives IN the native home). The 1375-char
  bound is a forcing function, not a shredder: an over-bound profile is pinned whole and flagged
  for consolidation. 8 new smoke checks (`smoke-memory-load.mjs`), sabotage-tested.
  **And the write side:** the consolidator contract now MAINTAINS the profile (creates `USER.md`
  by distilling the user/feedback topic files if missing; keeps it under the bound on every pass),
  and the workspace CLAUDE.md + README teach Claude to fold durable user facts into it. Read side
  + write side together = the full Layer-1 loop, smoke-asserted.
- **The retired `.nogra/memory/local/` store is fully unwired.** Path B (0.7.6) moved durable
  memory to Claude's native store but left pointers behind: the init-bundle config
  (`memoryLocal`/`memoryIndex`/`memorySummaries` + a `bootPolicy` hint), the workspaces index
  template, `boot-context.mjs`'s fallback, and — the sharp edge — `/nogra:create` still scaffolding
  the dead directory and re-pointing hub configs at it. All retired; 0.7.6's "no longer scaffolded"
  claim is now true on every path. New negative smokes assert init AND create-project never
  scaffold or reference it. Sabotage-tested.
- **Consolidator: archive-full before in-place rewrites.** The role contract now requires copying
  the untouched original to `memory/archive/<name>-<date>.md` before trimming or merging into any
  file that stays in the root — compression is never the only surviving copy. Smoke-asserted.
- **Setup self-check truth-synced (grade catch).** The setup skill's root allow-list still named
  only `CLAUDE.md`, `inbox/.gitkeep`, `projects/.gitkeep` — predating the two-way inbox (0.7.5) and
  the bundled brain (0.7.6) — so a literal reading aborted every fresh setup. The rule is now
  structural (`CLAUDE.md` plus paths under `inbox/`, `projects/`, `brain/` — nothing else at the
  root) so it cannot drift when a lane gains a file, and the setup preview now names the full
  package.
- **README gate copy truth-synced (grade catch).** The hooks section still claimed match reviews
  "do not send `permissionDecision: allow`" — stale since the 0.7.8/0.7.9 standing-GO ladder. All
  three gate passages now state the shipped behavior: default = context + one extra ask, the
  explicit `gate.autoApprove` opt-in is the only allow lane (class + scope + receipt), hard mode
  can deny, and the gate narrows within Claude Code's permission model, never widens it.
- **Honest failure messages (grade catches).** A corrupt `.nogra/config.json` now reports
  "invalid local config (…)" in text status instead of the misleading "not initialized" (the JSON
  payload already knew). A well-formed but unknown brief id gets a domain message ("no brief with
  that id — save or promote one first") instead of a raw ENOENT. The README's Node.js 18+ promise
  is now enforced in code with a clear stop instead of prose-only.

- **The write-loop: bounded memory consolidation, Manager-in-the-middle.** The SessionStart
  memory bound-check no longer only flags drift — when durable memory grows past what Claude
  actually loads, it nudges an explicit, bounded consolidation the user approves. On GO the
  Manager dispatches a new **`nogra:consolidator`** agent that promotes-before-pruning, *moves*
  (never deletes) superseded notes to `memory/archive/`, and stays scope-fenced (never the
  money-lane). Never silent, never a hoard — a theory of you, kept under the bound. Smoke-covered
  (`smoke-consolidator.mjs`, `smoke-memory-load.mjs`), sabotage-tested.
- **`/nogra:ground` — the re-anchor ritual.** A skill for when a session has drifted: read the
  plan and state, verify claims against facts (never guess — an absence stated as fact is a lie),
  put the hat on, match the operator's register, then hand the next decision back. Ground before
  you propose; the projection is not the truth.

## 0.7.9 — 2026-07-06

- **The authorize ladder is now a permanent smoke** (`smoke-gate-authorize-ladder.mjs`,
  authored by the left-lane executor, graded and integrated by SBX). Drives the real
  PreToolUse hook against temp fixtures and proves all 13 rungs of the standing-GO
  ladder: no intent asks, opt-in-off skips (never allows), class+scope+opt-in is the
  only allow, neighbouring classes still ask, scope-miss asks. Registered inside
  `smoke-local-runtime.mjs`; prints the decision table on every run. Sabotage-tested:
  flipping any expectation turns the smoke red ("a gate door moved"). Test-only —
  no runtime behavior change.

## 0.7.8 — 2026-07-06

- **`/nogra:authorize` can now start the intent it binds to.** The active-intent
  standing-GO lane shipped with a complete read side (prompt-context injection,
  gate matching, smokes) but no producer — nothing ever created
  `.nogra/runtime/active-intent.json`, so authorize always dead-ended on "no
  running intent" (caught by the left-lane executor hitting the deploy gate).
  The skill now offers to start a minimal intent (user-confirmed, objective in
  the user's words, optional scope) using the shape the gate smokes already
  prove. Fail-closed unchanged: no intent still means the gate asks; without a
  declared scope the class is skip-only, never auto-allowed.

## 0.7.7 — 2026-07-06

- **Truth-sync: brain/ ships with the workspace.** 0.7.6 folded the brain into
  the init bundle, but five plugin strings still said "opt-in … never created
  by default" (post-install message, setup + brain-init skills, both
  brain/CLAUDE.md contract copies, brain-init manifest purposes). All now state
  the shipped behavior: brain/ is scaffolded by setup, pull-first, never
  auto-loaded; `/nogra:brain-init` re-scaffolds it if removed. Behavior
  unchanged — copy now matches the manifest (caught by the left-lane executor
  reading the code against the site copy).

## 0.7.6 - 2026-07-06

- The complete package by default: /nogra:setup now scaffolds the full workspace form — CLAUDE.md,
  .nogra/, the two-way inbox/, projects/, AND the brain/ knowledge vault (raw/ -> wiki/ -> index.md).
  Brain stays pull-first (loaded only when you bring it in); it just ships with the structure now
  instead of a separate command.
- Path B memory: durable memory lives in Claude Code'''s own native Auto Memory
  (~/.claude/projects/<slug>/memory/) — Claude writes and loads it; Nogra keeps no parallel copy.
  The SessionStart hook is now a read-only bound-check that flags you to consolidate only when memory
  drifts past what Claude actually loads. The deprecated .nogra/memory/local/ store is no longer scaffolded.
- README rewritten to the full package (memory + brain + verify) with the marketplace install command.
- Pure-local confirmed (no MCP bridge, carried from 0.7.5).

## 0.7.5 - 2026-07-06

- The plugin is now **pure local** — removed the MCP bridge (`.mcp.json` +
  `scripts/mcp-launcher.mjs`). Nothing in hooks, skills, contracts or the local
  runtime depended on it; briefs, dispatch receipts and verification all run on
  the bundled local runtime as before. One less moving part, and the privacy
  line is now literal: the plugin makes zero network calls, full stop.
- The scaffolded `inbox/` is now the **two-way shared desk**: `screenshots/`
  and `drops/` (you → Nogra) and `out/` (Nogra → you — receipts, drafts,
  "ready for GO"; a review tray, not a done tray), plus an `inbox/README.md`
  and a workspace-CLAUDE.md section so a fresh session understands the loop.
- README truth-sync: added the missing **Memory** section (deterministic
  every-session load, 2200/1375 bounds, consolidate-not-hoard, self-learning
  on correction) and updated setup/install wording to match what setup
  actually writes.

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
