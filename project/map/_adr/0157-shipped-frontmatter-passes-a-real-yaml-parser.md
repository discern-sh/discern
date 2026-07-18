# ADR 0157: Shipped frontmatter must pass a real YAML parser

**Status**: accepted. Extends [ADR 0034](0034-agents-md-untracked-currency-check.md) (the gate's shipped-artifact preconditions).

## Context

Two frontmatter surfaces leave discern's own reader: agent runtimes parse a materialized `SKILL.md`'s identity block as YAML, and map pages publish to the site. discern reads both with a restricted flat grammar — scalar `key: value` lines and `- item` lists, read tolerantly so a malformed block can never destroy a document. The two parsers disagree on real inputs: an unquoted value containing `:` satisfies the flat grammar and is invalid YAML, while an indented continuation, a bare number, a quote escape, and a block scalar each produce different values in the two parsers.

The authored voice-and-tone skill shipped that way: its `description` sat on an indented continuation containing `:`. A YAML parser read a nested mapping — one runtime fell back to a derived description, another refused the file — while discern's tolerant reader saw an empty string. No check caught it: the doc validator never consulted a YAML parser, and the skill guard enumerated only the bundled set.

## Decision

The strict validators gain a YAML oracle. `parseYamlOracle` parses the verbatim block with `@std/yaml`; the block must be valid YAML, and for every schema key the oracle and the flat grammar must read the same value. The lenient readers are unchanged.

`skillFrontmatterIssues` defines a well-formed skill identity: valid YAML; `name` and `description` non-empty single-line strings both parsers agree on; `name` equal to the directory, in lowercase letters, digits, and hyphens, at most 64 characters; `description` at most 1024. The ceilings are the agent-runtime contract. `checkSkillsWellformed` applies it to the whole effective set — authored sources as written, bundled ones as rendered for the project — and `discern done` runs it as a fail-fast precondition reporting the new `skill_frontmatter` stage. The repository guard iterates bundled and authored skills through the same validator; the map-wide sweep inherits the oracle through `validateFrontmatter`.

## Consequences

Frontmatter a consumer's parser rejects or misreads cannot pass the gate, in this repository or in any project discern is installed into. The enrollment sources are the ones materialization uses, so a new skill or page joins the checks by existing. Agreement cuts both ways: valid YAML the flat grammar cannot see — a block scalar, an escaped quote — is rejected in identity fields, so authors keep values on one plain quoted line. An excluded skill escapes the check and materializes nowhere. `@std/yaml` joins the compiled binary, and the tolerant readers still guarantee a malformed block never loses document content at render time.

## Alternatives considered

- **A real YAML parser everywhere.** Rejected: the lenient read is a deliberate property — a page opening with a thematic break must never lose content, and materialization stays total.
- **Harden the flat grammar to reject YAML-invalid values itself.** Rejected: that re-implements the YAML edge rules piecemeal and drifts from real parsers, the defect class this record closes.
- **Validate bundled skills only.** Rejected: the instance that shipped was authored; the class is what consumers parse, not which directory the file came from.
