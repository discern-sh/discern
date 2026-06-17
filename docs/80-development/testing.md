# Testing

_The testing approach in this repo — how tests are written, how they run, and
the patterns the gate assumes._

The `test` slot in `icculus.toml` is what `agent finish` runs; this doc explains
how to write tests that pass it and how to run them while iterating.

## How tests run

The suite is plain `deno test`, wired as the `test` slot:

```sh
deno task test                          # the whole suite (what the gate runs)
deno test tests/upgrade_test.ts         # a single file while iterating
deno test --filter "convergence"        # a filtered subset by test name
```

`deno task test` grants `--allow-read --allow-write --allow-env --allow-run`
(the suite shells out to `bin/agent` and `git`) and excludes `.claude/`,
`dist/`, `templates/`, and `tests/fixtures/`.

There are **two layers**, sharing two helper modules:

- **Installer tests** drive the Deno CLI as a real subprocess via `runCli`
  ([tests/helpers.ts](../../tests/helpers.ts)), so Cliffy parsing, the global
  flags, `--json` output, and exit codes are all exercised end to end.
- **Engine tests** (`tests/engine_*`) scaffold the **real** `templates/` into a
  temp dir using the installer's own plan/apply path, then shell out to the
  installed `bin/agent` via `runAgent`
  ([tests/engine_helpers.ts](../../tests/engine_helpers.ts)). So a `templates/`
  engine change is validated whether or not the root install is synced — no
  second test framework for the POSIX shell.

**Parallel-safety is structural.** Every test does its work inside a fresh
`withTempDir` directory and, when it needs git, a hermetic repo from `gitInit`
(its own config, no signing, a `main` branch — so your global git settings can't
leak in). Because each test owns its fixtures and touches nothing shared, tests
assume no ordering. Keep it that way: never reach outside the temp dir or depend
on another test's side effects (the
[finish-gate gotchas](finish-gate-gotchas.md) "passes alone but fails in the
full run" trap is exactly this failure).

## How tests are written

- **Assert on behaviour, not internals.** Prefer the subprocess helpers
  (`runCli`, `runAgent`) and assert on captured `stdout`/`stderr`/exit code.
  Colour is forced off (`NO_COLOR`) so assertions match plain text.
- **Scaffold from the real templates.** Engine tests use `scaffoldEngine` (which
  lays down `REAL_TEMPLATES` through `assembleInitPlan`/`applyPlan`), so the
  bytes under test are the bytes a real `icculus init` ships. Use `writeConfig`
  to set the `[slots]`/`[scopes]`/`[ratchets]` a case needs, and `addWorktree`
  for the worktree-recipe layout.
- **Use fixtures for unit-level installer tests.** `FIXTURE_TEMPLATES` plus
  `testTokens` give a small synthetic tree for testing rendering/plan logic in
  isolation, separate from the full real templates.
- **Assert idempotency/convergence where it matters.** `snapshotTree` +
  `assertConverges` express the "upgrade ≡ fresh init" invariant
  ([ADR 0014](../_adr/0014-versioned-migration-system.md)); reach for them when
  a change touches the install/upgrade/migration path.
- **Put coverage in the right place.** Engine behaviour →
  `tests/engine_*_test.ts`; installer behaviour → the other `tests/*_test.ts`.
  Every public recipe is expected to have execution coverage (a guard test
  enforces it), so a new recipe needs a test that actually runs it.
