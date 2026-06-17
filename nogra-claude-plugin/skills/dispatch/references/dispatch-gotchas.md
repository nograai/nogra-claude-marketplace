# Dispatch Gotchas

Use this reference before dispatching or when a run returns weak evidence.

## Brief Is Not GO

Symptom: execution starts after the brief is drafted but before user approval.

Cause: approved scope and execution approval were merged.

Action: require explicit GO after the user has seen the brief.

## Main Chat Becomes Executor

Symptom: the Manager conversation implements the dispatched scope inline.

Cause: role-runtime boundary collapsed.

Action: keep Manager as control surface. Executor role performs scoped
implementation through the available runtime or clearly reports when that
runtime is unavailable.

## Weak Self-Report

Symptom: executor says work is done but evidence is thin, truncated or polished.

Cause: self-report was treated as verdict evidence.

Action: treat self-report as a claim only. Verify against files, diffs,
commands, artifacts, screenshots or other independent evidence.

## One-Shot Runtime Promise

Symptom: Manager promises to wait for a background result in a client that
cannot return it before command exit.

Cause: runtime capability was assumed.

Action: return the queued run id and say verification is pending.

## Scope Drift

Symptom: executor performs adjacent cleanup or changes outside the brief.

Cause: approved scope was too loose or not enforced on return.

Action: record the drift as a deviation. Do not call it ship unless the user
approves the changed scope.
