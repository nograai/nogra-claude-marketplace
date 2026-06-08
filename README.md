# Nogra Claude Marketplace

Official public Claude Code marketplace for Nogra.

Nogra adds an optional workflow layer to Claude Code: approve the plan, run the
work, then verify the result against the plan before it is called done.

Nogra is pull-first. Ordinary chat, code edits, debugging and implementation
stay direct unless you ask for Nogra. When the work needs a clearer contract,
Nogra gives you local briefs, dispatch receipts, evidence records, verification
support and workspace continuity under `.nogra/`.

## Install

Nogra requires Node.js 18+ on your PATH. The local runtime is a small Node
script used by the plugin hooks and skills.

```bash
claude plugin marketplace add nograai/nogra-claude-marketplace
claude plugin install nogra@nogra-claude
```

Then start Claude Code in the folder where you want Nogra active:

```bash
cd my-project
claude
```

Set up local Nogra state:

```text
/nogra:setup
```

For an existing project, run:

```text
/nogra:adapt
```

For a workspace that manages several projects:

```text
/nogra:create my-project
```

## What Nogra Adds

- Brief: approved scope, success criteria, stop criteria and evidence shape.
- Dispatch: execution of an approved brief after explicit GO.
- Verify: a separate check against the brief and available evidence.
- Workspace state: project-local records for checkpoints, decisions, current
  tasks, briefs, runs, evidence and receipts.
- Lifecycle continuity: lightweight hooks for session boot, compaction resume,
  session end and workspace-project focus.

The hooks are state surfaces, not policy gates. They do not score prompts,
inspect tool calls, maintain a separate safety layer, draft briefs, dispatch
work or mark verification green. Skills own the Nogra workflow, and Claude
Code's native permission model remains responsible for tool permissions.

## Commands

- `/nogra:setup`: enable the current folder for Nogra.
- `/nogra:adapt`: read an existing project and write Nogra's local project map.
- `/nogra:create <name>`: create a project-local Nogra workspace under a hub.
- `/nogra:brief`: shape scoped work into an approved brief.
- `/nogra:dispatch`: dispatch an approved brief after GO.
- `/nogra:verify`: check a claim or result against evidence.
- `/nogra:status`: show plugin, workspace, ledger and recent run state.
- `/nogra:settings`: inspect or update runtime/language settings.
- `/nogra:update`: refresh local Nogra guidance.
- `/nogra:help`: choose the right Nogra flow.

## Workspace Shape

Single project:

```text
my-project/
  .nogra/
  CLAUDE.md
  ...
```

Workspace hub with several projects:

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

The nearest `.nogra/config.json` owns the active workspace. Hub `.nogra/`
records own the project index; each project owns its own `.nogra/` state.

## Official Links

- Website: https://nogra.ai
- Agent guide: https://nogra.ai/agent
- LLM index: https://nogra.ai/llms.txt
- Public marketplace source: https://github.com/nograai/nogra-claude-marketplace

## License

Apache-2.0.
