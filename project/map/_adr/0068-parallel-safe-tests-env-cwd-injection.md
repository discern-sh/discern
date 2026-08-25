# ADR 0068: Tests inject env/cwd seams so the suite can run `--parallel`

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** the current test pointer uses `standards` (formerly `ratchets`), and current pointers use known/custom `job` (formerly gate `capability` / custom `check`); the decisions below are unchanged.
> - **Production boundary completion ([ADR 0336](0336-ambient-process-state-resolves-at-boundaries.md)):** the injection rule now covers authored production and script code. Ambient reads remain only in injectable default parameters or registered host-boundary modules, while process-environment mutation has its own exact registry.

**Status**: accepted. The test suite runs under `deno test --parallel`. To make that safe, every function that consults ambient process state — an env override or the working directory — takes an injectable seam (an `EnvReader` defaulting to `Deno.env`, or an explicit `cwd`/`env` argument), so a unit test supplies the value directly instead of mutating the process. A forcing-function guard (in the lineage of [ADR 0051](0051-canonical-set-parity.md)) fails the gate if any test reintroduces a process-global mutation.

## Context

The suite is ~960 tests across ~90 files and ran serially in ~150s — effectively single-threaded on an 18-core machine, with most of the wall time spent cold-starting the `deno run`/`git` subprocesses the engine tests drive. `deno test --parallel` runs test _files_ across worker threads to reclaim those idle cores (measured ~6× here: 150s → ~25s).

The hazard is in how that parallelism works. Deno's `--parallel` runs the worker threads inside **one OS process** — verified empirically: an env var set in one file is read back _changed_ by another file running concurrently, while a serial run is unaffected. So `Deno.chdir` and `Deno.env.set`/`delete` are process-global and leak across any files running at the same instant. Worse, `Deno.Command` inherits the parent environment by default (no `clearEnv`), so a leaked variable is also inherited by every subprocess the tests spawn through `runAgent`/`runCli`. The failure actually observed in a parallel run: `git_test` set an empty `PATH` for its "unrunnable git" case, and a concurrent `engine_standards_test` spawned `deno` against that empty PATH — `NotFound: Failed to spawn 'deno'`. The victim varies with scheduling, and the rate was ~10% of parallel runs: green often enough that flipping the flag on and seeing one pass looks safe.

Nine files mutated process state this way, each saving and restoring around the call. That save/restore is only correct under serial execution — the restore runs after an `await`, and other files' tests execute during that window.

## Decision

Convert the nine files to **inject** the value rather than mutate the process.

- **Env reads** take an `EnvReader` (`{ get(key): string | undefined }`, [`src/shared/env.ts`](../../../src/shared/env.ts)) defaulting to `Deno.env`, which satisfies the shape. Production call sites are unchanged; a test passes `fakeEnv({…})` ([`tests/helpers.ts`](../../../tests/helpers.ts)) and still exercises the real read logic, against an injected map. Covered readers: `resolveTemplatesDir`, `readConfigTemplate` (threaded through the `MigrationContext`), `loadIdentitySettings`, `resolveWorktreeId`, `terminalWidth`/`helpWidth`/`operatorHelp`, and `colourEnabled`.
- **The cwd** is passed explicitly: `runUpgrade`/`runUpgrade` gained an optional `cwd` (default `Deno.cwd()`), so the upgrade tests pass the temp dir instead of `Deno.chdir`-ing into it and back.
- **The git subprocess env** is forwarded, not set on the process: `runGit`/ `worktreeState` gained an `env` option merged over the parent environment ([ADR 0054](0054-subprocess-single-source.md) keeps `runGit` the one git spawner), so `git_test` hands its isolation env — and the empty PATH for the not-found case — straight to the spawn.

The test job (`deno task test`) gains `--parallel`. A new architectural guard ([`tests/parallel_safety_test.ts`](../../../tests/parallel_safety_test.ts)) walks every `tests/*.ts` and fails if one contains `Deno.chdir(`, `Deno.env.set(`, or `Deno.env.delete(`, driven off the file glob so a new file auto-enrols — the same forcing-function discipline as [ADR 0051](0051-canonical-set-parity.md). Env _reads_ (`Deno.env.get`) are not flagged; they cannot race.

## Consequences

- The gate's test stage runs ~6× faster on a multi-core machine, and the win scales with available cores.
- A reusable pattern falls out: any future engine function that reads ambient env/cwd should take the same injectable seam, keeping it unit-testable without touching the process. The guard makes the rule self-enforcing — the parallel-safety regression cannot silently return.
- `--parallel` makes test-_file_ scheduling nondeterministic. With the process-global mutations removed there is no shared state for that to expose, but a test that newly depended on global ordering would surface here rather than in a reproducible serial run. `--shuffle` remains an on-demand check for _ordering_ coupling, and is orthogonal: it reorders tests but still runs them serially, so it tests a different property than `--parallel`.
- Injecting an `EnvReader` widens a few signatures with one defaulted trailing parameter — a small, contained cost paid once at the seam.

## Alternatives considered

- **Split the test run** — `--parallel` for the safe majority, serial for the nine mutators. Most of the speedup with no `src` change, but it relies on a hand-maintained file denylist (drift-prone, against [ADR 0051]'s grain) and does not remove the leak at its source: a new mutator added to the "safe" set silently reintroduces the flake, and the inherited-env vector stays open.
- **`clearEnv: true` on every subprocess spawn** — closes the inheritance vector but not the in-process reader races (a concurrent file reading a leaked global directly), so it is incomplete on its own.
- **A shared async mutex around the mutating tests** — serializes the offenders yet does nothing for readers in other files; a band-aid over the global rather than removing it.
