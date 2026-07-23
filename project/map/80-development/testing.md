# Testing

_The testing approach in this repo — how tests are written, how they run, and the patterns the gate assumes._

The `test` job in `discern.toml` is what the `done` gate runs; this doc explains how to write tests that pass it and how to run them while iterating.

## How tests run

The suite is plain `deno test`, wired as the `test` job:

```sh
deno task test                          # full suite (what the gate runs)
deno test tests/upgrade_migrations_test.ts # a single file while iterating
deno test --filter "convergence"        # a filtered subset by test name
```

`deno task test` runs the suite with `--parallel` and `--allow-read --allow-write --allow-env --allow-run` (the suite runs the engine via `deno run src/main.ts` and shells out to `git`). The site tests read the built site, which the gate's build stage produces via `deno task site:build`; on a fresh checkout that has never run the gate, run `deno task site:build` once before the full suite. The `test.exclude` list in `deno.json` keeps generated output, distribution files, templates, and fixtures out of discovery.

There are **two layers**, sharing two helper modules:

- **Installer tests** drive the Deno CLI as a real subprocess via `runCli` ([tests/helpers.ts](../../../tests/helpers.ts)), exercising Cliffy parsing, global flags, `--json` output, and exit codes through the CLI boundary.
- **Engine tests** (`tests/engine_*`) scaffold the **real** `templates/` (the `discern.toml` seed) into a temp dir using the installer's own plan/apply path, then run the engine as a real subprocess via `runAgent` ([tests/engine_helpers.ts](../../../tests/engine_helpers.ts)). They run `deno run src/main.ts <verb>` inside that directory, with a `discern` shim on `PATH` so project scripts resolve. The engine verbs (`done`, `worktree`, …) and their `--json` contracts are exercised against a faithful install.

**Parallel-safety is structural.** Every test does its work inside a fresh `withTempDir` directory and, when it needs git, a hermetic repo from `gitInit` (its own config, no signing, and a `main` branch, which prevents your global git settings from leaking in). Each test owns its fixtures, touches no shared state, and assumes no ordering. Keep all access inside the temp directory and independent of other tests' side effects. The [gate gotchas](done-gate-gotchas.md) describe the resulting "passes alone but fails in the full run" failure.

## How tests are written

- **Assert on observable behavior.** Prefer the subprocess helpers (`runCli`, `runAgent`) and assert on captured `stdout`/`stderr`/exit code. Color is forced off (`NO_COLOR`) so assertions match plain text.
- **Scaffold from the real templates.** Engine tests use `scaffoldEngine` (which lays down `REAL_TEMPLATES` through `assembleInitPlan`/`applyPlan`), so the bytes under test are the bytes a real `discern setup` ships. Use `writeConfig` to set the `[jobs]`/`[scopes]`/`[standards]` a case needs, and `addWorktree` for the worktree-command layout.
- **Use fixtures for unit-level installer tests.** `FIXTURE_TEMPLATES` plus `testTokens` give a small synthetic tree for testing rendering/plan logic in isolation, separate from the full real templates.
- **Assert idempotency/convergence where it matters.** `snapshotTree` + `assertConverges` express the "upgrade ≡ fresh init" invariant ([ADR 0014](../_adr/0014-versioned-migration-system.md)); reach for them when a change touches the install/upgrade/migration path.
- **Put coverage in the right place.** Engine behavior → `tests/engine_*_test.ts`; installer behavior → the other `tests/*_test.ts`. Each engine verb is exercised by a subprocess test through `runAgent`, so a new verb needs a driving test in `tests/engine_*`.
- **The map is gated like code.** `tests/map_integrity_test.ts` validates every fenced `discern …` example against the live verb/flag registry, every intra-map link and heading anchor against the shared renderer, and the published tiers' audience boundary; `tests/cli_reference_codegen_test.ts` holds the generated CLI reference to the registry. Writing docs? Quote real commands and real paths — the gate checks them ([ADR 0146](../_adr/0146-docs-integrity-gate-and-generated-cli-reference.md)).
- **The vocabulary is gated from the term registry.** Synonyms an entry retires are banned from every live surface (`tests/vocab_drift_test.ts`); every known job, stage, and top-level verb must be named by the glossary or recorded absent with its reason (`tests/glossary_enrolment_test.ts`); and the `vocabulary` standard holds dead terms and bold-faced redefinitions at zero — link a term's entry (`**[term](../00-orientation/glossary.md#term)**`) instead of restating it ([ADR 0167](../_adr/0167-term-registry-polices-the-vocabulary.md)).
- **The feature account is gated from the feature registry.** Every top-level verb, known job, stage, config table, bundled skill, and agent provider must be claimed by a node of the feature canon or recorded absent with its reason, every claim must name a live member, and the committed canon page must match its generator (`tests/feature_canon_enrolment_test.ts`, `tests/feature_canon_codegen_test.ts`; [ADR 0175](../_adr/0175-the-feature-canon-compiles-from-a-feature-registry.md)).
- **The dry-run preview is gated as a class.** Every command path that registers `--dry-run` is enumerated from the built CLI tree (`dryRunCapableVerbs` in [src/main.ts](../../../src/main.ts)), and `tests/engine_plan_parity_test.ts` drives a fail-closed fixture table over that set: a dry run must write nothing (its own logbook record aside), and an apply may perform nothing its plan never listed. A new verb that registers the flag fails the gate until it carries a probe ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- **The embedded formatter is held to one fixed point.** `tests/engine_tidy_test.ts` checks idempotence over the real map and root config, scope selection, dry-run behavior, parse-before-write safety, missing paths, and fenced code. Every production config-writer test follows its mutation with a tidy no-op assertion; the canonical-set guard does the same for generated map pages ([ADR 0178](../_adr/0178-discern-tidy-is-the-embedded-convention-for-discern-owned-surfaces.md)).

## Coverage

Line coverage of the repo's own `src/` tree is measured by `deno task coverage` ([scripts/coverage.ts](../../../scripts/coverage.ts)). It runs the full suite under Deno's coverage instrument to collect raw profiles, makes a single lcov report pass, and prints one `DISCERN_METRIC coverage <pct>` line. [scripts/coverage_lib.ts](../../../scripts/coverage_lib.ts) anchors the lcov filter to `<repo>/src/`; a `src/` segment inside `node_modules` or a nested package does not count. [tests/coverage_lib_test.ts](../../../tests/coverage_lib_test.ts) pins that definition. The TypeScript engine under `src/engine/` is instrumented with the rest of `src/`. The `engine_*` subprocess tests drive verbs through `src/main.ts`, so installer and engine share one coverage figure. Those spawns make the run take minutes: each leaves one V8 profile per loaded module, producing hundreds of thousands of small files per full run. The script limits the expensive reread to a single report pass.

That metric feeds `[standards.coverage]` in [discern.toml](../../../discern.toml), a floor that only rises. The `discern standards` verb checks it. Because the measurement is slow, it runs outside the `done` gate; CI enforces it on every pull request. To raise the floor, add tests and capture the gain with `discern standards --pin`. The standard's `margin` keeps the pinned floor a little below the measured value so ordinary drift does not trip it.

Prompt dispatch is tested through real pseudo-TTYs. Every Cliffy prompt call is structurally confined to [src/lib/prompts.ts](../../../src/lib/prompts.ts), whose policy checks `--plain`, `CI`, and both streams. The matrix in [tests/engine_non_interactive_test.ts](../../../tests/engine_non_interactive_test.ts) drives every prompt-capable CLI form under CI and `--plain` pseudo-TTYs plus closed stdin, with a timeout that turns a hang into a named failure. Scripted desk-runtime tests cover the interactive action loop itself; Cliffy's own key handling remains outside this project's coverage.
