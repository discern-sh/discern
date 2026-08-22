# ADR 0211: Agent-context artifacts carry no provenance marker

> **Amendments.**
>
> - **[ADR 0203](0203-discern-co-authors-only-commits-it-composes.md) — attribution control:** Comment-capable artifacts outside agent context now carry a shorter generation-and-source marker. By default it names discern and links to `https://discern.sh`. When `DISCERN_NO_ATTRIBUTION` is non-empty, it omits the byline and URL while keeping the generation notice and source. The longer overwrite warning no longer appears in the marker. Context-loaded and comment-incapable artifact policy is unchanged.
> - **[ADR 0259](0259-generated-groups-opt-in-to-review-metadata.md) — review metadata:** generated groups may now opt in to GitHub's `linguist-generated` attribute, and registered Markdown uses Git's built-in Markdown diff driver. Neither is an in-band provenance marker; the context-loaded artifact decision below is unchanged.

**Status**: accepted

## Context

discern can identify a generated artifact with a comment that names its source and warns that regeneration overwrites hand edits. That courtesy is free in files no agent reads as instructions.

Agent files and materialized skills have a different cost. Coding agents load an agent file whole in every session and load a materialized skill when they invoke it. A provenance line therefore consumes context each time the artifact is read. Providers also differ in whether comments reach the model, so the same marker can cost tokens, disappear, or render as instruction text depending on the reader.

These artifacts already explain their generated status in the compiled guidance. The currency checks compare agent files and materialized skills with their sources and reject stale hand edits. A marker would repeat that story without adding enforcement.

The absence was an early owner decision, but it was recorded only in code comments. A later provenance brief proposed adding markers to every compiled file before rediscovering the decision. That near miss makes the boundary part of the architecture rather than an implementation detail.

Changing the policy remains mechanically straightforward. Once shipped, however, it changes every tracked agent file and materialized skill on refresh, creating broad review churn while changing the context every provider receives.

## Decision

An artifact loaded whole into agent context carries no provenance marker or generator comment. This includes every compiled agent file, pointer agent file, and materialized skill.

A comment-capable artifact outside agent context self-identifies. Its producer emits a marker that names discern, identifies the source, says that hand edits to discern's output are overwritten, and links to `https://discern.sh`. A format that cannot carry comments, currently JSON, has no marker.

The artifact registry records these classes beside File ownership. Tests require every discern-written artifact to declare one class, require markers on the comment-capable non-context class, and reject an opening marker on the context-loaded class.

## Consequences

- Agent files open with project guidance or the provider's import pointer. Skills open with their frontmatter. Neither spends context on provenance.
- The in-band generated-files guidance and drift checks remain the explanation and enforcement for context-loaded artifacts.
- Comment-capable non-context output gains a consistent marker from its producer.
- A new written artifact cannot join the registry until its context and comment behavior are chosen.
- The rule depends on how an artifact is consumed. Moving an artifact into or out of whole-file agent context requires reclassification and the matching marker change.

## Alternatives considered

- **Mark every generated artifact.** Rejected because recurring agent context and inconsistent provider comment handling cost more than the repeated courtesy provides.
- **Mark generated paths through `.gitattributes` with `linguist-generated`.** Set aside. It changes repository metadata and review presentation without explaining the source or overwrite contract inside the artifact.
- **Write sibling marker files.** Rejected because they add footprint and drift while leaving the generated artifact itself unexplained to a reader who finds it alone.
