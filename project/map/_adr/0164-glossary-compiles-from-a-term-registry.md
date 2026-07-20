# ADR 0164: The glossary compiles from a term registry

**Status**: accepted

## Context

The glossary is the map's vocabulary canon: every term defined once, every page using the names identically. Until now it was a hand-edited page, which left it the last vocabulary surface without a single source of truth in code. [ADR 0026](0026-typed-config-schema.md) and [ADR 0146](0146-docs-integrity-gate-and-generated-cli-reference.md) already moved the config reference and the CLI reference to generated pages held to their registries by sync tests, and [ADR 0051](0051-canonical-set-parity.md)'s forcing-function discipline expects a closed set's satellites to follow its single source automatically.

The hand-edited page had two live drift risks. Definitions that state engine-owned closed sets in prose — the Capability entry naming the six capabilities, the Stage entry naming the four stages — would go stale silently if a member were added. And the page's terms were invisible to code: nothing could enumerate the canon, so search aliases, lookups, or vocabulary checks would each need a hand-copied list.

## Decision

**The glossary page is generated from a term registry, `scripts/glossary_registry.ts`, by `deno task codegen` — the same discipline as the config and CLI references.**

- **The registry is the canon.** Each entry is the canonical term plus its definition as one Markdown paragraph; the renderer alphabetizes and emits the committed page with a generated-file banner. A sync test (`tests/glossary_codegen_test.ts`) fails the gate when the page drifts from the registry, and the build capability's codegen step regenerates it in every gate run.
- **The registry lives under `scripts/`, not `src/`.** Its strings are map prose — the sanctioned home for internal ADR citations — and the vocab guard rightly bans those citations from string literals in the binary's source tree. Placing the registry beside the codegen script keeps that law intact without an exemption.
- **Owned facts interpolate their source.** The Capability entry renders its list and count from `KNOWN_CAPABILITIES`; the Stage entry renders from `STAGES`; the default paths named by the Map, Guidance source, Project script, and Namespace entries render from the paths registry. Adding a member or moving a default updates the glossary in the same change, and the sync test asserts every member appears.
- **Every term is a search alias.** The renderer emits each term into the page's frontmatter `aliases`, so `discern map <term>` and the published site's search reach the glossary without a second list — the move the CLI reference already makes with command paths.
- **The existing map gate keeps its role.** Links and anchors in definitions are validated by the map-integrity guard against the shared renderer, exactly as before; the registry adds a source of truth above the page, it does not duplicate the link checker.

## Consequences

- A term change is an edit to the registry plus `deno task codegen`; an edit to the page is overwritten and fails the sync test. The documenter brief and the development docs say so.
- The canon is enumerable by code, which opens follow-on surfaces — a term-lookup verb, vocabulary linting, per-term cross-references — without new lists to maintain.
- The page's ordering is the generator's strict alphabetization, so an entry's position may differ slightly from hand-curated order; anchors are unchanged.

## Alternatives considered

- **Keep the page hand-edited, add a lint for the closed-set entries** — polices two entries and still gives code no way to enumerate the canon; every future consumer would hand-copy the term list. Rejected.
- **Structured fields per entry (ADR list, covered-in link) rendered into sentences** — makes authoring stiff and the renderer opinionated for no present consumer; the prose already carries the links and the map gate validates them. Rejected; revisit if a consumer needs the structure.
- **Generate the registry from the page (parse Markdown)** — inverts ownership, keeps hand-editing, and makes the parser the fragile source of truth. Rejected.
