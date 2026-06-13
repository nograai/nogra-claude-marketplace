# Nogra Connections And Risk Registry

Workspace: {{workspaceName}}
Created: {{generatedAt}}

Record what this workspace can reach and what actions need fresh approval.
Never store credentials, tokens, private keys or secrets in this file.

## Registry

| System | Mechanism | Read | Write | Risk boundary | Evidence source | Last checked |
|---|---|---:|---:|---|---|---|
| Git history | local git | yes | gated | history | `git status`, diff, log | {{generatedAt}} |
| Workspace files | filesystem | yes | task-scoped | app/code/data | file diff and tests | {{generatedAt}} |

## Boundary Meanings

- `read`: information gathering only.
- `task-scoped write`: edits inside the current direct task.
- `gated`: requires explicit current intent/GO or a dispatch receipt.
- `forbidden`: do not touch without a new operator decision.

## Approval Notes

- Production deploy:
- Data migration:
- Customer send:
- Billing/payment:
- Permissions/auth:
- Secrets/env:
- Git history:
