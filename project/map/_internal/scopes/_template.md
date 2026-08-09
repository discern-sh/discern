# Scope: NN-subsystem

<!--
  Copy this file to `<map-dir>/_internal/scopes/<NN-subsystem>.md` — one per subtree —
  and fill each section. It is the per-subtree complement to the constant
  documenter brief: it names what the assigned agent reads, owns, and produces.
  Remove these comments before handoff.
-->

Read [`documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

<!-- One or two sentences: the slice of the system this subtree covers, its
boundaries, and the owner of each adjacent area. -->

## Files to produce

<!-- Every `.md` file the agent must write, with a one-line topic each. Put the README
first. Name the page shape (overview / quickstart / guide / reference /
troubleshooting — see page-templates.md) when it differs from the default subsystem
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

<!-- The part of the codebase and config this subtree owns. The agent documents
only behavior and settings within this boundary. -->

-

## Existing-doc content to preserve

<!-- Any current docs whose wording or structure must survive a refresh, or
"None". State the exact preservation requirement. -->

None.

## Known overlaps / handoffs

<!-- Code that sits near this subtree's edge but belongs to another. For each:
name it, say which subtree owns it, and instruct the agent to link to that
authority. -->

- **`../NN-other/`** owns _X_. Describe the boundary and link to that subtree for _X_'s internals.

## Length-budget note

<!-- If this subtree is unusually large or small, say how to group or split the
work within its budget. Otherwise write "Standard budget applies." -->

Standard budget applies (200–350 words per README, 400–800 per leaf — hard ceiling; other page shapes carry the budgets in [`page-templates.md`](../page-templates.md)).
