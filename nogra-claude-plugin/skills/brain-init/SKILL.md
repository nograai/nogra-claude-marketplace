---
name: nogra-brain-init
description: Re-scaffold the brain/ knowledge vault. Use when the user runs /nogra:brain-init, wants brain/ re-created after removing it, or wants the raw/wiki knowledge vault in a workspace that lacks one.
---

# Nogra Brain Init

`brain/` is the workspace's deep-work knowledge vault. It ships with the
workspace (`/nogra:setup` scaffolds it via the init bundle) and is never
auto-loaded. Use this skill only when the user explicitly asks — to
re-scaffold a removed `brain/`, or to add the vault to an older workspace
created before the brain shipped in the bundle.

## Shape

```text
my-workspace/
  brain/
    raw/
    wiki/
    index.md
    CLAUDE.md
```

`raw/` holds immutable sources. `wiki/` holds compiled pages. `index.md` is
the entry point once pages exist. `brain/CLAUDE.md` is thin pull-first
guidance — it tells Claude to read `index.md` first and only when the work
actually needs deep background, and it is never auto-loaded at session start.

This skill scaffolds empty folders and thin guidance only. It does not write
any content, wire any auto-load hook, or copy source material into `brain/`.

## Flow

Claude Code Bash-safe command style: use one simple command per Bash tool call
with absolute paths. Do not use `$PWD`, `&&`, heredocs or root assignments in
Bash tool calls. Replace `<absolute-workspace-root>` below with the confirmed
absolute path of the current workspace.

1. Confirm the current working directory in one short sentence.
2. Verify `.nogra/config.json` exists in the current folder.
   - If missing, stop and tell the user to run `/nogra:setup` first.
3. Generate the read-only preview:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brain-init --root "<absolute-workspace-root>" --json
```

4. If `brainExists` is already `true` in the returned payload, tell the user
   `brain/` already exists and this skill only fills in files that are
   missing — nothing is overwritten. Still ask before writing, since it may
   add a missing file.
5. Present a compact preview: the files to be created (`brain/raw/`,
   `brain/wiki/`, `brain/index.md`, `brain/CLAUDE.md`), and that no content or
   auto-load hook is added.
6. Ask for explicit GO before writing.
7. After GO, apply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" brain-init --apply --root "<absolute-workspace-root>" --json
```

8. Report the written/preserved counts from the result. Tell the user
   `brain/` is empty by design — they fill it deliberately, and nothing in it
   auto-loads.

## Idempotency

Every file this skill writes uses `create_if_missing`. Running this skill
again on a workspace that already has `brain/` changes nothing that already
exists; it only reports the existing state and fills in anything genuinely
missing. Never overwrite existing `brain/` content.

## Boundaries

- Write only inside the current workspace's `brain/` folder.
- Do not add content, sample notes or example pages.
- Do not wire a SessionStart hook, auto-load rule or any mechanism that reads
  `brain/` without being asked.
- Do not edit `.nogra/`, app files, git config or `.claude/`.
- Do not run this skill automatically from other flows; it runs only when the
  user asks. (`/nogra:setup` ships `brain/` on its own via the init bundle.)
