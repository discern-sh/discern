# Documenter agent brief

This file is read by every documenter agent that produces or refreshes a subtree
under `map/`. Each agent also receives a per-subtree **scope manifest** at
`map/_internal/scopes/{subtree}.md` (copy
[`scopes/_template.md`](scopes/_template.md) to start one) that complements this
brief with the specific files to read, the area the agent owns, and any known
overlaps.

This brief is the constant; the scope manifest is the variable.

The
[`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md)
skill dispatches this brief — invoke it to document or refresh a subtree rather
than working freehand.

---

## Your role

You are documenting one subtree of the documentation tree. The tree shape, the
orientation tier, the glossary, and the canonical terminology are already in
place — your job is to fill in the leaves of your assigned subtree, plus its
`README.md`.

You may not be the only documenter agent working in parallel. Do not stretch
your scope to cover things another agent owns. If you discover overlap, flag it
in your summary rather than absorbing it.

---

## Who owns what

This brief owns **structure**: which pages exist, each page's one job, its
section shapes, its facts, and its length budgets. The
[voice skill](../../skills/discern-voice-and-tone/SKILL.md) owns **register**:
how the prose sounds inside those structures — the docs-surface mix, the banned
tics, the delight ceiling. Write to both; when a question is about shape or
size, this brief answers it, and when it is about word choice, stance, or
temperature, the skill answers it.

The map is public documentation: the published tiers render on the docs site,
in `discern help`, and over MCP. Three approved pages are the reference corpus
for what a finished page reads like — the
[docs landing page](../README.md), the
[quickstart](../10-installer/quickstart.md), and
[Files & ownership](../10-installer/artifact-ownership.md). Calibrate against
them, not against older neighbours.

---

## Read first (mandatory, in this order)

1. **`map/README.md`** — the documentation tree's table of contents. Confirms
   your subtree's position and its neighbours.
2. **`map/00-orientation/concepts.md`** — the canonical naming source. Use its
   capitalised nouns verbatim. Do not introduce synonyms.
3. **`map/00-orientation/glossary.md`** — precise definitions. Cross-link to
   entries here; do **not** redefine terms in your leaves.
4. **The [voice skill](../../skills/discern-voice-and-tone/SKILL.md)** — the
   register your pages hold, and the banned moves the gate's prose lint
   watches for.
5. **Your scope manifest** at `map/_internal/scopes/{your-subtree}.md`. It lists
   the source files to read, the area you own, and known integration points /
   overlap warnings.
6. **The source files** listed in your manifest. Read whole files where they are
   small. For large directories, get a listing first and read the most central
   files in full; sample the rest.

---

## Audience

Your subtree serves a layered audience:

- **`README.md` in your subtree** — newcomers and visitors. 200–350 words,
  plain language, no internal jargon. The canonical capitalised nouns from
  `concepts.md` are fine. End with a table of the leaves, one line each.
- **Child docs (leaves)** — users of discern reading the published docs, plus
  future-you and the AI agents grounding a change. 400–800 words each. Precise,
  file-pathed, stating the invariants that are not obvious from the code.

If your subtree's audience contract differs (e.g. an existing plain-English
deep-dive the project values), your scope manifest will say so.

---

## Page shapes

[`page-templates.md`](page-templates.md) holds the five page-type skeletons —
overview, quickstart, guide, reference, troubleshooting — with the budget and
register mix each carries. Pick the shape that matches the page's one job; the
subsystem-leaf template below is the guide shape specialised for documenting a
code subsystem, and remains the default for leaves in a numbered subtree.

## Per-doc template (subsystem leaf)

```markdown
---
title: Short label            # only when the H1 runs long
description: One-line summary for search results and section tables.
order: NN
---

# Title

_One-line summary._

## What it is

2–3 plain-English paragraphs. State what the thing is and why it exists.

## How it works

The mechanism, step by step. Inline `[file](relative/path)` for every code
claim. If the mechanism is sequential, use a numbered list. If it is a state
machine or branching logic, prefer prose.

## Key concepts

Bullet list of glossary terms relevant to this leaf, each a cross-link:
`[Term](../00-orientation/glossary.md#term)`. Do not redefine here.

## Where it lives in code

| Concept | File                               |
| ------- | ---------------------------------- |
| ...     | `[Thing](../../path/to/Thing.ext)` |

## Configuration

The knobs that tune this behaviour, one line each. Only those your subtree owns.

## Integration points

- **Upstream**: who calls this / sends to it
- **Downstream**: what this writes to / dispatches

## Current state & gotchas

Things a future reader would be surprised to learn. Quote any TODO/FIXME/HACK
comments verbatim. Note half-built features, recently-changed code, reserved or
dead config, and known footguns. This section is high-value-per-word; do not
skip it just because the happy path is well covered.
```

Skip sections that do not apply to a given leaf. Do not invent sections.

---

## Frontmatter

Every published page carries frontmatter; the gate validates it against a
closed schema ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)),
so an unknown key or out-of-shape value fails `discern done` rather than
vanishing. The keys:

| Key             | Rule                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `title`         | Short label for nav, breadcrumb, and `<title>` — max 48 chars. Only when the H1 runs long.       |
| `description`   | 50–160 chars. Fronts search results and section tables; say what the page does, no padding.      |
| `order`         | Non-negative integer; unique among published siblings; leave gaps of 10.                         |
| `publish`       | `false` withholds the page from every published surface. The sole page-level withhold.           |
| `redirect_from` | Absolute historical routes this page now answers for (`/docs/...`, no trailing slash).           |
| `aliases`       | Search synonyms: renamed terms, CLI spellings.                                                   |

Frontmatter is metadata, not content: rendered surfaces strip the block, and
the H1 stays the long-form canonical title on the page. Only flat `key: value`
scalars and `- item` lists parse.

## ADR citations

Cite decision records as liberally as reasoning requires — density is handled
at render time, not by you ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)).
Every citation in a published tier takes the one strippable form: a
parenthetical group of linked citations at clause end, e.g.
`([ADR 0140](../_adr/0140-….md))`, comma-separated when a clause cites several.
The invariant the gate enforces: **the sentence reads correctly with the
citation deleted** — a citation is never the grammatical subject.

---

## Hard rules

1. **Use names that appear in code.** Do not invent abstractions. If a thing has
   no named type, describe it by the real pieces it is made of — name what is
   real.
2. **Verify every file path before writing it.** Use a listing if uncertain. A
   hallucinated path is the most expensive defect to fix later.
3. **No modal verbs about the system.** Banned: `should`, `would`, `could`,
   `will eventually`, `is intended to`. Describe only what exists in code today.
   If something is half-built, write "Currently does X; does not yet do Y."
4. **Cross-link with relative paths.** Never a leading `map/` — you are inside
   `map/`.
5. **Cross-link within your subtree liberally; do not link across subtrees.**
   Inter-subtree links are added in a later polish pass by the orchestrator.
6. **Glossary additions go in your summary, not your leaves.** If you find a
   term that ought to be glossary-defined, list it in your summary; do not
   append a glossary section to a leaf.
7. **Document scope overlap; do not silently expand.** If you find code that
   clearly belongs to another subtree, describe the overlap in your summary and
   let the orchestrator resolve it.
8. **Length budget.**
   - 200–350 words per README.
   - 400–800 words per leaf — a **hard ceiling**, not a target. (Other page
     shapes carry their own budgets — see
     [`page-templates.md`](page-templates.md).)
   - If a leaf would exceed 800 words, **split it** into two with descriptive
     filenames and flag the split in your summary. Do not silently overrun.
9. **No code samples unless they clarify what a path cannot.** A `[file](path)`
   link is almost always enough. Reserve code blocks for a small grammar (a
   config shape) or a genuinely tricky interface.
10. **Register belongs to the voice skill.** Hold its docs-surface mix — plain,
    precise, convinced — and its banned moves; the gate's prose lint warns on
    the mechanical tells. Delight is a ceiling of one per page and zero in
    reference and troubleshooting material.

---

## What "good output" looks like

- A newcomer reading your `README.md` understands what the subtree is about in
  60 seconds and knows which leaf to read next.
- A returning contributor who has not seen this code in months finds the right
  leaf and re-orients in two minutes.
- An agent that needs to make a change finds the file path it needs in 30
  seconds.

If any of those break, the doc is too thin or too thick.

---

## Deliverable

1. Write every `.md` file listed in your scope manifest. Each replaces its
   existing stub.
2. Give every published page valid frontmatter (at minimum `description`, and
   `order` for published siblings).
3. Return a short summary covering:
   - **What you covered** — one bullet per leaf, with its headline claim.
   - **TODO/FIXME notes** — quote any in-code comments you preserved under
     "Current state & gotchas".
   - **Glossary additions/refinements** — terms that ought to be defined or
     sharpened in the glossary.
   - **Subtree-overlap observations** — code you noticed that belongs in another
     subtree.
   - **Deprecation candidates** — anything that looks half-built, abandoned, or
     redundant.

Do not commit. Do not run the full gate. Do not edit anything outside
`map/{your-subtree}/`.
