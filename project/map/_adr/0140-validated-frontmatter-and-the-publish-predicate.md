# ADR 0140: Frontmatter is a gate-validated schema and `publish: false` is the sole page-level withhold

**Status**: accepted

## Context

The docs site launches from the map, and the shared reader half-existed: frontmatter machinery shipped (`src/lib/frontmatter.ts`, consumed by `discoverDocs` and the site) but no map file used it, `publish: false` was honoured by exactly one consumer (the website) while CLI help, MCP, `--export`, and help-staging ignored it, and a raw frontmatter block would leak verbatim into terminal render, MCP `content`, and exports. The lenient parser meant a typo'd key vanished silently — the exact failure mode agent-maintained metadata cannot afford, because no human proofreads the map. Separately, `SKILL.md` identity blocks were parsed by a second, near-identical parser in `src/lib/skills.ts`, and `map_overview.ts` re-derived leaf descriptions the model had already derived.

An audience model was decided for the launch programme: one default-public tree; internal-sounding pages are reframed rather than relocated; mixed pages split. That ruling needs a single page-level withhold mechanism every surface honours identically — a second flag, naming convention, or per-surface list would drift.

## Decision

The frontmatter schema is minimal and CLOSED: `title` (the short label for nav, pager, breadcrumb, and `<title>` — the H1 stays the long-form canonical title), `description`, `order`, `publish`, `redirect_from`, `aliases`. Unknown keys fail the gate. There is deliberately no `nav_title`, `slug`, `audience`, `kind`, `status`, or manual date — later additions must be explicit, not speculative.

Reading and validating are two policies over ONE parser. `parseFrontmatter` reads leniently — no reader of a map can ever lose a document to a metadata mistake — while `validateFrontmatter` applies the strict schema and an architectural test walks the live map (minus the private tree) so a typo'd key, duplicate key, out-of-bounds value, broken fence, duplicate sibling `order`, or unsafe redirect claim fails `discern done`. `SKILL.md` blocks read the same scanner.

`isPublicDoc(entry)` in the doc model is the sole page-level publication predicate, and `publish: false` is the sole page-level withhold. Every surface that projects a tree to an audience filters through it: the site (and its search, llms, sitemap, and `.md` derivations), terminal and MCP `help`, `--export public`, and — when its brief lands — binary help-staging. A registry (`PUBLIC_DOC_SURFACES`) records the enrolment and a parity guard forces it: an enrolled surface must consume the predicate, and no other module may read the `.publish` axis. Tier-level curation (which subtrees ship — `BUNDLED_PUBLIC_DOC_DIRS`) remains a separate, orthogonal axis.

Agent surfaces of the project map do NOT filter: `discern map` and the tree on disk keep everything, with the withholding visible as a structured field. Frontmatter is metadata, not content — rendered surfaces strip the block and carry its values as structured fields; raw surfaces (`--raw`, `.md` editions) return pristine bytes by contract. Both standards denominators (the public-doc word count and Vale's staged input) measure the body only.

## Consequences

- An agent adding a page learns about a metadata mistake at the gate, not in production; a human reading any rendered surface never sees metadata; an agent reading the map loses nothing.
- Every new public surface must enrol with the predicate or the parity guard fails — the projection matrix cannot drift silently.
- The schema being closed means adding a key is a deliberate act (schema, validator, and gate fixture move together) — slightly more ceremony, no silent speculation.
- Withholding is page-level only: there is no per-surface visibility. A page is either published everywhere or withheld everywhere; audiences are managed by reframing or splitting pages, never by inline stripping.
