# Decisions

Workspace: {{workspaceName}}
Updated: {{generatedAt}}

## Local Decisions

Use this shape for material decisions:

```text
Date:
Decision:
Why:
Alternatives considered:
Owner:
Linked brief/run/evidence:
```

## Initial Decisions

- Date: {{generatedAt}}
  Decision: Nogra local records live in `.nogra/`.
  Why: Workspace-local records are inspectable and preserve project ownership.
  Alternatives considered: Hosted-only state; transcript-only memory.
  Owner: Workspace operator.
  Linked brief/run/evidence: setup init bundle.
- Date: {{generatedAt}}
  Decision: Memory is advisory continuity, not project truth.
  Why: Current files, git state, `.nogra/state` and evidence outrank memory.
  Alternatives considered: Treat memory as authority.
  Owner: Workspace operator.
  Linked brief/run/evidence: `.nogra/config.json` memoryPolicy.
- Date: {{generatedAt}}
  Decision: SessionStart is detector-only: no full memory load, no write, no dispatch.
  Why: Boot should orient Claude without creating action or state drift.
  Alternatives considered: Automatic boot writes or full memory load.
  Owner: Workspace operator.
  Linked brief/run/evidence: `.nogra/config.json` bootPolicy.
