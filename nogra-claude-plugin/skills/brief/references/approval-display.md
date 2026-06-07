# Approval Display

Use this as a visual guide for presenting a Nogra brief for approval. This is
not a rigid template. Do not map every brief into the same box. Pick the
sections and visual devices that make the specific brief easy to approve.

The goal is a compact approval artifact: the user should be able to scan scope,
risk, no-go areas, user-owned actions and success criteria in seconds.

## Strong Anatomy

A strong approval display usually has:

- a title block with brief title, `Open brief` link and/or brief id;
- a short goal;
- a simple flow diagram showing the important actors/crossings;
- grouped phases or work packages;
- exact files in scope, with labels like `NEW`, `EDIT`, `READ`, `NO TOUCH`;
- explicit out-of-scope / no-go items;
- stop criteria with visible warning markers;
- user actions before and after dispatch;
- evidence-backed success criteria;
- max output / return shape.

For local promoted briefs, prefer a single bare Markdown file link labeled
`Open brief`:

```md
[Open brief](file:///absolute/path/to/brief.md)
```

Do not wrap that link in backticks, do not label it `Open file`, and do not add
`:1` or any other line suffix to the `file://` URL. If the path contains spaces
or special characters, use the runtime-provided link or an equivalent
URL-encoded file URL.

Omit any section that would be empty or fake. Add a section when the brief has a
brief-specific concern that matters for approval.

## Visual Devices

Use a small, consistent vocabulary. Examples:

```text
✓ success / acceptance
! stop / escalation
x out of scope / no-go
NEW new file
EDIT changed file
READ reference only
GO explicit approval point
NO PUSH / NO DEPLOY / NO SECRET GENERATION
```

Use boxes, tables, columns or arrows only when they improve scanning. ASCII is
fine. Plain bullets are fine. The format should serve the brief, not the other
way around.

## Flow Pattern Ideas

For execution flow, show the real shape without over-specifying implementation:

```text
user trigger -> manager brief -> dispatch -> executor -> evidence -> verification
```

or:

```text
cron/request
   ↓
component or entrypoint
   ↓
important crossing
   ↓
result/evidence
```

Use the actual nouns from the task. Avoid generic placeholders in the final
approval display.

## Phase Pattern Ideas

Phases should group work by decision-relevant risk, not by arbitrary code order:

```text
Phase 1  Build bounded surface
         - route / component / adapter
         - auth / allowlist / validation

Phase 2  Wire existing system
         - one config flag
         - preserve default behavior

Phase 3  Verify and return
         - exact commands/evidence
         - no push unless approved
```

Change the phase names and count for the actual brief. One phase is fine. Five
phases are fine if the work actually needs it.

## Good Approval Display Traits

- It is shorter than the full brief.
- It makes scope and no-go areas impossible to miss.
- It separates user-owned actions from executor-owned actions.
- It shows stop conditions before dispatch.
- It uses checkmarks only for criteria that evidence can prove.
- It keeps implementation detail below the approval threshold.
- It has visual rhythm: whitespace, grouping, short labels and clear sections.

## Anti-Patterns

- Do not paste raw markdown as the approval display.
- Do not paste JSON, runtime payloads, handoff prompts, transport internals or schemas.
- Do not force every brief into the same exact layout.
- Do not use decorative boxes that make the text harder to read.
- Do not hide important uncertainty inside dense paragraphs.
- Do not turn success criteria into vague vibes like "looks good".
- Do not turn evidence collection chores such as "take a screenshot" or "open
  the file" into success criteria. Show the outcome being proven; keep the
  evidence method separate.
- Do not let the approval display become longer than the actual brief.
