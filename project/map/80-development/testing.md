# Testing

_The testing approach in this repo — how tests are written, how they run, and
the patterns the gate assumes._

The `test` capability in `discern.toml` is what the `done` gate runs; this doc
explains how to write tests that pass it and how to run them while iterating.

## How tests run

The suite is plain `deno test`, wired as the `test` capability:

```sh
deno task test                          # the whole suite (what the gate runs)
deno test tests/upgrade_test.ts         # a single file while iterating
deno test --filter "convergence"        # a filtered subset by test name
```

`deno task test` grants `--allow-read --allow-write --allow-env --allow-run`
(the suite runs the engine via `deno run src/main.ts` and shells out to `git`)
and excludes `.claude/`, `dist/`, `templates/`, and `tests/fixtures/`.

There are **two layers**, sharing two helper modules:

- **Installer tests** drive the Deno CLI as a real subprocess via `runCli`
  ([tests/helpers.ts](../../../tests/helpers.ts)), so Cliffy parsing, the global
  flags, `--json` output, and exit codes are all exercised end to end.
- **Engine tests** (`tests/engine_*`) scaffold the **real** `templates/` (the
  `discern.toml` seed) into a temp dir using the installer's own plan/apply
  path, then run the engine as a real subprocess via `runAgent`
  ([tests/engine_helpers.ts](../../../tests/engine_helpers.ts)) —
  `deno run
  src/main.ts <verb>` inside that dir, with a `discern` shim on
  `PATH` so project scripts resolve. So the engine verbs (`done`, `worktree`, …)
  and their `--json` contracts are exercised against a faithful install, end to
  end.

**Parallel-safety is structural.** Every test does its work inside a fresh
`withTempDir` directory and, when it needs git, a hermetic repo from `gitInit`
(its own config, no signing, a `main` branch — so your global git settings can't
leak in). Because each test owns its fixtures and touches nothing shared, tests
assume no ordering. Keep it that way: never reach outside the temp dir or depend
on another test's side effects (the [gate gotchas](done-gate-gotchas.md) "passes
alone but fails in the full run" trap is exactly this failure).

## How tests are written

- **Assert on behaviour, not internals.** Prefer the subprocess helpers
  (`runCli`, `runAgent`) and assert on captured `stdout`/`stderr`/exit code.
  Colour is forced off (`NO_COLOR`) so assertions match plain text.
- **Scaffold from the real templates.** Engine tests use `scaffoldEngine` (which
  lays down `REAL_TEMPLATES` through `assembleInitPlan`/`applyPlan`), so the
  bytes under test are the bytes a real `discern setup` ships. Use `writeConfig`
  to set the `[capabilities]`/`[checks]`/`[scopes]`/`[standards]` a case needs,
  and `addWorktree` for the worktree-command layout.
- **Use fixtures for unit-level installer tests.** `FIXTURE_TEMPLATES` plus
  `testTokens` give a small synthetic tree for testing rendering/plan logic in
  isolation, separate from the full real templates.
- **Assert idempotency/convergence where it matters.** `snapshotTree` +
  `assertConverges` express the "upgrade ≡ fresh init" invariant
  ([ADR 0014](../_adr/0014-versioned-migration-system.md)); reach for them when
  a change touches the install/upgrade/migration path.
- **Put coverage in the right place.** Engine behaviour →
  `tests/engine_*_test.ts`; installer behaviour → the other `tests/*_test.ts`.
  Each engine verb is exercised by a subprocess test that actually runs it
  through `runAgent`, so a new verb needs a test in `tests/engine_*` that drives
  it end to end.
- **The map is gated like code.** `tests/map_integrity_test.ts` validates every
  fenced `discern …` example against the live verb/flag registry, every
  intra-map link and heading anchor against the shared renderer, and the
  published tiers' audience boundary; `tests/cli_reference_codegen_test.ts`
  holds the generated CLI reference to the registry. Writing docs? Quote real
  commands and real paths — the gate checks them
  ([ADR 0142](../_adr/0142-docs-integrity-gate-and-generated-cli-reference.md)).

## Coverage

Line coverage of the repo's own `src/` tree is measured by `deno task coverage`
([scripts/coverage.ts](../../../scripts/coverage.ts)): it runs the whole suite
under Deno's coverage instrument collecting raw profiles only, makes one lcov
report pass, and prints one `DISCERN_METRIC coverage <pct>` line.
[scripts/coverage_lib.ts](../../../scripts/coverage_lib.ts) anchors the lcov
filter to `<repo>/src/` — a `src/` segment inside `node_modules` or a nested
package never counts — and
[tests/coverage_lib_test.ts](../../../tests/coverage_lib_test.ts) pins that
definition. Because the engine is TypeScript under `src/engine/`, it is
instrumented like the rest of `src/` — the `engine_*` subprocess tests that
drive the verbs through `src/main.ts` count toward the number, so installer and
engine share one coverage figure. Those spawns are also why the run costs
minutes: each leaves one V8 profile per loaded module, hundreds of thousands of
small files per full run, and every report pass re-reads them all — the reason
the script makes exactly one.

That metric feeds a standard — `[standards.coverage]` in
[discern.toml](../../../discern.toml) — a floor that only ever rises. The
`discern standards` verb checks it; it is slow, so it is **not** part of the
`done` gate, and CI enforces it on every pull request. To raise the floor: add
tests, then capture the gain with `discern standards --pin`; the standard's
`margin` keeps the pinned floor a little below the measured value so ordinary
drift does not trip it.

Prompt dispatch is tested through real pseudo-TTYs. Every Cliffy prompt call is
structurally confined to [src/lib/prompts.ts](../../../src/lib/prompts.ts),
whose policy checks `--plain`, `CI`, and both streams. The matrix in
[tests/engine_non_interactive_test.ts](../../../tests/engine_non_interactive_test.ts)
drives every prompt-capable CLI form under CI and `--plain` pseudo-TTYs plus
closed stdin, with a timeout that turns a hang into a named failure. Scripted
desk-runtime tests cover the interactive action loop itself; Cliffy's own key
handling remains outside this project's coverage.
