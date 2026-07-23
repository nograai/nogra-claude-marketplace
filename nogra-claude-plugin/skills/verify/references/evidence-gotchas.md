# Evidence Gotchas

Use this reference before returning a Nogra verification verdict.

## Same-Agent Verification

Symptom: the same agent that did the work signs off on completion.

Cause: execution and verification authority were collapsed.

Action: treat the executor report as a claim surface. Use independent tree,
diff, test, artifact, screenshot or manual evidence for the verdict.

## Useful Anyway Substitution

Symptom: the result is useful but does not match the approved brief.

Cause: usefulness was allowed to override acceptance criteria.

Action: return `deviation`, not `ship`, unless the user approves the changed
scope.

## Visual-Only Evidence

Symptom: a screenshot looks good but the claim involves interaction,
persistence, routing or responsive behavior.

Cause: static preview evidence was overextended.

Action: mark missing interaction evidence explicitly. A screenshot can support
visual claims; it does not prove behavioral claims by itself.

## Stale Or Ambiguous Artifact

Symptom: artifact exists but may come from an older run or another workspace.

Cause: path, timestamp, run id or workspace root was not tied to the claim.

Action: require current path/timestamp/run linkage before using it as verdict
evidence. Save it through `evidence-save`; a later digest mismatch blocks use.

## Memory Or Sync Claim

Symptom: MEMORY.md, USER.md or a synchronized line says work is complete or
verified.

Cause: advisory continuity was treated as workspace fact authority.

Action: keep the line at `reported`. It can only become stronger through a
canonical evidence receipt, fact record and—when verified—a ship verdict or
verified operator record.

## No Brief

Symptom: the user asks whether direct work is done without a Nogra brief.

Action: verify best-effort against the user's stated request and collected
evidence. Do not pretend a formal brief existed.

## Missing Evidence

Symptom: tests or proof were not run, but the output looks plausible.

Action: return `unverified` or `blocked` depending on what can be known. State
what evidence would move the verdict to `ship`.
