# Testing

_The testing approach in this repo — how tests are written, how they run, and
the patterns the gate assumes._

The `test` slot in `.icculus/config.toml` is what `agent finish` runs; this doc
explains how to write tests that pass it and how to run them while iterating.

## How tests run

The suite is plain `deno test`, wired as the `test` slot:

```sh
deno task test                          # the whole suite (what the gate runs)
deno test tests/upgrade_test.ts         # a single file while iterating
deno test --filter "convergence"        # a filtered subset by test name
```

`deno task test` grants `--allow-read --allow-write --allow-env --allow-run`
(the suite shells out to `agent` and `git`) and excludes `.claude/`, `dist/`,
`templates/`, and `tests/fixtures/`.

There are **two layers**, sharing two helper modules:

- **Installer tests** drive the Deno CLI as a real subprocess via `runCli`
  ([tests/helpers.ts](../../tests/helpers.ts)), so Cliffy parsing, the global
  flags, `--json` output, and exit codes are all exercised end to end.
- **Engine tests** (`tests/engine_*`) scaffold the **real** `templates/` into a
  temp dir using the installer's own plan/apply path, then shell out to the
  installed `agent` via `runAgent`
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

## Coverage

Line coverage of the installer (`src/`) is measured by `deno task coverage`
([scripts/coverage.ts](../../scripts/coverage.ts)): it runs the whole suite
under Deno's coverage instrument and prints one `ICCULUS_METRIC coverage <pct>`
line. **Only `src/` counts** — Deno cannot instrument the POSIX-shell engine
under `templates/`, which the `engine_*` shell-out tests cover behaviourally
instead. So the number is the TypeScript half by construction; the engine's
safety net is those tests, not a percentage.

That metric feeds a ratchet — `[ratchets.coverage]` in
[.icculus/config.toml](../../.icculus/config.toml) — a floor that only ever
rises. `agent
ratchets` holds it; it is slow, so it is **not** part of
`agent finish`, and CI enforces it on every pull request. To raise the floor:
add tests, then bump `limit` to just below the newly measured value.

Some code is **intentionally** uncovered: the interactive TTY paths — the `init`
wizard prompts ([src/lib/prompts.ts](../../src/lib/prompts.ts)) and the `docs`
browser's `Select` loop and pager
([src/commands/docs.ts](../../src/commands/docs.ts)) — only run on a real
terminal, which a black-box subprocess suite can't drive without a pseudo-TTY.
Cover the flag/error branches around them and leave the prompt bodies; the floor
is set with that ceiling in mind.
