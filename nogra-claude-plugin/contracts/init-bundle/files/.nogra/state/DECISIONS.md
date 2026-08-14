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
  Decision: SessionStart uses explicit `fresh`, `detected`, `focused`, `resumed` and `recovering` states; checkpoint existence is detection only.
  Why: Boot should orient Claude without loading continuity state, implying resume or creating authority/action drift.
  Alternatives considered: Checkpoint-implies-resume, automatic boot writes or broad state loading.
  Owner: Workspace operator.
  Linked brief/run/evidence: `.nogra/config.json` bootPolicy.
