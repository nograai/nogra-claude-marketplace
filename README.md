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

The hooks are state surfaces, not policy gates. Pull-first does not mean no
hooks ever run: in an initialized workspace, Nogra may run local lifecycle and
convergence hooks so it can keep continuity state and ask at permanent-risk
boundaries. Those hooks stay local, should stay silent for ordinary work, and
do not score prompts, maintain a separate safety layer, draft briefs, dispatch
work or mark verification green. Skills own the Nogra workflow, and Claude
Code's native permission model remains responsible for tool permissions.

## Turn Off or Uninstall

Nogra has two separate off switches.

For one workspace, remove or rename that folder's `.nogra/` directory. That
turns off Nogra's workspace state, ledger, routing and convergence checks for
that project, but it does not uninstall the Claude Code plugin from your
machine.

For the plugin itself, use Claude Code's plugin manager:

```text
/plugin
```

Open the Installed tab, choose Nogra, then Disable or Uninstall. You can also
use the CLI with the exact plugin id shown by `/plugin` or
`claude plugin list`:

```bash
claude plugin disable nogra@nogra-claude
claude plugin uninstall nogra@nogra-claude
```

If you disable or uninstall during an active Claude Code session, run
`/reload-plugins` or restart Claude Code before trusting the loaded plugin
state. Do not edit `settings.json` by hand unless Claude Code explicitly tells
you to; plugin scope can be user, project or local.

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
- `/nogra:watch`: inspect recent local hook events when you need visibility.
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

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) (version
3.0). Report concerns to conduct@nogra.ai.

## License

Apache-2.0.
