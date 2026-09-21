# ADR 0412: Site deployment composes website source with a released product snapshot

**Status**: accepted

## Context

A homepage correction should not require publishing another binary. Binding the whole site to a release tag prevents that, but deploying the whole of `main` can publish documentation for software users cannot install. Unreleased product work on `main` should not freeze independent website updates.

## Decision

The site has two source identities: its proven website commit and the greatest published stable product tag. The shared production publisher accepts either the release workflow after publication or a manual dispatch on `main`. Both require complete hosted gate evidence for the exact website commit. Independent deployment creates no release and does not change local or hosted gate requirements.

A fresh staged tree combines committed website sources with the released product's complete source, template, schema, manual, installer, and glossary inputs. The staging script owns the boundary. The product version comes from the released tag; the website owns its build configuration and dependencies. The staged tree must build and pass the process crawl before upload. The current Map and decisions remain separately framed project history.

Both entry points serialize production deployment and check successful deployment ancestry inside that lock. The publisher refuses a source older than a previously successful production source. It records both snapshot identities for verification. Historical workflow reruns and arbitrary local checkouts are not recovery paths.

## Consequences

Website edits can ship while product development continues. Product documentation and schemas stay aligned with a published stable version; a prerelease does not replace that default. A manual correction still requires a product release under this boundary.

The site must remain compatible with released shared helpers. A change relying on an unreleased helper can pass the source gate yet fail staged verification; it must wait for the product release or use a compatible website implementation. The staged package version differs from the website source package version, so verification must recreate the composed tree rather than crawl from raw `main`.

The complete gate still sets the minimum publication delay. Focused site evidence and change-aware completion remain separate design work. Recovery composes a new proven source instead of silently rolling production back.
