---
aliases:
  - release records
  - release comparison
  - family names
---

# Release records and comparison

The release site answers from authored Markdown records and a validated publication snapshot. [ADR 0400](../_adr/0400-release-records-drive-offline-release-awareness.md) governs the programme, including later CLI, desk, reminder, adoption, and installer work.

## Start at the authority

[`site/releases/records/`](../../../site/releases/records/) owns summaries, notes, and optional family names. The filename supplies the SemVer. [`records.ts`](../../../site/releases/records.ts) validates the set and resolves names before any projection consumes it. `deno.json` still supplies the running discern version.

Add `<semver>.md` with YAML metadata and a Markdown body. `summary` is required. `date` is an optional ISO calendar date when known. `codename` is optional. Unknown keys, duplicate precedence, empty notes, and malformed metadata fail with a source-file diagnostic. Build metadata cannot create another release at the same precedence. The current package version must match a record exactly.

A family can declare its name in its earliest retained record. An initial prerelease may declare it before stable `.0` exists. Patches inherit it. Keep the declaring record when pruning history. Publication checks compare the resolved name and declaring record against immutable tags, including a published family's absence of a name. They refuse changes and competing declarations. Family names do not participate in comparison or installation.

[`scripts/release_metadata.ts`](../../../scripts/release_metadata.ts) generates the current binary's small metadata object through codegen. Its numeric value imports `deno.json`; only its optional name is emitted as a literal. The binary imports this object without the site, release loader, or history. The build refuses stale metadata.

## Comparison boundary

[`model.ts`](../../../site/releases/model.ts) selects the status, stable recommendation, applicable stable releases, and separately classified stable, prerelease, and candidate history. It uses the shared strict SemVer adapter. Renderers do not compare versions or select a different release set. The public JSON schema is registered in [`PUBLIC_SCHEMA_PUBLICATIONS`](../../../src/shared/public_schemas.ts), with its own major.

[`response.ts`](../../../site/releases/response.ts) handles the fixed routes declared in [`RELEASE_ROUTES`](../../../src/shared/product_identity.ts). `/releases` follows existing HTML/text negotiation. Explicit `.txt` and `.json` addresses retain their formats. Invalid or repeated `since` returns 400. The outer handler supplies HEAD behavior, canonical redirects, security headers, and HTML metadata. Only the base HTML address enters the sitemap. Query comparisons and machine suffixes are excluded from indexing.

No supplied version returns the retained index. Current, behind, ahead, and no-stable states have separate meanings. A prerelease can appear in history without becoming the default recommendation. An ahead version receives no downgrade instruction. History before the earliest retained published record is never claimed complete. Human copy explains the gap only when the supplied version predates those notes. Empty sections are omitted. Each full note appears once, under a stable numeric version anchor. Applicable releases link to those entries, preserving the model's order. The version handoff explanation sits beside the result; the index never implies that a version was supplied.

The server renders query state from the model without client JavaScript. The route uses the shared composition bundle and a page-specific reading layout. Opening or fetching a comparison contacts `discern.sh` with the supplied version and no project data. The installed binary contributes a URL; it makes no request. The common update sequence and installer command come from the product-identity authority.

## The human page

[`render.ts`](../../../site/releases/render.ts) consumes the normalized result directly. Its framework-neutral markup uses the package's public semantic class contract for site chrome, the version card, labels, and installer command. It imports neither React nor a second version parser. [`site/page-src/releases.css`](../../../site/page-src/releases.css) owns spacing, the history rail, responsive layout, and command wrapping. The site build copies that sheet beside the selected runtime; generated assets remain outputs.

The result leads the page. A supplied version and the latest stable version have distinct labels. Family names stay beside full numeric versions. The applicable list links into the complete notes; published stable, prerelease, and unpublished histories remain separate. No disclosure control hides release content. Desktop navigation stays beside the notes, becomes ordinary flow on narrow screens, and uses native anchors throughout.

Only an available stable update exposes the update section. Its ordered steps and readable installer command come from the shared product identity, including checksum verification, executable/version checks, session restart, and explicit project-upgrade commands. Visiting a comparison and running the installer remain separate actions. Current and development builds keep a useful history without an install recommendation.

Comparison URLs receive truthful state-specific titles and descriptions, with the base release index as their canonical destination. Every query is excluded from indexing. Invalid inputs retain 400 and `no-store`, with a base-index recovery link. These complete error pages pass through the same metadata and nonce decoration as successful HTML, so the shared theme bootstrap also works there. Text and JSON negotiation remain in the response adapter.

## Visual and accessibility review

Use the real handler with the synthetic catalogue in [`tests/release_page_fixtures.ts`](../../../tests/release_page_fixtures.ts) to inspect published states before the first stable release. Never manufacture publication input in the live catalogue. Compare an index, current version, one and several intervening releases, an ahead build, a prerelease, encoded build metadata, prerelease-only history, empty history, and malformed or repeated input.

[`tests/site_releases_test.ts`](../../../tests/site_releases_test.ts) checks landmarks, heading hierarchy, version anchors, inherited names, dates, publication classes, update eligibility, selectable commands, and every normalized status. It also enrolls the actual catalogue and checks query metadata, error semantics, HEAD, and negotiated text. Static content and accessibility are checked before any page JavaScript runs.

[`tests/site_releases_browser_test.ts`](../../../tests/site_releases_browser_test.ts) uses the repository's Chromium test runner with responses from the production handler. One shared fixture covers desktop, narrow-screen dark mode, and a 320-pixel no-JavaScript journey. It checks document overflow, command wrapping, keyboard skip navigation, theme switching, and rendered contrast. Review screenshots separately when judging visual changes.

## Publication evidence

A local build with no publication observation labels records as candidates. An authored date or a tag alone does not establish asset availability.

The release workflow reads paginated GitHub release and asset observations. [`release_publication.ts`](../../../scripts/release_publication.ts) validates publication flags, assets, retained records, immutable names, and ancestry. The selected release must match the package and tag. [`release_plan.ts`](../../../scripts/release_plan.ts) selects its body/title and GitHub flags before publication. A maintenance release may leave latest unchanged; a prerelease cannot become latest.

Publication and deployment serialize across tags. Source must descend from every published release tag and retain its records. An older tag rerun or a maintenance branch missing current source is refused before it can replace the catalogue. Recover by composing current release source and preparing a new eligible tag; do not move a published tag.

After publication, [`release_site.ts`](../../../scripts/release_site.ts) requires current assets and stages `site/release-publication.json`. This ephemeral generated input is included in the uploaded source and read again by the remote build. It is neither committed nor ignored, so source upload retains it. The normal build writes the ignored `site/pages/release-catalogue.json`; the handler reads that snapshot on release requests, so a watched rebuild exposes newly added records. Keep publication input out of local work and commits. The tests enforce that boundary.

Records describe notes, tags identify source, assets establish availability, and deployment updates the site. A failed deploy leaves publication incomplete even when GitHub has the assets. The maintainer release guide owns recovery and operator verification. Production remains release-tag-only.

## Guards

[`tests/releases_test.ts`](../../../tests/releases_test.ts) exercises source validation, comparison tables, inherited names, compiled metadata, route parity, and workflow note selection. Existing artifact and site smoke suites retain platform, checksum, provenance, and real-handler checks. Adding a record enrolls it through the loader; the canonical-set registry derives the atlas from that same set.
