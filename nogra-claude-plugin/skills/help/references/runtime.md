# Nogra Runtime Configuration

This reference describes Nogra's runtime preference settings and status/version
reporting.

## Term: local runtime

In Nogra docs, *local runtime* means the plugin-bundled scripts under
`scripts/` (primarily `scripts/nogra-local.mjs`) that maintain `.nogra/`
workspace state. Skill instructions refer to "the local runtime" when they
mean these bundled scripts. The term is plugin-internal mechanics - not a
separate execution layer like Node.js or a JVM.

The local runtime owns:

- Reading and writing `.nogra/config.json`
- Promoting brief drafts to approved briefs
- Recording transport runs and verification support under `.nogra/transport/`
- Resolving role models and effort from runtimePolicy or release fallback

## Runtime Profile

Use local `.nogra/config.json` `runtimePolicy` for Nogra's default/custom
runtime preference.

Defaults:

- `profile`: default
- `roles`: empty until the user chooses custom runtime values
In this plugin release, `profile: default` resolves to Sonnet/medium for the
executor role and Sonnet/medium for the verifier role. Those concrete values are
not written into default config because the user has not chosen custom runtime
settings.

Use `/nogra:settings` to view or change runtimePolicy.

## Executor And Verifier Agents

The Nogra plugin registers `executor` and `verifier` from its own
`agents/` directory with default Sonnet/medium frontmatter. The bundled agents
stay inside the plugin and are not copied into this workspace's
`.claude/agents/`.

When `profile: custom`, `roles.executor` and `roles.verifier` describe desired
disposable run-agent routing for each approved run. Include these settings in
brief and dispatch handoffs when relevant, and request them directly when the
client/runtime can honor per-run model and effort overrides.

If the runtime cannot honor custom values, report the limitation plainly.
Claude Code's own model and effort display remains the source of truth for live
model/effort state.

## Status And Versions

When the user asks for Nogra status or version, include:

- installed Nogra plugin id/ref from the plugin session context when available;
- local runtime status;
- workspace `releaseVersion` from `.nogra/config.json`.

Report the active Nogra build directly so the user does not need to inspect
Claude Code's raw `/plugin` menu.
