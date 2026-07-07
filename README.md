# Nogra Claude Marketplace

Official public Claude Code marketplace for Nogra.

Nogra gives Claude Code a memory, a conscience, and a second brain — local-first,
on the plan you already pay for. A bounded memory Claude keeps between sessions, a
`brain/` knowledge vault for deep work, and a verify-before-done gate: on work with
real scope or risk, you approve a short plan first, the work runs, then the result
is checked against that plan before it is called done.

Nogra is pull-first. Ordinary chat, code edits, debugging and implementation stay
direct unless you ask for Nogra. When the work needs a clearer contract, Nogra
gives you local briefs, dispatch receipts, evidence records, verification support
and workspace continuity under `.nogra/`. Everything it knows is a file you own,
and it never touches your credentials.

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

- Memory: durable memory in Claude Code's own native Auto Memory
  (`~/.claude/projects/<slug>/memory/`) — Claude writes and loads it; Nogra keeps it
  bounded so it stays a theory of you, not an archive, and self-learns from your
  corrections.
- Brain: a `brain/` knowledge vault (`raw/` → `wiki/` → `index.md`) that ships with
  the workspace, pull-first — loaded only when you bring it in for deep work.
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
- `/nogra:brain-init`: re-scaffold the `brain/` knowledge vault if it was removed.
- `/nogra:brief`: shape scoped work into an approved brief.
- `/nogra:dispatch`: dispatch an approved brief after GO.
- `/nogra:authorize <boundary>`: record a standing GO for a risk boundary class
  on the running intent — starting a minimal intent (user-confirmed) when none is running.
- `/nogra:verify`: check a claim or result against evidence.
- `/nogra:status`: show plugin, workspace, ledger and recent run state.
- `/nogra:settings`: inspect or update runtime/language settings.
- `/nogra:update`: refresh local Nogra guidance.
- `/nogra:watch`: inspect recent local hook events when you need visibility.
- `/nogra:help`: choose the right Nogra flow.

## Workspace Shape

A workspace Nogra sets up has the full form:

```text
my-project/
  CLAUDE.md        # your workspace constitution
  .nogra/          # local trust source: state, index, briefs, evidence, receipts
  brain/           # deep-work knowledge vault (raw/ -> wiki/ -> index.md), pull-first
  inbox/           # two-way desk: screenshots/ drops/ (you -> Nogra), out/ (Nogra -> you)
  projects/        # optional hub sub-projects, each with its own .nogra/
```

Durable memory lives in Claude Code's own native store
(`~/.claude/projects/<slug>/memory/`), kept bounded by Nogra — not copied under `.nogra/`.

Workspace hub with several projects:

```text
my-workspace/
  CLAUDE.md
  .nogra/          # hub records own the project index
  brain/           # one central vault at the hub — never copied per project
  inbox/
  projects/
    project-a/
      CLAUDE.md
      .nogra/      # each project owns its own state
      ...
    project-b/
      CLAUDE.md
      .nogra/
      ...
```

The nearest `.nogra/config.json` owns the active workspace. Hub `.nogra/`
records own the project index; each project owns its own `.nogra/` state.

## Official Links

- Website: https://nogra.ai
- Agent guide: https://nogra.ai/agent
- LLM index: https://nogra.ai/llms.txt
- Public marketplace source: https://github.com/nograai/nogra-claude-marketplace
- MCP server (separate, optional — not bundled in the plugin):
  [`io.github.nograai/nogra-mcp`](https://registry.modelcontextprotocol.io/?q=nogra) on the
  official MCP Registry · [`@nograai/mcp`](https://www.npmjs.com/package/@nograai/mcp) on npm

## License

Apache-2.0.
