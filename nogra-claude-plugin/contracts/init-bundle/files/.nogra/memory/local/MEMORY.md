# Nogra Memory Index

schema: nogra.memory.index.v1
workspace: {{workspaceName}}
authority: advisory-continuity
reuse_rule: index-first; verify current facts against `.nogra/state`, project files, git, and evidence before acting

## Task Group: local setup

scope: Local Nogra setup for this workspace.
applies_to: cwd={{workspacePath}}
reuse_rule: safe for local setup and continuity hints; verify project files before acting
keywords: setup, checkpoint, current tasks, decisions, project structure
pointers:
- .nogra/state/PROJECT-STRUCTURE.md
- .nogra/state/SESSION-CHECKPOINT.md
- .nogra/state/CURRENT-TASKS.md
- .nogra/state/DECISIONS.md

