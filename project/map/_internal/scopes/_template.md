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
first. Link every row to its selected shape in page-templates.md, and name any
frontmatter the page must carry beyond the brief's baseline
(a specific `order`, `publish: false`, a `redirect_from` claim). Keep the set
small enough for each page to perform one job. -->

| File        | Shape                                        | Topic                                                    |
| ----------- | -------------------------------------------- | -------------------------------------------------------- |
| `README.md` | [overview](../page-templates.md#overview)    | Public front door and reading order through the subtree. |
| `<leaf>.md` | [guide](../page-templates.md#guide--concept) | _Topic and boundary._                                    |

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

<!-- Every inventory row already links its default budget. State only grouping or
split instructions here. Remove this comment before handoff. -->

The linked page shapes apply; no local budget exception is declared.

For a genuine local numeric exception, replace that sentence with:

```markdown
<!-- project-page-budget-exception: <file.md> | <lower>–<upper> words | <durable reason> -->
```
