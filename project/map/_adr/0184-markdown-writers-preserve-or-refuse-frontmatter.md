# ADR 0184: Markdown writers preserve or refuse frontmatter, never restructure it

**Status**: accepted

## Context

A leading frontmatter block is contracted metadata, not prose. The gate validates map blocks (`validateFrontmatter`) and skill identity blocks (`skillFrontmatterIssues`) with the one standard YAML parser ([ADR 0158](0158-one-standard-yaml-parser-for-frontmatter.md)), and external agent runtimes read the same blocks with real YAML parsers of their own.

A bundled `SKILL.md` was hand-written with a `description:` value hiding an unquoted colon followed by a space (`description: foo bar: baz`), which makes the block invalid YAML. The repo's fix stage then damaged the file instead of reporting it: `deno fmt` formats YAML frontmatter inside Markdown through an error-tolerant parser, and its recovery re-indented the flush-left sibling keys (`metadata:` and its children) so they nested under the broken value. The block came out restructured and still invalid, the sibling keys were gone as siblings, and no stage in `discern prepare` said a word — the failure only surfaced later, against bytes the fixer had already rewritten.

The embedded tidy formatter carried the same class of exposure with the opposite sign. The pinned dprint Markdown plugin happens to pass a leading block through untouched, but nothing contracted that behavior: a plugin upgrade ([ADR 0178](0178-discern-tidy-is-the-embedded-convention-for-discern-owned-surfaces.md) makes upgrades rare, explicit events) could have begun rewriting blocks with no test noticing.

## Decision

**Every discern-owned Markdown writer holds one contract for a leading frontmatter block: parse it strictly before writing, refuse the whole file when the block does not parse, and emit the block's content unchanged when it does.** A formatter never edits a frontmatter block — not to repair it, not to normalize it.

- `formatMarkdownText` — the write chokepoint behind `discern tidy` and the generated-Markdown writers — asks `frontmatterParseIssue` (src/lib/frontmatter.ts, built on the shared strict parse) before formatting. An unterminated fence, a block that is not valid YAML, or a block that is not a mapping refuses the file with the parse issue. `discern tidy` reports the refusal as its existing `tidy_parse_failed` envelope and writes nothing; code generation fails its run.
- After formatting, `assertFrontmatterPreserved` compares the block's verbatim interior before and after; any difference is a refusal. Line endings follow the plugin's document-wide LF convention; the block's content is otherwise byte-identical.
- Formatters discern does not own are kept out of contracted trees instead of being trusted with them. In this repo `deno fmt` excludes the map (owned by `discern tidy`) and both skill source trees (`project/skills/`, `templates/skills/`); `tests/frontmatter_formatter_boundary_test.ts` derives that universe from the live path resolvers and the provider registry, so a renamed directory or a new provider enrols automatically.
- Explicit noes: the writer contract does not validate the frontmatter schema — unknown keys, lengths, and identity rules stay with the gate's validators; no formatter gains ownership of skill Markdown (ADR 0178's scope stands); and `discern prepare` gains no new precondition, because the corruption vector was the fixer, not a missing check.

## Consequences

- A broken block now reaches the gate byte-for-byte, so the gate's message — the file, the YAML error's line and column, the quoting remedy — describes the bytes the author wrote, not a fixer's rewrite of them.
- `discern tidy` can now refuse files it previously passed through: a configured Markdown file that opens with `---` must carry a closed block that parses as a mapping. A document may no longer open with a thematic break; the map validator already held that line, and tidy now agrees with it.
- In this repo, skill Markdown is formatted by nothing. The well-formedness check and the bundled-skill guard remain the only authorities over `SKILL.md`, which is the point: their view is of the authored bytes.
- A dprint plugin upgrade that changes frontmatter handling becomes a refusal on the first formatting run instead of a rewrite in place.

## Alternatives considered

- **Hide the block from the plugin with the fenced-code marker mechanism.** Prevention rather than detection, and the stronger guarantee on paper. Rejected for now because the plugin's document-wide layout decisions (the blank line after the closing fence, newline conversion) would shift canonical output across the settled corpus; verify-and-refuse holds the same contract with zero output change for every valid file.
- **Validate skill frontmatter in the prepare check stage.** Rejected: `done`'s precondition and the repo's skill guard already reject the malformed file once the bytes survive, and prepare runs the declared jobs only.
- **Keep `deno fmt` over the skill trees and accept its normalization of valid blocks.** Rejected: its YAML formatter recovers broken blocks instead of refusing them, and a formatter that edits invalid metadata destroys the evidence the gate needs.
