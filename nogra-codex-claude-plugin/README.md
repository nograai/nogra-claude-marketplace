# Nogra Codex Claude Code Plugin

`nogra-codex` is an optional provider plugin for Nogra.

Nogra owns the workflow. This plugin owns Codex execution when a user
explicitly asks to hear from Codex.

The current folder must be initialized with Nogra first. If `.nogra/config.json`
is missing, `/nogra-codex:*` commands stop and ask the user to run `/nogra:init`.

## Purpose

Use this plugin when a user says something like:

```text
Claude, ask Codex why this page is lagging.
Claude, gider du spørge Codex hvad vi overser?
Codex, hvad kan jeg gøre her?
```

The plugin keeps that as consult-on-demand. It does not turn the request into a
Nogra brief and it does not mutate the workspace by default.

## Commands

- `/nogra-codex:setup` checks whether local Codex CLI is available.
- `/nogra-codex:consult` sends a read-only consult packet to Codex.
- `/nogra-codex:status` lists recent Codex consult runs.
- `/nogra-codex:result` prints a previous Codex consult result.

## Runtime

This plugin uses the user's existing local Codex CLI and auth. It does not store
secrets, install Codex, or proxy through Nogra.

Consult artifacts are written to:

```text
.nogra/providers/codex/runs/
```

Each run writes the prompt, Codex's raw final output, stderr/stdout logs and a
receipt. The chat receives a clean Codex answer plus a compact artifact pointer.

## Boundary

Correct:

```text
Nogra stays provider-agnostic.
nogra-codex owns Codex execution.
User decides whether to act on Codex advice.
```

Incorrect:

```text
Nogra bundles Codex.
Claude improvises raw codex exec | tail plumbing.
Manager applies Codex advice without user approval.
```
