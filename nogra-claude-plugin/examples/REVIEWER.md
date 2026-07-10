# Nogra Reviewer Examples

These examples demonstrate the current local Nogra plugin. Run them in the
sample workspaces under this `examples/` folder, not in the Nogra plugin source
repo.

Nogra runs locally. It requires no account and makes no network calls.

## 1. Set up a workspace

Workspace:

```text
examples/reviewer-setup/
```

Prompt:

```text
Can you help me set up Nogra in this folder?
```

Expected behavior:

- Nogra previews local setup writes before changing anything.
- The user gives explicit GO before setup applies.
- Local `.nogra/` state is created.
- A root `CLAUDE.md` is created only if missing.
- Existing files are preserved.

## 2. Build something

Workspace:

```text
examples/reviewer-task-tracker/
```

Prompt:

```text
Build me a small local task tracker in this workspace.
```

Expected behavior:

- Nogra treats the request as scoped work.
- Nogra shapes a brief before implementation.
- The user approves the brief before dispatch.
- The approved work is dispatched.
- Verification checks the result against the approved brief and local evidence.

## 3. Save a checkpoint

Workspace:

```text
examples/reviewer-task-tracker/
```

Prompt:

```text
Save a checkpoint of what we did, what changed, and what remains.
```

Expected behavior:

- Nogra writes a local checkpoint under `.nogra/state/`.
- The checkpoint records completed work, evidence checked and remaining next
  steps.
- No external service or account is required.
