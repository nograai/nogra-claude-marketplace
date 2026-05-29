# Nogra Claude Marketplace

Claude Code marketplace for Nogra.

Nogra is free. Sync is later.

## Install

```bash
claude plugin marketplace add nograai/nogra-claude-marketplace
claude plugin install nogra@nogra-claude
```

Then in a project:

```bash
cd my-project
claude
```

```text
/nogra:setup
```

For an existing project, run:

```text
/nogra:adapt
```

For a hub workspace with several projects:

```text
/nogra:create my-project
```

## LLM Workspace Shape

Single project:

```text
my-project/
  .nogra/
  CLAUDE.md
  ...
```

Manager hub with several projects:

```text
my-workspace/
  .nogra/
  CLAUDE.md
  projects/
    project-a/
      .nogra/
      CLAUDE.md
      ...
    project-b/
      .nogra/
      CLAUDE.md
      ...
```

Rules for Claude:

- Hub `.nogra/` owns the project index and hub behavior.
- Each project owns its own `.nogra/` state.
- Starting Claude inside a project uses the nearest `.nogra/config.json`.
- Starting Claude in a hub lists indexed projects; naming a project focuses
  `projects/<workspaceId>/` without a `cd`.
- Boot is read-only: no full memory load, no ledger write, no dispatch.

Command flow:

- `/nogra:setup` creates the hub or project `.nogra/` domain structure.
- `/nogra:create <name>` creates `projects/<workspaceId>/` with its own
  project-local `.nogra/` and registers it in the hub index.
- `/nogra:adapt` reads an existing project and writes project-specific Nogra
  notes without changing app files.

## What Nogra Adds

- Brief first: define the answer key before work starts.
- GO gate: execution starts only after the approved brief.
- Dispatch: scoped work runs as executor work.
- Evidence: the run returns concrete checks and artifacts.
- Verification: the result is checked against the brief, not vibes.
- Local ledger: records live in `.nogra/` in your project.

## License

Apache-2.0.
