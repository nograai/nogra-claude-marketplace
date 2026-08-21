---
name: nogra-drawings
description: "Keep the canonical drawings home: a drawing published as an artifact saves its source in the workspace's drawings/ registry with one index line, is read ONCE when grounding on its domain, and rides into intent BY REFERENCE (name x source x artifact URL), never as carried content. Use when publishing a drawing artifact or on /nogra:drawings."
---

# Nogra Drawings

A drawing is a canonical design document — the operator's plan for a domain, often
published as an artifact so humans can read it rendered. This skill keeps drawings
REAL: home in the repo, findable in one registry, read at the right moment, and
carriable by intent without ever being smeared across turns as transcript.

The registry is the workspace's `drawings/` directory with its `drawings/index.md`
(a workspace map may name another location; older workspaces may still carry the
Danish name `tegninger/` — same store, same law).

## The law (born 14/07 — the wall-lesson)

**A drawing that lives only behind a URL is not a drawing — it is a hope.**
No artifact-drawing is published without BOTH:

1. its source file saved in the drawings registry, and
2. one line in the registry's `index.md` naming: title, domain, artifact URL
   (for the human), local source path (for the machine), and status.

The wall (a 403, a dead link, a moderated post) may come: the drawing lives at home.

## Read-once, then the rhythm

A drawing is **read ONCE** — when grounding on its domain, before building on it
(the boot-order's "read the standing agreement for what you are about to touch").
After that read, work runs the normal rhythm: docs, turn, turn, docs. The drawing
is NOT re-carried forward as a summary, a referat, or pasted content — re-reading
happens by opening the source again at the next ground, never by trusting a
carried copy. A carried copy drifts; the source does not.

## Carried to intent — by reference

Intent must be able to cross **artifact × drawing**: a brief, dispatch, or
intent-grant that builds on a drawing carries a `drawing` reference —

```
drawing: { name, source: "drawings/<file>", artifact: "<artifact URL or none>" }
```

— the REFERENCE rides with the intent; the content never does. The receiver
(executor, PM, verifier) reads the drawing once at their own ground, from the
named source. Pointing at a drawing in a goal or brief names BOTH the artifact
URL (the human's door) and the local path (the machine's door).

## Verbs

### `/nogra:drawings` (no args)

Read the registry's `index.md` and present it compactly: name, domain, status.
Flag any row whose local source is missing on disk — that row is a hope, not a
drawing; name it as a repair, do not silently pass it.

### `/nogra:drawings save`

The publish flow, in order: write the source file into the drawings registry →
add the index line (title · domain · artifact URL · local path · status) →
publish the artifact from that source file. Publishing first and saving later is
the failure this verb exists to prevent.

### `/nogra:drawings carry <name>`

Emit the intent-reference form for the named drawing (name, source path,
artifact URL), ready to embed in a brief or intent-grant. Refuse if the drawing
is not in the registry — carrying an unregistered drawing is carrying a hope.

## Rules

- **Inventory before invention.** The operator may already HAVE the drawing you
  are about to draw. List the domain's registry rows FIRST; drawing a new one
  when asked to show an existing one is the classic failure.
- **A drawing is the operator's word.** Never edit or redraw one without their
  explicit word; a GO to build inherits the drawing and never authorizes
  shortcuts around it.
- **The reference rides, the content stays home.** Never inline a drawing's body
  into an intent record, a brief, or a hand-off message.
- **Historical receipts keep their old paths.** A registry rename (e.g.
  `tegninger/` → `drawings/`) updates the live map and registry only — receipts
  are history and are not rewritten.
