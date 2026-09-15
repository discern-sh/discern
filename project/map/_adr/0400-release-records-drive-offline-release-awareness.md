# ADR 0400: Release records drive offline release awareness

**Status**: accepted on 2026-09-15

## Context

Release notes, installation advice, and project adoption answer different questions. A browser can check published releases while the installed discern binary remains network-incapable. These answers need shared facts across the site, CLI, desk, installer, and release workflow, without implying that a version string proves installation or publication.

## Decision

This record governs the release-awareness programme. Later streams implement its boundaries and cite this decision.

### Authorities and projections

`deno.json` remains the authority for the current binary version. Reviewable Markdown files in `site/releases/records/` own release summaries and notes. A filename supplies its unique strict SemVer; metadata cannot repeat it. The loader rejects invalid records and versions with equal precedence, including build-metadata variants. The current version must have exactly one record.

A major/minor family may declare one optional `codename` in its earliest retained release record. An initial prerelease can declare the name before stable `.0` exists. Every patch and prerelease in the family inherits that declaration. Once published, the resolved name cannot change, including adding a name to a published unnamed family. Retain the declaring record when pruning history. Names carry no ordering, URL, tag, installation, compatibility, or theme semantics. Missing names remain absent.

Codegen emits only current-binary version/codename metadata. Its numeric value imports `deno.json`; it carries no runtime file lookup or release-history dependency. MCP protocol identity and numeric smoke checks keep using the numeric version. Reproducible builds contain no compile timestamp.

`/releases`, `/releases.txt`, and `/releases.json` consume one pure comparison model. HTML is rendered on the server; text negotiation follows the site's existing policy. The JSON contract has an independent public schema major. Published stable records determine the default recommendation and installer target. Prerelease versions are separately classified history. Candidates in untagged source are identified as unpublished. Ahead versions receive no downgrade instruction; missing stable history supplies no default install recommendation. Retained history never promises completeness before its earliest record.

### Publication and ordering

Records describe releases; tags identify immutable source; uploaded assets establish binary availability; a site deployment establishes the visible catalogue. None substitutes for another. Local builds have no publication evidence unless supplied an explicit workflow snapshot. A record date alone never proves publication.

The release workflow observes GitHub's published releases and required assets, validates records and immutable family names against their tags, and supplies a generated publication snapshot to the site build. The snapshot is deployment input, never an authored release list. The remote build consumes that same input. The release body and optional named title derive from the selected record before publication. All native checks, checksums, signing, notarization, and attestations remain required.

Publication and deployment serialize across tags. A release source must contain every published record and descend from every published release tag. This refuses an older rerun or a maintenance branch that would replace the production catalogue with an older snapshot. A maintenance version prepared on the current source may publish without moving GitHub latest. A newer prerelease may deploy history while retaining the highest stable installer target. Release-tag-only deployment remains mandatory. The plan checks again before publication and after publication before deployment; the latter requires current assets to be visible.

### Local awareness and adoption

Release awareness lives in repository-local common Git-administration state, shared by linked worktrees and independent of the logbook. A release handoff contributes the compiled version to a canonical URL. Opening or fetching it contacts `discern.sh` with that version and no project data. The binary neither fetches nor claims a completed check. The v1 desk's **Check for updates** action uses the CLI's offline handoff.

Checking and installation are separate actions. A request authorizes the actions it names within its scope; an existing authorization is not requested again. Reminders grant neither. The shared sequence is: read notes, install the recommended stable binary, verify the resolved executable and version, restart agent/MCP sessions, preview and apply an explicitly chosen project upgrade, then review and commit the diff.

`[meta].managed_version` records project adoption through successful setup/upgrade. Once trunk records it, a later branch cannot delete or lower it. It is not machine installation inventory. `schema_version` remains the hard compatibility boundary. Adoption SemVer does not replace managed-content currency, Proof evidence, source/build identity, or release-asset availability. The installer does not stamp projects.

## Consequences

Notes and family names have one reviewable authority. Site and release tooling may use publication observations; the compiled binary cannot acquire a network capability through them. Release operations pay for fresh remote observations, and publishing from a maintenance branch requires composing the current source first. A failed deployment can leave GitHub ahead of the visible site until the eligible tag is retried. The release guide treats that gap as incomplete publication.

The foundation implements records, comparison, routes, metadata, and workflow checks. Subsequent streams own human presentation, offline handoff and reminder state, project adoption, and installer replacement. They do not create competing release decisions.

## Alternatives considered

- In-binary polling breaks the offline trust boundary.
- The oldest-logbook heuristic disappears when recording is off and confuses use with installation.
- A compile timestamp is neither installation nor check evidence, and makes reproducible builds harder.
- `[meta].installed_version` makes a false machine-wide claim in a shared repository.
- Separately authored web, JSON, and GitHub notes allow drift at publication.
- Tag existence or record dates alone cannot establish asset availability.
- Ordering by tag name or workflow start time can regress the stable target or discard catalogue entries.
