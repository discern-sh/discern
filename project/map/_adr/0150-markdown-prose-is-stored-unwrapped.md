# ADR 0150: Markdown prose is stored unwrapped

**Status**: accepted

## Context

`deno fmt`'s default for Markdown reflows prose to 80 columns. In an agent-driven repository that default taxes every surface it was meant to serve: a one-word edit ripples through its whole paragraph, so diffs overstate every change; parallel worktrees editing neighbouring sentences collide on reflowed lines they never touched; and review — human or adversarial — reads formatting noise instead of content. The cost was about to compound: a nine-stream documentation fleet rewriting most of the map at once.

The wrap also proved actively harmful to enforcement: line-scoped text scans cannot see a multi-word phrase that a reflow split across a line break. Two retired-vocabulary instances survived in published map pages precisely because the 80-column wrap hid them from the guard that bans them.

## Decision

**Prose form is canonical and enforced: one line per paragraph.** `deno.json` sets `"proseWrap": "never"`, and the gate's fix stage now joins wrapped lines instead of creating them — an agent's wrapping habit is normalized away on the next `discern done`, so the tree cannot drift into mixed wrapping. `"preserve"` was rejected for exactly that reason: it removes the canonical form rather than replacing it, leaving prose shape to whichever agent last edited the file.

`templates/guidance/` and `templates/skills/` join the formatted surface (negated globs un-exclude them from the `fmt` exclude list): guidance compiles verbatim into end-user agent files and skills materialize verbatim into their skill directories, and both should read as prose rather than hard-wrapped text. The rest of `templates/` stays excluded and keeps its authored form.

The one-time mechanical reflow landed as a single commit, recorded in `.git-blame-ignore-revs` so blame skips it.

## Consequences

- Prose diffs shrink to one changed line per edited paragraph; blame, review, and cross-branch merges track content instead of reflow.
- Long lines are the storage form; readers and editors soft-wrap. Semantic line breaks (one sentence per line) are unavailable — the formatter joins them, by design.
- Hard-wrapped prose still exists in fixtures and other excluded paths, so any scan for multi-word phrases must match across line breaks rather than line by line; the vocabulary guards already do.
