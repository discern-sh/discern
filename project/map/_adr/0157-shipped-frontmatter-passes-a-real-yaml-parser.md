# ADR 0157: Shipped frontmatter must pass a real YAML parser

**Status**: accepted. Extends [ADR 0034](0034-agents-md-untracked-currency-check.md) (the gate's shipped-artifact preconditions).

## Context

Two frontmatter surfaces leave discern's own reader. Agent runtimes parse a materialized `SKILL.md`'s identity block with real YAML parsers. Map pages carry metadata blocks and publish to the site. discern itself reads both with a restricted flat grammar: scalar `key: value` lines and `- item` lists, read tolerantly so a malformed block can never destroy a document.

The two parsers disagree on real inputs. An unquoted value containing `:` satisfies the flat grammar and is invalid YAML. A value continued on an indented line reads as an open list to the flat grammar and as a nested mapping or multi-line string to YAML. Bare numbers, quote escapes, and block scalars produce different values in each parser.

The authored voice-and-tone skill shipped in the second shape: its `description` sat on an indented continuation line containing `:`. A YAML parser read a nested mapping, so one agent runtime fell back to a derived description and another reported the file invalid, while discern's tolerant reader saw an empty string. No check caught it: the strict doc validator never consulted a YAML parser, and the skill well-formedness guard enumerated only the bundled set, so authored skills were enrolled nowhere.

## Decision

The strict validators gain a YAML oracle. `parseYamlOracle` parses a block's verbatim text with `@std/yaml`; the block must be valid YAML, and for every schema key the oracle and the flat grammar must read the same value. The lenient readers are unchanged.

`skillFrontmatterIssues` is the one definition of a well-formed skill identity: valid YAML; `name` and `description` non-empty single-line strings both parsers agree on; `name` equal to the skill's directory, in lowercase letters, digits, and hyphens, at most 64 characters; `description` at most 1024 characters. The ceilings are the agent-runtime contract.

`checkSkillsWellformed` applies that validator to the whole effective set — authored sources as written, bundled ones as the template engine renders them for the project — and `discern done` runs it as a fail-fast precondition beside the currency checks, reporting the new `skill_frontmatter` stage with a per-file diagnostic. The repository's own guard iterates bundled and authored skills through the same validator, and the map-wide frontmatter sweep inherits the oracle through `validateFrontmatter`.

## Consequences

A skill or map page whose frontmatter a consumer's parser rejects or misreads cannot pass the gate, in this repository or in any project discern is installed into. The enrollment sources are the ones materialization already uses, so a new skill or page joins the checks by existing.

Agreement cuts both ways: YAML that is valid but invisible to the flat grammar — a block scalar, an escaped quote — is rejected in identity fields. Authors keep values on one plain line and quote them when they contain `:`. Exclusion stays the escape hatch, and it is a sound one: an excluded skill materializes nowhere.

`@std/yaml` becomes an engine dependency compiled into the binary. The tolerant readers still guarantee a malformed block never loses document content at render time; the oracle only decides whether the gate lets the block ship.

## Alternatives considered

- **Replace the restricted grammar with a real YAML parser everywhere.** Rejected: the lenient read is a deliberate property — a document that merely opens with a thematic break must never lose content, and materialization must stay total. The oracle adds the consumer's view without giving up that guarantee.
- **Harden the restricted grammar to reject YAML-invalid values itself.** Rejected: that re-implements the YAML edge rules piecemeal and drifts from real parsers, which is the defect class this record exists to close.
- **Validate bundled skills only.** Rejected: the instance that shipped was authored. The class is defined by what consumers parse, not by which directory the file came from.
