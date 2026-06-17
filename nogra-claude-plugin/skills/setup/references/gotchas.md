# Setup Gotchas

Use this reference when setup behaves differently from the happy path.

## Plugin Updated During A Running Session

Symptom: the installed plugin version or skill text looks stale after update.

Cause: plugin changes load at session startup. Skill text can update more
often, but hooks, agents and plugin config need a reload/restart boundary.

Action: tell the user to restart or reopen Claude Code after plugin updates.
Do not compensate by writing workspace files again.

## Permission Denial During Setup

Symptom: Claude reports a read/write denial while setup validation is supposed
to be local.

Cause: setup tried to read an extra reference or path outside the allowed local
flow, or the workspace root was inferred incorrectly.

Action: validate the init bundle fields directly from the runtime JSON. Do not
require an extra validation-reference read to decide whether setup is safe.

## Setup Wants To Write `.claude/`

Symptom: the returned bundle includes `.claude/`, provider settings, hooks,
commands or plugin config.

Cause: setup boundary drifted from workspace state into Claude Code
configuration.

Action: stop. Plugin-mode setup may write `.nogra/` and root `CLAUDE.md` only
when missing. It must not write `.claude/`.

## User Asks If Existing Files Are Safe

Symptom: user is worried Nogra will overwrite app files.

Action: lead with the merge-safe promise. Setup creates or merges local
`.nogra/` records and preserves existing app files, package files, git config,
provider config, `.claude/` and existing root `CLAUDE.md`.

## Invalid Existing Config

Symptom: `.nogra/config.json` exists but is invalid JSON.

Action: stop and ask before replacing it. Do not write partial setup files.
