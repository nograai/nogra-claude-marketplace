---
name: nogra-sync
description: Show, run or configure Nogra Sync (the hosted-brain edges) — status with receipts, pull/push on demand, bind a seat to an endpoint, or turn sync off. Use only when the user runs /nogra:sync or explicitly asks about Nogra sync state, pulling/pushing the brain, or connecting this machine to their sync endpoint.
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

### `/nogra:sync off`

Disables sync (keeps the endpoint for an easy re-bind). Confirm with the receipt.

## Register

Answer in the operator's language. Keep status to one screen; this is a gauge
panel, not a lecture. When something failed, lead with the receipt line and what
still works (fail-open means the session never depended on the cloud).
