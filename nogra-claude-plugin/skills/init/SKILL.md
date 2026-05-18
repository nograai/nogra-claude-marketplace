---
name: init
description: Install Nogra in the current folder. Use when the user runs /nogra:init, asks to install Nogra in this folder, set up Nogra here, enable this project for Nogra, or initialize a Nogra workspace after installing the Nogra plugin.
---

# Nogra Init

Nogra installs per folder. The plugin provides the Nogra skills and MCP
connection; this init flow creates local workspace state for the current folder.

Use this flow when the user runs `/nogra:init` or asks to install Nogra in this
folder. If the user asks whether Nogra can be installed without overwriting
their files, answer directly:

```text
Yes. We can go through exactly what Nogra will write before I change anything.
In plugin mode, init only writes the local `.nogra/` workspace state. It does
not edit your app files, `.claude/`, package files, git config, hooks, presets,
templates or pinboard files. It may create a minimal root `CLAUDE.md` only when
the workspace does not already have one, so Claude has a visible local Nogra
orientation on future sessions.
```

If the user just installed or updated the plugin inside an already-running
Claude Code session, tell them to restart or reopen Claude Code first. Plugin
changes load at session startup.

## Flow

1. Confirm the current working directory in one short sentence.
2. Inspect the folder and report whether it is empty, already Nogra-enabled or
   an existing project.
3. Ask the user to proceed with value-first language and make the merge-safe
   boundary explicit. Use wording like:

   "I'll set up Nogra in this folder so you can write briefs, dispatch approved
   work, and verify evidence before calling it done. This only adds the local
   workspace state Nogra needs; your existing code stays untouched. Before I
   write anything, I'll show the file groups Nogra plans to create or merge.
   Ready to proceed?"

   Adapt the tone to the conversation. Lead with what the user gains, not with
   what the system writes.
4. Ask for explicit GO before writing files. This explicit Nogra GO is required
   even in auto-mode or greenfield sessions.
5. Before calling init, call `registry` and verify that the active Nogra
   MCP is the hosted plugin MCP:
   - `boundary.hostedMode` must be `true`.
   - `status` should be `v1-hosted-validation`.

   If the registry shows local/non-hosted mode, stop. Tell the user the Claude
   Code session is calling a local/private MCP server still registered as
   `nogra` instead of the plugin-managed hosted MCP. `nogra` is reserved for
   hosted/plugin mode; local/private development should use `nogra-dev`. Do not
   continue with init.
6. Call the Nogra MCP tool `init` with:

```json
{
  "workspace_name": "",
  "mode": "plugin"
}
```

Leave `workspace_name` empty unless the user explicitly names the workspace.

7. If first use opens browser OAuth, say that browser sign-in is expected.
8. If hosted Nogra returns closed-beta or access-denied, explain that the plugin
   is installed but server access requires beta approval. Do not call it a local
   install failure.
9. If hosted Nogra is unreachable, stop with a retry message. Do not create a
   local fallback bundle.
10. Before writing anything, verify the returned bundle is the plugin-mode
   bundle:
   - `initMode` must be `plugin`.
   - `serverMode` must be `hosted-public`.
   - The only allowed root non-`.nogra/` path is `CLAUDE.md`, and it must use
     `writePolicy=create_if_missing`.
   - No returned file path may start with `.claude/`.

   If any of those checks fail, stop immediately and do not write any files.
   Tell the user the session received the standalone Nogra init bundle instead
   of the plugin bundle, then ask them to restart Claude Code with the Nogra
   plugin loaded and run `/nogra:init` again.
11. Treat the returned plugin-mode bundle as the server-side source of truth.
   Write only the returned files into this folder, using each file's `path`,
   `content`, `writePolicy` and `installPlan`.
12. Before writing files, present a compact preview:
   - the folder being initialized;
   - the number of files to create, merge, preserve or skip;
   - the fact that plugin-mode paths must stay under `.nogra/`, except root
     `CLAUDE.md` when missing;
   - any existing files that will be preserved or merged.
13. For `.nogra/config.json`, use merge-preserve behavior:
   - If the file does not exist, create it from the returned content.
   - If it exists and is valid JSON, add missing default keys from the returned
     config while preserving existing user-set values, thresholds and unknown
     keys.
   - If it exists and is invalid JSON, stop and ask before replacing it.
   - Report which config values were preserved.
14. For all other files, preserve the returned `writePolicy`.
   - `create_if_missing`: create only if absent; otherwise preserve.
   - `create_or_update`: update only Nogra-owned files returned by plugin-mode
     init; do not apply this to app files because plugin-mode bundles must not
     include app paths.
   - `ask_before_overwrite`: show the path and wait for explicit user approval.
   - In plugin mode, never overwrite an existing `CLAUDE.md`; preserve it and
     report that Nogra root guidance already exists.
15. Before deleting or editing old Nogra workspace files, inspect
   `migration.clientScanTargets`; if matching files exist, show
   `migration.userPrompt` and wait for explicit user approval.
16. Never overwrite, remove or rename Claude Code MCP config entries from this
    init flow. If an MCP server-name conflict exists, surface it and stop.
17. Show final written, updated, preserved and failed counts plus the returned
    post-install message.
18. Offer `/nogra:adapt` as the next step for existing projects:

```text
Nogra is installed. If this is an existing project, I can run `/nogra:adapt`
next to read the workspace and write Nogra's project map into `.nogra/` without
changing app files.
```

## Boundaries

- Do not write any `.claude/` files in plugin mode. The plugin owns Nogra
  behavior; the workspace owns its local Nogra records under `.nogra/`.
- In plugin mode, create root `CLAUDE.md` only when missing. Do not overwrite
  an existing project `CLAUDE.md`.
- Do not write providers, presets, provider handoff templates, skills, commands,
  wrappers or pinboard files from plugin init.
- Do not edit application files.
- Do not run wrappers, daemons, archive installers or repository checkouts.
