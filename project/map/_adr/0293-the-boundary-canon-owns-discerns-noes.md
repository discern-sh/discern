# ADR 0293: The Boundary Canon owns discern's noes

**Status**: accepted

## Context

The Feature Canon answers one half of product identity: what discern does. The other half existed only as a draft “anti-feature canon” with useful but overlapping lists:

- refusals that ought to oblige product behavior;
- adjacent categories people may mistake discern for, each needing a discriminating fact;
- structural absences that ought to remain inspectable properties.

That draft exposed real boundaries, but prose alone could not own them. Several statements had also become broader than the implementation they described. discern does add narrow provider protections, the Desk can launch configured coding-agent clients, `tidy` can rewrite authored files when invoked, resource setup can carry selected environment values, and configured project commands keep capabilities the discern engine does not have. Keeping the attractive absolute and explaining the exception elsewhere would make the canon least reliable where it matters most.

The three-list shape still has value. Someone evaluating behavior asks “what will it refuse?”; someone placing the product asks “is this CI, a reviewer, or an orchestrator?”; someone auditing the build asks “is there a model, network permission, daemon, or database?” The overlap is a projection problem, not a reason to collapse those questions into one undifferentiated list.

## Decision

**A typed Boundary Canon owns discern's product boundaries and generates three task-shaped projections from each conceptual record.**

- `BOUNDARIES` in `scripts/brand/boundaries.ts` is the membership authority. A record owns its scope, stability, qualifications, horizon, claim citations, evidence, and any refusal, mistaken-identity, or absence projections.
- The three projections compile into `project/map/_internal/brand/boundary-canon.md` through the existing brand-document registry and codegen chokepoint. A boundary may appear in more than one projection, but its scope and evidence are stated once.
- Stability is explicit. `enduring` marks intended product identity; `edition` marks a boundary of the local edition and names its possible extension; `implementation` marks a guarded property of the current build and names the condition for changing it.
- The default scope is discern-owned code and effects. Configured jobs, resources, hooks, coding-agent clients, and harness permissions remain outside a claim unless a record includes them. Qualifications belong on the record rather than in corrective footnotes elsewhere.
- `tests/boundary_canon_test.ts` holds unique identities, non-empty projections, live claim and evidence references, generated enrollment and ordering, and the canon's semantic position in the Big Picture and Commercial Picture exports. The brand registry's existing currency guard holds the committed page to the renderer.
- Checkable structural claims use the narrowest authoritative guard. The public-build arguments now explicitly reject Deno network permission. Worker neutrality continues to rest on the existing Stats and Patterns contracts and decisions; no repository-wide “ranking” word scan is added, because ranking could be expressed on any surface and lexical absence would not prove semantic absence.

The canonical name is **Boundary Canon**. The “anti-feature canon” working label remains useful history, but “boundary” covers behavior, category, and structure without defining the product as a negation of its features.

## Consequences

- A new conceptual no is one registry record. Its projections, document position, registry-atlas membership, and committed page derive from that record; a new projection cannot be forgotten by a hand-maintained sibling list.
- A statement can be strong without being indefensible. The no-network record, for example, says the public binary has no network permission and names external commands as outside that guarantee; it does not claim every configured job is offline.
- Reversing an enduring boundary is now a product decision rather than an incidental feature edit. Extending an edition or implementation property requires changing its horizon, evidence, and guard with the code.
- The canon is an authority for product truth, not a universal lexical policy. Consumers use it when writing positioning, claims, product documentation, and agent explanations; targeted tests enforce structures with a reliable technical chokepoint.
- The generated page is intentionally long. The three short projections support task-oriented reading; the records below them carry the qualification and evidence needed for audit.

## Alternatives considered

- **Keep three authored Markdown lists.** Rejected: overlap would copy scope and evidence, and a correction could land in one list while leaving the others false.
- **Add negative fields to every Feature Canon node.** Rejected: category distinctions and edition-wide absences are not properties of individual features, and forcing them into feature nodes would scatter one product boundary across unrelated members.
- **Keep only one list of conceptual boundaries.** Rejected: it would erase the useful distinction between an obliged behavior, a category discriminator, and an inspectable absence.
- **Enforce every statement with a repository-wide lexical or structural scan.** Rejected: some boundaries have an authoritative chokepoint and deserve a guard; others are semantic product decisions. A broad scan would create the appearance of proof without covering new presentation surfaces or paraphrases.
