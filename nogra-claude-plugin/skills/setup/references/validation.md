# Setup Validation

Before writing setup files, verify the local runtime returned the expected
plugin setup bundle:

- setup mode is plugin
- server mode is plugin-local
- connection mode is local
- setup came from the local plugin runtime, not a remote setup path
- the only allowed root non-`.nogra/` path is `CLAUDE.md`
- root `CLAUDE.md` uses `writePolicy=create_if_missing`
- no returned file path starts with `.claude/`

If any check fails, stop before writing files and report the failed field.
