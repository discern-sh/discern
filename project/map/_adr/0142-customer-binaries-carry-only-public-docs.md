# ADR 0142: Customer binaries carry only the public documentation projection

> **Amendments.**
>
> - **[ADR 0218](0218-docs-owns-the-manual-help-owns-cli-reference.md) — command naming:** `docs` now names the bundled manual and `help` the CLI reference; this record's `discern help`, `help --adr`, and `helpResult` spellings read accordingly.
> - **[ADR 0314](0314-separate-public-manual-and-project-map.md) — staging source:** customer binaries continue to carry only the published manual projection, but that projection comes from the dedicated manual corpus rather than public tiers of discern's project Map.

**Status**: accepted

## Context

`discern help` makes discern's own manual available from every install. Its build staging originally copied whole allowlisted top-level directories into the compiled resource. That kept maintainer trees out, but it ignored the document model's page-level `publish` field and deliberately included `_adr/` so `help --adr` could expose discern's implementation history. A withheld leaf therefore still reached every customer, and internal decision pages occupied a product-help channel intended to carry only the public product manual.

The document model now makes `isPublicDoc(entry)` the sole page-level publication predicate. Tier-level curation remains separate: the product-help allowlist selects the user-relevant subtrees, while the predicate selects the published pages inside them. Shipping discern's own decision history is also no longer the right audience boundary. Repo agents have the complete map; public readers have the decisions archive on the docs site and the source repository.

## Decision

Binary help staging discovers the map through the shared document model and copies individual Markdown leaves admitted by both `BUNDLED_PUBLIC_DOC_DIRS` and `isPublicDoc`. It embeds no underscore-prefixed tree. In particular, discern's `_adr/` directory is not present in customer binaries.

The `--adr` flag remains useful rather than disappearing. In a discern source checkout, where the configured map contains `_adr/`, `discern help --adr` continues to browse those records. In an installed binary, where the staged tree does not contain them, the command succeeds with a clear pointer to `https://discern.sh/docs/decisions` and the source repository. The MCP help tool and resources continue to use `helpResult`, so they serve exactly the same staged public page set and never expose decision records.

No surface derives publication independently. The public-surface registry enrols build staging, and a parity test compares the actual staged files with the set selected by the shared predicate.

## Consequences

- A `publish: false` page is absent from the binary, not merely hidden by a renderer. New pages automatically join or stay out of every public help surface together.
- Customer installs contain the product manual and none of discern's internal implementation history. The binary also becomes smaller by the size of the decision corpus.
- Installed readers need the public site or repository to read decision history. The command explains that boundary instead of returning a doc miss or silently behaving like ordinary help.
- Dogfooding keeps its local path: agents working in this repository can still browse decision records from the map or through source-run `help --adr`.

## Alternatives considered

Keeping the decision corpus embedded but hidden behind `--adr` preserved offline access, but continued to distribute internal history to every customer and left binary staging outside the public-projection invariant. Removing the flag entirely was smaller, but would turn a previously supported command into an unexplained option error and would remove a useful source-checkout path.
