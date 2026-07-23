# Session Checkpoint

Workspace: {{workspaceName}}
Created: {{generatedAt}}
Updated: {{generatedAt}}
SourceWatermark: 0

## Current State

Nogra is initialized locally for this workspace.

If this is a Manager hub, projects should live under `projects/<workspaceId>/`
and each project should own its own `.nogra/` folder.

## Verification

- Setup created the local `.nogra/` domain structure.
- SessionStart must remain detector-only: checkpoint existence does not imply
  resume, and no boot state loads broad state, writes, dispatches or grants GO.

## Next

- Use `/nogra:create <name>` to create a project under `projects/<workspaceId>/`.
- Use `/nogra:adapt` inside an existing project to write project-specific state.
