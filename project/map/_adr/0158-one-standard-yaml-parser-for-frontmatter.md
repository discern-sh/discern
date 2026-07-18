# ADR 0158: One standard YAML parser for all frontmatter

**Status**: accepted. Extends [ADR 0034](0034-agents-md-untracked-currency-check.md) (the gate's shipped-artifact preconditions); amends the frontmatter note in [ADR 0130](0130-docs-site-renders-the-help-tree.md).

## Context

discern read frontmatter with a hand-rolled flat grammar — scalar `key: value` lines and `- item` lists — while every external consumer of the same blocks (agent runtimes reading a materialized `SKILL.md`, site tooling, editors) parses them as YAML. Two parsers meant two definitions of one format, and they disagreed on real inputs: an unquoted value containing `:` satisfied the flat grammar and is invalid YAML; an indented continuation, a block scalar, a bare number, and a quote escape each read differently on the two sides.

The authored voice-and-tone skill shipped in that gap. Its `description` sat on an indented continuation containing `:`; YAML read a nested mapping — one runtime fell back to a derived description, another refused the file — while the flat reader saw an empty string, and no guard enumerated authored skills at all.

The flat grammar's stated justifications did not survive inspection. Totality — no reader may ever fail or lose document content — is a property of fallback behavior, not of parser choice. And the no-content-loss case it protected, a document opening with a thematic break, does not occur: every frontmatter-opening file in the repository closes as a proper block, and the strict validator forbids a thematic-break opener in the map.

## Decision

`@std/yaml` is the one frontmatter parser. The lenient readers (`parseFrontmatter`, used by docs discovery, rendering, and search) treat a block that does not parse as a YAML mapping as document content, untouched — the totality guarantee, kept. The strict validators check the schema over the parsed mapping and inherit the YAML rules themselves: duplicate keys are errors, `True` is a boolean, a bare number is a number.

`skillFrontmatterIssues` holds every effective skill to the consumer contract and nothing more: valid YAML; `name` and `description` non-empty strings; `name` equal to the skill's directory, in lowercase letters, digits, and hyphens, at most 64 characters; `description` at most 1024. `checkSkillsWellformed` applies it to authored sources as written and bundled ones as rendered, and `discern done` runs it as a fail-fast precondition reporting the `skill_frontmatter` stage with a per-file diagnostic. The repository guard iterates bundled and authored skills through the same validator; the map-wide sweep enforces the doc schema on every live page.

## Consequences

The divergence class is gone by construction: discern reads what consumers read, so a block cannot pass internally and fail externally. Constructs every runtime accepts — block scalars, multi-line strings, escapes — are now valid here too, and the agreement machinery that policed the seam between two parsers is deleted along with the flat scanner.

The lenient readers gain one YAML misread edge: prose sitting between two `---` lines that happens to parse as a YAML mapping reads as frontmatter. The flat grammar had the equivalent edge (`Note: a draft` was a valid flat block), and the gate's closed schema rejects both in every validated corpus.

A skill or map page whose frontmatter a consumer would reject or misread cannot pass the gate, in this repository or in any project discern is installed into. The enrollment sources are the ones materialization already uses, so a new skill or page joins the checks by existing; an excluded skill escapes the check and materializes nowhere.

## Alternatives considered

- **Keep the flat grammar and add a YAML oracle beside it.** The first cure shipped this way: strict validation parsed blocks with both grammars and required agreement on every schema key. Rejected on review — the agreement check exists only to police a split discern created itself, and it rejects YAML that consumers accept. One parser removes the class instead of guarding it.
- **Keep the flat grammar alone.** Rejected: it shipped the defect this record exists to close.
