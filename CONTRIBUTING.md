# Contributing to discern

Thanks for your interest in improving discern. This is a light pointer; the real
contributor documentation lives in
**[`map/80-development/`](map/80-development/)**.

## Getting started

discern is one self-contained Deno binary — the installer verbs and the engine
are the same TypeScript program under `src/`, with the distribution surface
(seed templates, bundled skills, built-in guidance) under `templates/`.

- **[map/80-development/getting-started.md](map/80-development/getting-started.md)**
  — set up your environment and run discern from source.
- **[map/80-development/for-humans.md](map/80-development/for-humans.md)** — IDE
  setup and local prerequisites.
- **[map/80-development/testing.md](map/80-development/testing.md)** — the test
  approach; `deno task test` is the authority on correctness.
- **[map/80-development/code-conventions.md](map/80-development/code-conventions.md)**
  — the strict TypeScript and lint conventions the gate enforces.
- **[map/80-development/install-surface.md](map/80-development/install-surface.md)**
  — exactly what an install writes, by disposition.

## Before you open a pull request

discern runs its own gate, so the same gate you would run in any discern project
applies here:

```
deno task build      # compile the binary
deno task test       # the full test suite
discern finish       # the quality gate (format, lint, type-check, tests)
```

`discern finish` must pass on the final tree. Keep commits atomic — one logical
change each — with a clear imperative subject and a body explaining _why_.

## Decisions and docs

- Significant or hard-to-reverse decisions are recorded as **Architecture
  Decision Records** in [`map/_adr/`](map/_adr/). Skim the recent ones before a
  notable change, and add one when your change makes such a decision.
- The `map/` tree is the source of truth and must not drift from code — update
  the affected docs in the same change.

## Reporting bugs and asking questions

- Bugs and setup failures: open an issue with the matching template and include
  `discern doctor --json`.
- Security issues: follow [`SECURITY.md`](SECURITY.md) — report privately, not
  as a public issue.
