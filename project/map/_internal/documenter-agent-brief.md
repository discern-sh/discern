# Documenter agent brief

Every documenter agent that produces or refreshes a subtree under the configured Map directory follows this brief. Each agent also receives a **scope manifest** at `_internal/scopes/{subtree}.md`. Copy [`scopes/_template.md`](scopes/_template.md) to create one. The manifest names the files to read, the assigned area, and known overlaps.

Use this brief for shared requirements. Use the scope manifest for assignment-specific requirements.

Invoke the [`discern-document-subsystem`](../../../templates/skills/discern-document-subsystem/SKILL.md) Skill to document or refresh a subtree. The Skill dispatches this brief and the matching scope manifest.

---

## Your role

Your assignment is one subtree of the documentation tree. Preserve the existing tree shape, orientation tier, Glossary, and canonical terminology. Produce the assigned leaves and their `README.md`.

Other documenter agents may work in parallel. Stop at the boundary in your scope manifest. If you discover overlap, leave the overlapping files unchanged and record the evidence in your summary.

---

## Maintaining the Map

Treat documentation as part of the change. Every page describes the current code. When a change alters documented behavior, update its page in the same commit. The Gate treats a stale page as a defect. Define terminology once in the [Glossary](../00-orientation/glossary.md) and use it identically everywhere. Ground each implementation claim with a link to its source file.

---

## Who owns what

For **structure**, follow this brief: page inventory, page purpose, section shape, required facts, and length budgets. For **register**, follow the [product voice Skill](../../skills/discern-product-voice/SKILL.md): voice behavior, terminology, and banned moves. Apply both authorities to every page.

The maintained Map includes orientation, contributor, and operational `_internal` pages. `_private` is the only prose-free geography. `discern map` browses this configured knowledge tree; the docs site, `discern docs`, and the Model Context Protocol (MCP) serve the separate product manual. The Map prose job and Standard govern every maintained non-private Map page. Compare every finished page with the [Map landing page](../README.md), the [quickstart](../10-getting-started/quickstart.md), and [Files and ownership](../70-reference/artifact-ownership.md).

---

## Read first (mandatory, in this order)

1. **[Map README](../README.md)** — the documentation tree's table of contents. Confirm the assigned subtree and its neighbors.
2. **[Concepts](../00-orientation/concepts.md)** — the canonical naming source. Use its capitalized nouns verbatim.
3. **[Glossary](../00-orientation/glossary.md)** — the precise definitions. Link leaves to existing entries. The term registry at `scripts/glossary_registry.ts` owns the generated page: edit the registry and run `deno task codegen` for any approved term change. The vocabulary Standard rejects bold `**term** — …` restatements in leaves, requires a new term to appear on a page in the same change, and rejects retired synonyms. Bold linked terms remain valid.
4. **The [product voice Skill](../../skills/discern-product-voice/SKILL.md)** — the register your pages hold and the banned moves the Gate's prose lint watches for.
5. **Your scope manifest** at `_internal/scopes/{your-subtree}.md`. It lists the source files to read, the area you own, and known integration points and overlap warnings.
6. **The source files** listed in your manifest. Read whole files where they are small. For large directories, get a listing first and read the most central files in full; sample the rest.

---

## Audience

Your subtree serves a layered audience:

<!-- project-page-shape-use: subtree README | overview -->

- **`README.md` in your subtree** — newcomers and visitors. Use the [overview shape](page-templates.md#overview), plain language, and the canonical capitalized nouns from `concepts.md`. End with a table of the leaves, one line each.

<!-- project-page-shape-use: numbered-subtree leaf | guide -->

- **Child docs (leaves)** — users reading the published docs, returning maintainers, and coding agents grounding a change. Use the shape named by the scope manifest; the [guide shape](page-templates.md#guide--concept) is the default. Use precise paths and state invariants that the code does not make obvious.

If your subtree's audience contract differs (e.g. an existing plain-English deep-dive the project values), your scope manifest will say so.

---

## Page shapes

[`page-templates.md`](page-templates.md) holds the supported page shapes and owns each default budget. Every scope-manifest row names the shape that matches the page's primary job. The [subsystem-leaf template](#per-doc-template-subsystem-leaf) specializes the linked [guide shape](page-templates.md#guide--concept) for code documentation without creating a second budget.

## Per-doc template (subsystem leaf)

```markdown
---
title: Short label # only when the H1 runs long
description: One-line summary for search results and section tables.
order: NN
---

# Title

_One-line summary._

## What it is

2–3 plain-English paragraphs. State what the thing is and why it exists.

## How it works

The mechanism, step by step. Inline `[file](relative/path)` for every code claim. If the mechanism is sequential, use a numbered list. If it is a state machine or branching logic, prefer prose.

## Key concepts

Bullet list of glossary terms relevant to this leaf, each a cross-link: `[Term](../00-orientation/glossary.md#term)`. Do not redefine here.

## Where it lives in code

| Concept | File                               |
| ------- | ---------------------------------- |
| ...     | `[Thing](../../path/to/Thing.ext)` |

## Configuration

The settings that tune this behavior, one line each. Include only those your subtree owns.

## Integration points

- **Upstream**: who calls this / sends to it
- **Downstream**: what this writes to / dispatches

## Current state & gotchas

Record surprising current state. Quote any `TODO`, `FIXME`, or `HACK` comments verbatim. Note incomplete features, recent behavior changes, reserved or dead config, and known traps. Include this section whenever any such evidence exists.
```

Skip sections that do not apply to a given leaf. Do not invent sections.

---

## Frontmatter

Every published page carries frontmatter. The Gate validates it against a closed schema, so an unknown key or invalid value fails `discern done` ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). Use these keys:

| Key             | Rule                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| `title`         | Short label for nav, breadcrumb, and `<title>` — max 48 chars. Only when the H1 runs long.  |
| `description`   | 50–160 chars. Fronts search results and section tables; say what the page does, no padding. |
| `order`         | Non-negative integer; unique among published siblings; leave gaps of 10.                    |
| `publish`       | `false` withholds the page from every published output. The sole page-level withhold.       |
| `redirect_from` | Absolute historical routes this page now answers for (`/docs/...`, no trailing slash).      |
| `aliases`       | Search synonyms: renamed terms, CLI spellings.                                              |

Frontmatter provides metadata. Rendered pages strip the block, and the H1 stays the long-form canonical title on the page. Only flat `key: value` scalars and `- item` lists parse.

## ADR citations

Cite decision records as freely as the reasoning requires; rendering handles their visible density ([ADR 0141](../_adr/0141-adr-citations-strip-at-render.md)). In a published tier, put linked citations in a parenthetical group at clause end, e.g. `([ADR 0140](../_adr/0140-….md))`, comma-separated when a clause cites several. The Gate requires the sentence to remain correct after deleting the citation, which excludes a citation from the grammatical-subject position.

---

## Hard rules

1. **Use names that appear in code.** If no named type exists, describe the concrete pieces that implement the behavior.
2. **Verify every file path before writing it.** Use a listing when uncertain. An unverified path is a defect.
3. **Use present-state claims.** Omit `should`, `would`, `could`, `will eventually`, and `is intended to`. For incomplete work, write: "Currently does X. Y remains pending."
4. **Cross-link with relative paths.** Omit the configured Map-directory prefix because you are already inside it.
5. **Cross-link within your subtree.** Leave inter-subtree links to the orchestrator integration pass.
6. **Put glossary additions in your summary.** If you find a term that ought to be glossary-defined, list it in your summary and leave the leaf's section set unchanged.
7. **Stop at scope overlap.** If code belongs to another subtree, leave it unchanged and describe the overlap in your summary for the orchestrator.
8. **Page shape and budget.** Follow the shape linked by the scope manifest; [`page-templates.md`](page-templates.md) is the sole default-budget authority. Split a page that cannot perform one job within its selected shape and report the split. A scope-specific numeric exception is valid only when its manifest declares `<!-- project-page-budget-exception: <file.md> | <lower>–<upper> words | <durable reason> -->`; do not copy a default range into the brief or manifest prose.
9. **Use code samples only when they clarify what a path cannot.** A `[file](path)` link usually suffices. Reserve code blocks for a small grammar (a config shape) or a genuinely tricky interface.
10. **Apply the product voice Skill.** Hold its voice behaviors and banned moves. The Gate blocks every `Discern*` alert, including warning and suggestion findings, across every maintained non-private Map page. Third-party warnings and suggestions remain advisory through the prose-density Standard; ADRs retain their reduced style set. Before handoff, run `discern scripts prose-page <page…>` on every page you wrote or rewrote. The required result is zero `Discern*` alerts, matching the reference corpus.

---

## What "good output" looks like

- A newcomer reading your `README.md` understands what the subtree is about in 60 seconds and knows which leaf to read next.
- A returning maintainer finds the right leaf and re-orients in two minutes.
- An agent that needs to make a change finds the file path it needs in 30 seconds.

If any of those break, the doc is too thin or too thick.

---

## Deliverable

1. Write every `.md` file listed in your scope manifest. Each replaces its existing stub.
2. Give every published page valid frontmatter (at minimum `description`, and `order` for published siblings).
3. Return a short summary covering:
   - **What you covered** — one bullet per leaf, with its headline claim.
   - **`TODO`/`FIXME` notes** — quote any in-code comments you preserved under "Current state & gotchas".
   - **Glossary additions/refinements** — terms that ought to be defined or sharpened in the glossary.
   - **Subtree-overlap observations** — code you noticed that belongs in another subtree.
   - **Deprecation candidates** — anything that looks half-built, abandoned, or redundant.

Stop after the scoped files and summary are ready. Leave the changes uncommitted, do not run the full Gate, and leave every path outside the assigned Map subtree unchanged.
