---
name: nogra-setup
description: Set this folder up for Nogra. Use when the user runs /nogra:setup, asks to set up Nogra in this folder, enable this project for Nogra, or prepare a workspace after installing the Nogra plugin.
---

# Nogra Setup

Nogra enables the current folder as a workspace. The plugin provides the Nogra
skills and local runtime; this setup flow creates the local `.nogra/` domain
structure needed for boot, project discovery, briefs, runs, evidence,
checkpoints and local memory.

Use this flow when the user runs `/nogra:setup` or asks to set up Nogra in this
folder. If the user asks whether Nogra can be installed without overwriting
their files, use wording like:

```text
Yes. We can go through exactly what Nogra will write before I change anything.
Setup writes `.nogra/config.json`, the standard `.nogra/` domain folders and
the local `.nogra/index/` five-anchor files, plus empty `inbox/` and
`projects/` folders at the workspace root. It preserves app files,
`.claude/`, package files, git config, hooks, presets and templates. It may
create a minimal root `CLAUDE.md` only when the workspace does not already have
one, so Claude has a visible local Nogra orientation on future sessions.
There's also an opt-in `brain/` deep-work vault — never created by default;
run `/nogra:brain-init` when you want it. Project-specific facts are refined
later by `/nogra:adapt`, after Nogra has actually read this workspace.
```

If the user just installed or updated the plugin inside an already-running
Claude Code session, tell them to restart or reopen Claude Code first. Plugin
changes load at session startup.

Read `references/gotchas.md` before diagnosing setup failures, plugin update
drift, permission-denial reports or user complaints about Nogra setup friction.

## Flow

Pre-flight (before any step): verify Node.js is available — Nogra's local runtime
is a Node script. If `node` is not on PATH, stop and tell the user that Nogra
setup needs Node.js 18+; do not write partial files.

Claude Code Bash-safe command style: use one simple command per Bash tool call
with absolute paths. Do not use `$PWD`, `&&`, heredocs or root assignments in
Bash tool calls. If a JSON payload is needed, write it to a
workspace-local temp file first, then pass `--input <path>`.
Replace `<absolute-workspace-root>` below with the confirmed absolute path of
the folder being set up.

1. Confirm the current working directory in one short sentence.
2. Inspect the folder and report whether it is empty, already Nogra-enabled or
   an existing project.
3. Ask the user to proceed with value-first language and make the merge-safe
   boundary explicit. Use wording like:

   "I'll set up Nogra in this folder so you can write briefs, dispatch approved
   work, and verify evidence before calling it done. This creates the local
   `.nogra/` state structure; your existing code stays untouched.
   Project-specific facts can be refined later by `/nogra:adapt`, and new hub
   projects can be created with `/nogra:create`. Before I write anything, I'll
   show the file groups Nogra plans to create or merge. Ready to proceed?"

   Adapt the tone to the conversation. Lead with what the user gains, not with
   what the system writes.
4. Ask for explicit GO before writing files. This explicit Nogra GO is required
   even in auto-mode or greenfield sessions.
5. Read the local init bundle from the local runtime:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" init-bundle --root "<absolute-workspace-root>" --json
```

   Pass `--workspace-name "<name>"` only when the user explicitly names the
   workspace.
6. Before writing anything, verify the returned bundle is the local plugin
   setup bundle and contains only allowed setup files. Validate these fields
   directly from the returned JSON instead of reading an extra reference file:
   - setup mode is `plugin`;
   - server mode is `plugin-local`;
   - connection mode is `local`;
   - setup came from the local plugin runtime, not a remote setup path;
   - the only allowed root non-`.nogra/` paths are `CLAUDE.md`,
     `inbox/.gitkeep` and `projects/.gitkeep`;
   - root `CLAUDE.md` uses `writePolicy=create_if_missing`;
   - no returned file path starts with `.claude/`.
   If any check fails, stop immediately and do not write files.
7. Treat the returned plugin-mode bundle as the local source of truth. Write
   only the returned files into this folder, using each file's `path`,
   `content`, `writePolicy` and `installPlan`.
8. Before writing files, present a compact preview:
   - the folder being initialized;
   - the number of files to create, merge, preserve or skip;
   - the fact that plugin-mode setup creates `.nogra/config.json`, standard
     `.nogra/` domain folders, state files and `.nogra/index/` five-anchor
     files, plus root `CLAUDE.md` when missing and empty root `inbox/` and
     `projects/` folders;
   - any existing files that will be preserved or merged.
9. For `.nogra/config.json`, use merge-preserve behavior:
   - If the file does not exist, create it from the returned content.
   - If it exists and is valid JSON, add missing default keys from the returned
     config while preserving existing user-set values, thresholds and unknown
     keys.
   - If it is an older plugin config, preserve user-set values and merge missing
     defaults; the local runtime resolves it as local.
   - If it exists and is invalid JSON, stop and ask before replacing it.
   - Report which config values were preserved.
10. For all other files, preserve the returned `writePolicy`.
   - `create_if_missing`: create only if absent; otherwise preserve.
   - `create_or_update`: update only Nogra-owned files returned by plugin-mode
     setup; do not apply this to app files because plugin-mode bundles must not
     include app paths.
   - `ask_before_overwrite`: show the path and wait for explicit user approval.
   - For an existing root `CLAUDE.md`, preserve it and report that Nogra root
     guidance already exists.
11. Before deleting or editing old Nogra workspace files, inspect
   `migration.clientScanTargets`; if matching files exist, show
   `migration.userPrompt` and wait for explicit user approval.
12. Never overwrite, remove or rename Claude Code connection config entries
    from this setup flow. If a reserved Nogra connection-name conflict exists,
    surface it and stop.
13. Use Claude Code Write/Edit/read-then-rewrite to apply the previewed files,
    or use the local runtime apply path only after explicit GO:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" init --apply --root "<absolute-workspace-root>" --json
```

14. Show final written, updated, preserved and failed counts plus the returned
    post-install message. Include that the default workflow used local `.nogra/`
    records.
15. Offer `/nogra:adapt` or `/nogra:create` as the next step:

```text
Nogra is installed. If this is an existing project, I can run `/nogra:adapt`
next to read the workspace and write Nogra's project map and resume notes into
`.nogra/` without changing app files.

If this folder should manage several projects, use `/nogra:create <name>` to
create `projects/<workspaceId>/` with its own project-local `.nogra/`.
```

## Boundaries

- During setup, do not write any `.claude/` files. The plugin owns Nogra
  behavior; the workspace owns its local Nogra records under `.nogra/`.
- Create root `CLAUDE.md` only when missing. Preserve an existing project
  `CLAUDE.md`.
- Do not write providers, presets, provider handoff templates, skills, commands
  or wrappers from plugin setup.
- Do not edit application files.
- Do not run wrappers, daemons, archive installers or repository checkouts.
