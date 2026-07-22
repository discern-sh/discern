# ADR 0177: The compiled agent file opens as the project's own document

**Status**: accepted

## Context

The compiled agent files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) begin with discern's built-in operating guidance; the project's own guidance sources follow. That order is the precedence mechanism: agent instructions that come later and are more specific override what precedes them, so the arrangement is what lets project guidance overrule discern's on any conflict.

The document itself, however, read as discern's. The H1 was "Working with discern", the opening sentence described discern, and a user's own rules appeared only after a tool's full operating manual — the file discern is most judged by presented the user's project as an appendix to someone else's document. The prime attention spot already carries real guidance rather than a banner (ADR 0034); it carried the wrong owner's name.

The config file had the same shape problem in miniature: fresh installs opened `discern.toml` with `[meta]` installer bookkeeping before the user's own `[project]` identity. And the only identity field was the slug — a machine identity for worktree, site, and branch names that reads poorly as prose for many real project names.

## Decision

Section order is unchanged — built-in guidance first, project guidance last — because the order is the precedence mechanism. Reordering was ruled out from the start.

Instead, the document's ownership inverts:

- The H1 names the project — `# Working in <name>` — and the first line is a signpost: the project's half is the final authority, it wins on any conflict, and discern's half comes first so that it can. discern's own material demotes to sections of the project's document.
- `[project].name` is the display name: free text, used where compiled guidance addresses the project. It falls back to the slug **verbatim**, then to a neutral stand-in ("this project"). Casing is never fabricated — a slug is not re-cased into a guessed title. (`setup`'s doc-skeleton path keeps its title-case reconstruction solely for configs written before the field existed, per ADR 0065.)
- `setup` already asked for the project name and derived the slug from it as an editable default; the name is now persisted instead of discarded, and resumes and presets read it back.
- `[meta]` moves to the bottom of the config template and `[project]` opens the file. Every `[meta]` write goes through the key-path TOML editor, so its position was always cosmetic; existing installs keep their layout.

Explicit *no*s: no Markdown anchor link from the signpost to the project's section (its first heading is user-authored, so a rename would break the link and nothing validates compiled-file anchors); no migration to backfill `name` into existing configs (the schema default plus slug fallback make absence correct, matching the `todo`/`logbook` precedent).

## Consequences

- Every install's agent files change once on its next `refresh`/`upgrade` — a one-time diff across all projects, in exchange for the file reading as theirs from line one.
- The `guidance_words` ceiling rose 827 → 832 to pay for the H1 and signpost — an owner-sanctioned recalibration taken on the trunk, falling from there as ever.
- A project whose display name is "discern" (this repo) renders adjacent possessives ("discern's own guidance" / "discern's built-in guidance"); the signpost's qualified possessives were chosen to keep them distinguishable.
- Guidance prose that addresses the project must use `{{project_name}}`; the variable is enrolled in the config-driven-variables guard, so a hardcoded name can't creep back in.
