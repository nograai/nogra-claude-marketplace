---
name: create
description: Create a project under a Nogra Manager hub. Use when the user runs /nogra:create, asks to create a new Nogra project folder, or wants a hub workspace to manage a new project under projects/<workspaceId>/.
---

# Nogra Create

Use this skill after `/nogra:setup` when the current folder is a Manager hub and
the user wants a new project folder under `projects/<workspaceId>/`.

Create is a scaffold. It does not copy app code, dispatch work, run agents or
infer project decisions.

## Shape

```text
my-workspace/
  .nogra/
  projects/
    project-a/
      .nogra/
```

The hub `.nogra/` owns project discovery. The project `.nogra/` owns project
state.

## Flow

1. Confirm the current working directory in one short sentence.
2. Verify `.nogra/config.json` exists in the current folder.
   - If missing, stop and tell the user to run `/nogra:setup` first.
   - If invalid JSON, stop and ask before touching `.nogra/`.
3. Extract the project name from the command or user request.
   - `/nogra:create client-app` -> `Client App` or `client-app`
   - If the name is missing, ask for the project name.
4. Generate the read-only preview:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" create-project "<name>" --root "$PWD" --json
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
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-local.mjs" create-project "<name>" --root "$PWD" --apply --json
```

8. Report the created project path, hub-index update and project self-index.
9. Tell the user they can stay in the hub and name the project to focus it, or
   `cd` into the project if they want project-local boot.

## Boundaries

- Write only inside the current hub folder.
- Default project path is `projects/<workspaceId>/`.
- Refuse to overwrite a non-empty destination.
- Do not copy source code from another project.
- Do not edit app files, git config, provider config, secrets or `.claude/`.
- Do not enable sync.
- SessionStart remains read-only: no full memory load, no write, no dispatch.
