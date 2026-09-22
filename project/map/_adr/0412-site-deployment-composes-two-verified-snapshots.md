# ADR 0412: Site deployment composes website source with a released product snapshot

**Status**: accepted

## Context

A homepage correction should not require publishing another binary. Binding the whole site to a release tag prevents that, but deploying the whole of `main` can publish documentation for software users cannot install. Unreleased product work on `main` should not freeze independent website updates.

## Decision

The site has two source identities: its committed website source and the greatest published stable product tag. The shared production publisher accepts either the release workflow after publication or a manual dispatch on `main`. Manual deployment runs on demand without full hosted gate evidence. Binary releases require that evidence before publication. Independent deployment creates no release; local completion and the full gate on pushes remain unchanged.

A fresh staged tree combines committed website sources with the released product's complete source, template, schema, manual, installer, and glossary inputs. The staging script owns the boundary. The product version comes from the released tag; the website owns its build configuration and dependencies. The staged tree must build and pass the process crawl before upload. The current Map and decisions remain separately framed project history.

Both entry points serialize production deployment and check successful deployment ancestry inside that lock. The publisher refuses a source older than a previously successful production source. It records both snapshot identities for verification. Historical workflow reruns and arbitrary local checkouts are not recovery paths.

## Consequences

Website edits can ship while product development continues. Product documentation and schemas stay aligned with a published stable version; a prerelease does not replace that default. A manual correction still requires a product release under this boundary.

The site must remain compatible with released shared helpers. A change relying on an unreleased helper can pass the source gate yet fail staged verification; it must wait for the product release or use a compatible website implementation. The staged package version differs from the website source package version, so verification must recreate the composed tree rather than crawl from raw `main`.

Website publication waits for the staged build and crawl, not for product-platform tests. The deploy action starts that work immediately and publishes when it succeeds. A site deployment proves its composed site checks; it does not claim the full product gate passed. Additional site verification and change-aware completion remain separate design work. Recovery composes a new source on current `main` and passes the staged checks before upload.
