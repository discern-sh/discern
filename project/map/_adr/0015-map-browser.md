# ADR 0015: `discern map` — an in-binary project-map browser with a hand-rolled terminal Markdown renderer

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`, `docs` → `map` where it names the command, config, or tree, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged. **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** Current pointers use Project Script for the former project Recipe surface; the decision and reasoning are unchanged.

> **Presentation and interaction amendment (2026-08-13; [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md)):** The browse → select → page product flow survives. Selection now routes through Discern's package-backed prompt choke point, and terminal tables render through the package `./cli` graph. `@cliffy/command` remains the parser; Discern has no direct Cliffy Table or prompt dependency. Command's own transitive Table lock node is not a presentation authority for the map browser.

**Status**: accepted

## Context

discern scaffolds a `map/` tree into every install (orientation, a glossary, a system map, design principles, ADRs) and grows it subtree-by-subtree with the `document-subsystem` skill. As that tree fills up it becomes the thing it was meant to be — the canonical map of the system — but reading it means knowing the numbering scheme and opening files by hand. There was no way to _browse_ it: list what exists, search a growing set by name, and read a doc with its Markdown actually rendered.

Two constraints shaped the design. First, the audience is split: a human wants to explore interactively, while the coding agents that ground their work in these docs want to pull a specific doc or an index _programmatically_, without a prompt ever blocking them. Second, the installed discern engine is **pure POSIX shell** — an install has no Deno and no Node (that is the whole point of compiling `src/` to a binary). Rich terminal rendering — colour, wrapping, OSC-8 links, boxed tables — is not something to attempt in the `agent` shell engine.

A viewer also has to render Markdown that is dense with `snake_case` identifiers (`main_branch`, `schema_version`). A naïve `_emphasis_` parser mangles those, so "just pull in a Markdown library" is not obviously cheaper than owning the small subset we actually need.

## Decision

The map browser is **`discern map`, a subcommand of the binary**, with a **hand-rolled, dependency-light Markdown→terminal renderer**, serving **one command to two audiences** decided by the TTY.

- **It lives in the binary, not the shell engine.** `discern map` browses the install's own `map/` (found by walking up to the nearest `discern.toml`, the same anchor `bin/agent` uses). The `discern` binary is already on PATH wherever it installed a project, so every install gets the viewer at no extra cost — with **no new file under `templates/`** and nothing added to the managed set.
- **The renderer is ours** (`src/lib/markdown.ts`): a focused subset — headings, paragraphs, inline emphasis/code/strikethrough/links, ordered/unordered/task lists, fenced code, blockquotes, GFM tables, HR — rendered to ANSI. It is a pure function `renderMarkdown(md, {width, color})`, unit-tested without a TTY.
- **Wrapping is computed on plain text; styling is applied after.** Inline parsing yields styleless segments that flatten to a styled-character stream, which is word-wrapped on _visible_ width and only then painted. So coloured and `--no-color` output wrap identically, and a link's escape codes never throw off a line length.
- **Underscores are conservative.** `_`/`__` only open and close on word boundaries (CommonMark flanking), and code spans are parsed first, so identifiers and anything in backticks survive verbatim.
- **One command, two surfaces.** On a TTY with no target, an interactive, searchable picker (Cliffy `Select`, type-to-filter) leads to a paged, rendered view (`$PAGER`, default `less -R`). Off a TTY, or when given a target/flag, it is non-interactive: a target renders to stdout, `--raw` prints the pristine source, `--json` emits a machine index (or a single doc's record with content), `--list` prints a plain table of contents. It **never prompts** when stdin or stdout is not a terminal.
- **Scoped to the user-facing tree when browsing.** Internal/reference subtrees in `_`-prefixed directories (`_adr`, `_internal`) are excluded from browsing, indexing, and single-page resolution, so the normal command stays focused on what an end user should read. `--dir map/_adr` targets one explicitly when needed. The explicit concatenation surface is the exception: `--export public` keeps the filter, while `--export all` includes the entire tree and `--export select --output <path>` offers top-level sections in a terminal picker.

Explicit *no*s:

- **Not a Project Script.** An install has no Deno; reimplementing this in POSIX shell would be a worse renderer and a large managed-surface cost, for a command that is a developer convenience, not part of the gate.
- **Not a Markdown dependency, and not a full CommonMark parser.** The viewer renders the subset these docs use; `--raw` is the exact-source escape hatch.
- **Not a bespoke full-screen TUI.** Cliffy `Select` for navigation and the user's `$PAGER` for scrolling are robust, idiomatic, and far less terminal plumbing to own. (`@cliffy/table` is the one new dependency, from the Cliffy family already in use, for table borders.)
- **Not auto-paging in scripts.** The pager is gated on an interactive terminal, so piped and redirected output stays clean.

## Consequences

- Every install carrying the binary gains a docs viewer with zero template or managed-file footprint — it ships entirely inside `src/`.
- Agents get a stable, scriptable contract (`--json`, `--raw`, a resolvable target, deterministic exit codes for not-found/ambiguous) that cannot hang on a prompt — the same human/agent split the gate already draws with `done --json`.
- Internal tooling can produce a deterministic, comment-delimited Markdown bundle on stdout (`--export public|all`) or in an explicit output file. The MCP tool remains index/page-oriented so an accidental call cannot return the whole documentation corpus.
- We now own a Markdown renderer. Exotic input (deeply nested blockquotes, setext headings, raw HTML blocks, reference-style links) renders approximately rather than perfectly. That is acceptable for a viewer of _our own_ docs, and bounded: the renderer is a pure function with focused tests, and `--raw` always yields the true bytes.
- Rendering and discovery are independently testable pure functions, so the interactive shell (the one part that needs a TTY) is the only thin, untested seam — covered manually and by the non-interactive paths it shares.
