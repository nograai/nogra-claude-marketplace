---
description: Create a project under a Nogra Manager hub
argument-hint: "<project-name>"
allowed-tools: Bash(node:*)
---

Create a project under the current Nogra Manager hub.

Raw slash-command arguments:
`$ARGUMENTS`

Follow this flow exactly:

1. Confirm the current working directory in one short sentence.
2. Verify `.nogra/config.json` exists in the current folder.
   - If missing, stop and tell the user to run `/nogra:setup` first.
   - If invalid JSON, stop and ask before touching `.nogra/`.
3. Extract the project name from `$ARGUMENTS`.
   - If the name is missing, ask for the project name.
4. Generate the read-only preview:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" create-project "$ARGUMENTS" --root "$PWD" --json
```

5. Present a compact preview:
   - hub folder;
   - new project path;
   - workspace id;
   - files Nogra will create under the new project `.nogra/`;
   - hub files that will be updated: `.nogra/config.json` and
     `.nogra/index/workspaces.jsonl`;
   - statement that no app files are copied or edited.
6. Ask for explicit GO before writing.
7. After GO, apply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" create-project "$ARGUMENTS" --root "$PWD" --apply --json
```

8. Report the created project path, hub-index update and project self-index.
9. Tell the user they can stay in the hub and name the project to focus it, or
   `cd` into the project if they want project-local boot.

Boundaries:

- Write only inside the current hub folder.
- Default project path is `projects/<workspaceId>/`.
- Refuse to overwrite a non-empty destination.
- Do not copy source code from another project.
- Do not edit app files, git config, provider config, secrets or `.claude/`.
- Do not enable sync.
- SessionStart remains read-only: no full memory load, no write, no dispatch.
