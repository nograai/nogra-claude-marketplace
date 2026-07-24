---
name: nogra-sync
description: Show, run or configure both Nogra Sync legs — brain status/run/pull/push with receipts, bind a seat, turn sync off, or inspect and explicitly move the git tree with its deterministic ledger check. Use only when the user runs /nogra:sync or explicitly asks about sync state, the brain, the tree between seats, or wiring this machine.
---

# Nogra Sync

The sync edges normally run themselves: pull at session start, push at session end,
receipts on everything. This skill is the HUMAN handle on those edges — for seeing
state, forcing an edge to run now, or wiring a new seat — so nobody ever hand-edits
config or copy-pastes terminal lines to make sync work.

Everything here runs through one tool: `scripts/sync-cli.mjs`, resolved relative to
this skill's base directory (two levels up = the plugin root):

```bash
node "<plugin-root>/scripts/sync-cli.mjs" <verb>
```

## Boundary

- Touch ONLY the `sync` block of `.nogra/config.json` and files under
  `.nogra/memory/sync/` — and only via the CLI verbs below. No manual edits.
- **The token never passes through the model. Ever.** Never ask the user to paste a
  token into the chat, never read the token file, never echo `NOGRA_SYNC_TOKEN`.
  Status reports presence (env / file / missing) — that is all you may know.
- Sync moves DATA, never auth: endpoints and receipts are speakable; token values
  are not, anywhere, including "just the first characters".
- This skill does not create or reset endpoints/tokens server-side. Provisioning a
  cloud brain is outside the plugin; the user brings their endpoint + token.

## Verbs

### `/nogra:sync` (no args) → status

Run `sync-cli.mjs status` and present it compactly: enabled, endpoint, token
presence, last pull/push, cursor, inbox depth, and the recent receipts. Read
receipts as facts, not vibes — a `FAIL` line names its error; quote it.

If the last push receipt carries `OVER-BUDGET`, say what it means: the bounded
files exceed the cloud bound, and the HOME seat should consolidate (remote surfaces
may remember; only the home cleans up). Suggest the consolidation flow; do not
start it from here.

### `/nogra:sync run`

The never-manual door: ONE call that runs the full cycle — pull, then push — and
leaves an aggregate receipt (`op:"run"`) on top of the edges' own. This is the same
engine the automatic edges and the mid-session tick use, and the verb to reach for
when someone says "sync now". Exit is honest: 1 when the push failed. Relay both
result lines faithfully, exactly as with pull/push below.

### `/nogra:sync pull` · `/nogra:sync push`

Run the matching verb and relay the result line verbatim-faithfully (merged files,
turns landed, skipped:unchanged, or the failure + "session continues on local
state"). Both are fail-open and leave their own receipts — never re-run to "make it
green"; report what the receipt says.

### `/nogra:sync bind <endpoint>` (add `--home` for the home seat)

Wires THIS seat to a sync endpoint: enables sync in `.nogra/config.json`, creates
the sync directory, and reports token presence. HTTPS only (loopback http allowed
for tests) — the CLI refuses anything else; do not work around a refusal.

`--home` marks this seat as the HOME: its push uses the replace verb (the cloud is
handed the consolidated state verbatim instead of union-merged), which is what lets
a consolidation actually stick — union-only clouds never forget. Exactly ONE seat
per user is home, and it needs a token minted with the `memory:replace` scope; the
server refuses replace on append-only tokens with an honest 403 receipt. All other
seats stay union (remote surfaces may remember; only the home cleans up).

If the token is missing, relay the CLI's instructions and stop there: storing the
token is the operator's own hand (their shell profile, or the gitignored token
file). Offer the `!`-prefix so the command runs in their session without you
composing the secret.

After a bind with a present token, offer a `pull` as the handshake proof — the
first receipt with this seat's own timestamp is the "it works" moment.

### `/nogra:sync tree` · `tree pull` · `tree push`

The TREE leg moves workspace history between seats through git. It is never
automatic:

- `tree` fetches read-only, reports ahead/behind, shows commits and files as the
  reading plan, and checks both ledger tails for watermark collisions.
- `tree pull` performs a fast-forward pull only when the check is clean and the
  local tree is strictly behind.
- `tree push` pushes only when the check is clean and the local tree is strictly
  ahead.
- A diverged tree or watermark collision is gated. Report the named cure; there
  is no force flag or implicit conflict resolution.

Fetch is a read, but pull and push are state changes and require the operator to
name the movement explicitly. Every check and movement writes a receipt with
`op:"tree"`, `tree-pull`, or `tree-push`. Hooks and automatic sync edges must
never invoke this leg.

### `/nogra:sync off`

Disables sync (keeps the endpoint for an easy re-bind). Confirm with the receipt.

## Register

Answer in the operator's language. Keep status to one screen; this is a gauge
panel, not a lecture. When something failed, lead with the receipt line and what
still works (fail-open means the session never depended on the cloud).
