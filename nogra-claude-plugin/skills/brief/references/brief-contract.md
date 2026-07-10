# Brief Contract

Use the local runtime contract and bundled schema as the source of truth for
`nogra.brief.v1`.

## Required Shape

A brief captures:

- intent
- context handoff
- scope in/out and scope files when known
- success criteria
- stop criteria
- evidence required
- return policy

Optional sections such as decisions, rejected paths, known gaps and execution
shape are included only when they carry signal for the approved work.

## Execution Shape

Use `executionShape` only when the approved work materially needs non-default
evidence or tool shape.

Prefer `toolNeeds` as plain evidence/tool need declarations:

- source review
- read-only inspection
- file checks
- diff review
- command output
- screenshot or rendered-output evidence when the brief actually needs it

Use `toolFamilies` only as a compatibility override. Use `knownGaps` only when
the gap changes the route, stop criteria or approval decision.

## Template And Schema Sources

The brief template and schema live in plugin contracts:

- `contracts/templates/brief-v1.md`
- `contracts/schemas/brief-v1.schema.json`

Do not invent additional brief templates inside the skill body.
