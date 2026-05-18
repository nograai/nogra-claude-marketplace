---
name: adapt
description: Teach Nogra an existing workspace after init. Use when the user runs /nogra:adapt, asks Nogra to adapt to this project, or wants Claude to map the current workspace without changing app files.
---

# Nogra Adapt

Use this skill after `/nogra:init` when the current folder is an existing
project and the user wants Nogra to understand it.

Adapt is local workspace understanding. It is not an MCP authority gate, not a
brief, not dispatch, and not verification.

## Boundary

Adapt may read project files and write only local `.nogra/` notes. It must not
edit app files, `CLAUDE.md`, `.claude/`, package files, git config, hooks,
presets, templates or optional pinboard files.

Do not call Nogra MCP tools for adapt. Do not draft a brief unless the user
separately asks for one. Do not spawn agents.

## Entry

1. Confirm the current working directory in one short sentence.
2. Verify `.nogra/config.json` exists.
   - If it is missing, stop and tell the user to run `/nogra:init` first.
   - If it exists but is invalid JSON, stop and ask before touching `.nogra/`.
3. Tell the user what adapt will do:

```text
I can adapt Nogra to this existing project by reading the workspace and writing
a small project map under `.nogra/`. I will not change app files or Claude Code
config. I will show the planned `.nogra/` updates before writing them.
```

## Read Pass

Read enough context to identify structure without crawling the whole repo:

- top-level file list;
- README or project docs if present;
- package/build manifests such as `package.json`, `pyproject.toml`,
  `Cargo.toml`, `go.mod`, `requirements.txt`, `pnpm-lock.yaml` only as needed;
- app/source directories and obvious entrypoints;
- existing `.nogra/PROJECT-STRUCTURE.md`, `.nogra/SESSION-CHECKPOINT.md` and
  `.nogra/DECISIONS.md`.

Do not read secrets or bulky generated directories. Skip `.git`, `node_modules`,
`.next`, `dist`, `build`, `coverage`, `.venv`, caches, logs and binary assets
unless the user explicitly points to them.

## Preview

Before writing, show a compact preview:

- project type and likely entrypoints;
- important paths Nogra will record;
- boundaries or no-go areas Nogra should remember;
- exact `.nogra/` files to update;
- statement that no app files will be changed.

Ask for explicit GO before writing.

## Write Rules

After GO, write only these files:

- `.nogra/PROJECT-STRUCTURE.md`
- `.nogra/SESSION-CHECKPOINT.md`
- `.nogra/DECISIONS.md`

Use managed sections so user notes are preserved:

```text
<!-- nogra-adapt:start -->
...
<!-- nogra-adapt:end -->
```

If a managed section already exists, replace only that section. If it does not
exist, append one. Preserve all text outside the managed section.

Do not update `.nogra/CURRENT-TASKS.md` unless the user explicitly states active
tasks to record. Do not invent active work from repository structure.

## Content Shape

`PROJECT-STRUCTURE.md` managed section should contain:

- project type/framework when evident;
- key source directories and entrypoints;
- build/test commands only when evident from manifests;
- important app boundaries and files Nogra should avoid;
- where Nogra records live.

`SESSION-CHECKPOINT.md` managed section should contain:

- current state: Nogra initialized and adapted to this workspace;
- resume instruction: use `/nogra:brief` for scoped work or `/nogra:verify`
  for evidence checks.

`DECISIONS.md` managed section should contain only factual workspace decisions
already evident from files or explicitly confirmed by the user. If none are
known, write that no project decisions were recorded by adapt.

## Output

End with:

```text
Nogra adapted this workspace without changing app files.
- Updated: <paths>
- Preserved: existing notes outside Nogra's managed sections
- Next: use /nogra:brief for the first scoped piece of work
```
