# ADR 0143: Decision records render on the web as project history outside product guidance

**Status**: accepted

## Context

The public manual renders the same map projection as `discern help`. That parity keeps product guidance honest, but it left the map's Architecture Decision Records outside the site: links into `_adr/` rewrote to GitHub, and every claim that cited its design rationale depended on the repository being public. The temporary deferral in [ADR 0130](0130-docs-site-renders-the-help-tree.md) protected the launch from publishing records before review, but it also made the public reading path incomplete.

Decision records have a different editorial role from the manual. They explain what was true when a choice was made, including abandoned alternatives and superseded architecture. Mixing them into the main navigation or default search results would present dated history as current instruction. Omitting them would discard the context that makes the map useful and break the trace from a public claim to the reasoning behind it.

## Decision

The site renders the configured map's numbered ADR set under `/docs/decisions`: one derived index and one route per `NNNN-*.md` record, including the `_superseded/` archive. The filename slug, including its stable four-digit number, is the route identity. Superseded records carry a visible status, and every page in the family is labelled **project history, not product guidance**.

Decision routes stay outside the manual's main sidebar. The docs colophon links to the family, relative `_adr/` links rewrite to it, and public pages render their document-model `citedAdrs` as a derived "Related decisions" footer. The family joins the canonical sitemap route source, but it is deliberately absent from the default search index and llms surfaces, which remain projections of current product guidance.

The publication principle is asymmetric on purpose: documentation may cite a decision because the surrounding reader can follow the record; the product's own shipped strings may not cite discern's internal ADR numbers because an end user cannot be expected to resolve repository history from runtime output.

## Consequences

- Every published claim can lead to its recorded rationale without leaving the site, and new citations or ADR files enrol without an authored web index.
- Historical records remain publicly legible without competing with current instructions in navigation, search, or agent-oriented guidance listings.
- Sitemap consumers can discover the full record family; default search and llms consumers see a smaller, guidance-only corpus by design.
- The site renderer now carries a second page treatment over the same document model. It must preserve raw editions and clearly label history on both the index and individual records.

## Alternatives considered

- **Keep rewriting ADR links to GitHub.** Rejected because the public reading path would depend on repository visibility and would have no derived related-decision treatment.
- **Place decisions in the main sidebar and search corpus.** Rejected because dated or superseded reasoning can look like current guidance when presented through the same discovery surfaces.
- **Copy selected decisions into prose pages.** Rejected because selection and copied summaries would create editorial upkeep and break the map as the single source of truth.
