# Scope: NN-subsystem

<!--
  Copy this file to `docs/_internal/scopes/<NN-subsystem>.md` — one per subtree —
  and fill each section. It is the per-subtree complement to the constant
  documenter brief: it names exactly what THIS agent reads, owns, and produces.
  Delete these comments as you go.
-->

Read [`docs/_internal/documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

<!-- One or two sentences: the slice of the system this subtree covers, and where
its boundaries are (what the neighbouring subtrees own instead). -->

## Files to produce

<!-- Every .md file the agent must write, with a one-line topic each. The README
is always first. Name the page shape (overview / quickstart / guide / reference /
troubleshooting — see page-templates.md) where it isn't the default subsystem
leaf, and any frontmatter the page must carry beyond the brief's baseline
(a specific `order`, `publish: false`, a `redirect_from` claim). Keep the set
small enough to stay within the length budget. -->

| File        | Topic                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `README.md` | Public-facing 200–350-word overview: what this subtree covers, and the reading order through the leaves. |
| `<leaf>.md` | _Topic._                                                                                                 |

## Source files to read

<!-- The concrete files (and directories) the agent must read to write accurately.
Group them. Mark "read in full" vs "sample" for large directories. Verify these
paths exist before handing the manifest to an agent. -->

- `path/to/...`

## Area owned

<!-- The part of the codebase / config this subtree is authoritative for, so the
agent documents only knobs and behaviour in its lane. -->

-

## Existing-doc content to preserve

<!-- Any current docs whose wording or structure must survive a refresh, or
"None". Prevents a rewrite from discarding something the project values. -->

None.

## Known overlaps / handoffs

<!-- Code that sits near this subtree's edge but belongs to another. For each:
name it, say which subtree owns it, and instruct the agent to link rather than
document. This is what keeps parallel documenters from colliding. -->

- **`../NN-other/`** owns _X_. Describe the surface; do not describe _X_'s internals — link to it.

## Length-budget note

<!-- If this subtree is unusually large or small, say how to group or split so the
agent does not over- or under-document. Otherwise "Standard budget applies." -->

Standard budget applies (200–350 words per README, 400–800 per leaf — hard ceiling; other page shapes carry the budgets in [`page-templates.md`](../page-templates.md)).
