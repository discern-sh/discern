# ADR 0221: Depth-indent discern.toml as the canonical tidy convention

**Status**: accepted

## Context

`discern.toml` is a project's entire discern footprint: one long, comment-dense file, dozens of sections, several dotted levels deep. The embedded TOML formatter stored every line flush-left — the TOML ecosystem's norm, and unreadable at this length: nothing shows which entries belong to which table, so the hierarchy exists only in the dotted names.

TOML permits leading whitespace and gives it no meaning, so indentation is a free visual channel. The embedded plugin has no table-indentation option, and the file is rewritten programmatically (`standards --pin`, `config`, migrations), so a hand-maintained layout would not survive.

## Decision

The canonical `discern.toml` form is depth-indented, and the convention is produced and enforced by the same machinery that already owned the file:

- `formatTomlText` composes a depth indenter (`src/lib/toml_indent.ts`) after the embedded plugin: a table header sits one two-space step per dotted level, its entries one step deeper, a full-line comment level with the next structural line. Multi-line string interiors are content and are never touched; multi-line value continuations derive their indent from bracket depth, so the pass is idempotent and provably parse-neutral.
- Every production config write already routes through `writeDiscernToml`, so every write path emits the canonical form; the gate's seeded `discern tidy` format job converges any file that predates the convention.
- Every scanner that reads config text as raw lines tolerates leading whitespace. The engine test harness writes scaffold configs through the same canonical writer, so the whole engine suite permanently exercises the indented form and a scanner that regresses to column-0 anchoring fails.
- The bundled template carries the indentation directly (its placeholders keep it from parsing, so the formatter cannot be run over it); a fixed-point guard in `tests/config_template_test.ts` holds it there.

Explicitly not done: no indentation of any other TOML file. Foreign co-managed files (a coding-agent provider's own TOML) keep their owners' conventions — only the root `discern.toml` flows through the formatter.

## Consequences

- The config reads as the hierarchy it is; comment banners sit level with the families they document.
- Every existing install's `discern.toml` reformats once — a whitespace-only diff — on its next tidy or gate run.
- The indentation is visual only. TOML nesting still comes from dotted names, and an indent can in principle disagree with the name it decorates; the formatter recomputes every indent from the names on each write, so a misleading layout cannot persist.
- Comments attach to the _next_ structural line. A commented-out example section trailing a family therefore sits at the following section's level, not the family's — accepted as the cost of a rule with no semantic guesses.
