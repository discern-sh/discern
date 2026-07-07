# Contributing to discern

Thanks for your interest in improving discern. This is a light pointer; the real
contributor documentation lives in
**[`docs/80-development/`](docs/80-development/)**.

## Getting started

discern is one self-contained Deno binary — the installer verbs and the engine
are the same TypeScript program under `src/`, with the distribution surface
(seed templates, bundled skills, built-in guidance) under `templates/`.

- **[docs/80-development/getting-started.md](docs/80-development/getting-started.md)**
  — set up your environment and run discern from source.
- **[docs/80-development/for-humans.md](docs/80-development/for-humans.md)** —
  IDE setup and local prerequisites.
- **[docs/80-development/testing.md](docs/80-development/testing.md)** — the
  test approach; `deno task test` is the authority on correctness.
- **[docs/80-development/code-conventions.md](docs/80-development/code-conventions.md)**
  — the strict TypeScript and lint conventions the gate enforces.
- **[docs/80-development/install-surface.md](docs/80-development/install-surface.md)**
  — exactly what an install writes, by disposition.

## Before you open a pull request

discern runs its own harness, so the same gate you would run in any discern
project applies here:

```
deno task build      # compile the binary
deno task test       # the full test suite
discern finish       # the quality gate (format, lint, type-check, tests)
```

`discern finish` must pass on the final tree. Keep commits atomic — one logical
change each — with a clear imperative subject and a body explaining _why_.

## Decisions and docs

- Significant or hard-to-reverse decisions are recorded as **Architecture
  Decision Records** in [`docs/_adr/`](docs/_adr/). Skim the recent ones before
  a notable change, and add one when your change makes such a decision.
- The `docs/` tree is the source of truth and must not drift from code — update
  the affected docs in the same change.

## Reporting bugs and asking questions

- Bugs and setup failures: open an issue with the matching template and include
  `discern doctor --json`.
- Security issues: follow [`SECURITY.md`](SECURITY.md) — report privately, not
  as a public issue.
