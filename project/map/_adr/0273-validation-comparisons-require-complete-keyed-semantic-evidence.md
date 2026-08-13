# ADR 0273: Validation comparisons require complete keyed semantic evidence

**Status**: accepted

## Context

The `same-tree-flake` reader grouped `done` and `test` runs by invocation-start HEAD plus a checksum of `git diff HEAD`. That value was neither the exact input the jobs saw nor a safe comparison key. Index-only and worktree-only forms with identical working bytes collapsed, untracked files disappeared, submodule state was incomplete, and `done` sampled before its fix and build jobs could rewrite the tree. Physical Git-index bytes are not a better identity: status refreshes may update stat-cache or extension data without changing the staged entries, while split and sparse indexes may encode the same semantic state differently.

The reader also classified test failures from the completion event's top-level `failed_stage`. A standalone `discern test` failure reports its result in `steps[]` and has no Gate payload, so those failures were silently missed. Conversely, `check/test` does not prove that a test job, rather than a check job, failed.

The Logbook must remain local metadata. A plain content or path hash published in a Logbook line would allow dictionary checks against suspected project content. Capturing complete repository state can also be expensive or impossible, and recording must never change a validation command's verdict.

## Decision

Validation entry points are registered with their mode, relevant stages, and capture moment. The initial registry contains full-Gate `done` and standalone `test`. Every planned job in the registered stages enters the execution envelope automatically.

One pure job-outcome function derives `passed`, `failed`, `skipped`, `cancelled`, or `unavailable` from an explicit recorded step. Patterns uses that authority whenever it reasons about a test result. Missing or foreign legacy step evidence is unavailable; absence never implies a pass or failure. A legacy standalone test can identify its job steps. A legacy full Gate recognizes a separately grouped Test step or the known `test` and `smoke` labels, but does not guess the stage of an unknown job from `failed_stage = "check/test"`.

Each completed validation event may carry an additive `validation` record at version 1. `done` captures after every mutating fix/build pre-group has settled and immediately before its check/test scheduler. `test` captures immediately before its standalone test group. A validation blocked before that boundary records `boundary/not-reached` rather than sampling a tree its jobs never saw.

The state is a canonical, length-framed semantic manifest of:

- the full HEAD commit identity;
- every index entry's visibility tag, mode, object id, stage, and raw path bytes from `git ls-files --stage -v -z`, including conflict stages;
- each tracked worktree entry that differs from the index or has an assume-unchanged, skip-worktree, or merge-stage tag, including deletion, type, executable mode, symlink target, and binary bytes;
- every untracked entry that Git does not ignore, with the same filesystem distinctions; and
- the expected and working commits of each recursively initialized submodule.

The index manifest deliberately excludes physical index stat-cache and extension bytes. `ls-files` resolves split-index storage and expands sparse representations to semantic entries, so an index refresh does not move the identity while a staged object, mode, stage, visibility tag, or path does. Visibility-tagged entries force observation of their actual checkout state: sparse absence and bytes hidden by assume-unchanged cannot disappear behind an ordinary diff. An unknown future tag, a conflicted gitlink, an uninitialized or wrong-commit submodule, and any dirty or recursively incomplete submodule make the snapshot incomplete.

A random 32-byte HMAC-SHA-256 key lives as a regular repository-common Git-admin file rather than a symbolic link at `discern/validation-hmac-key`, mode `0600`. Every use checks that invariant; an unsafe existing artifact is neither followed, altered, nor replaced. Component and combined state digests, config identity, worktree-setup identity, and job-definition digests are domain-separated keyed hashes. Logbook lines retain only opaque digests, counts, byte totals, capture timing, completeness, and categorical failure reasons. They contain no manifest, path, content, command, config value, environment value, or reusable plain hash. Job ids, stages, kinds, normalized outcomes, execution mode, concurrent-sibling flags, and writer version remain ordinary bounded metadata.

Repository capture has hard ceilings of 20,000 path observations, 64 MiB of Git output plus index/content bytes, and 5 seconds. One capture-wide wall-clock deadline races the whole state and execution capture, including key resolution, filesystem and submodule identity, and cryptographic effects. Every Git probe also receives the remaining deadline and combined stdout/stderr allowance; crossing either kills the process and closes its capture streams before generic buffering can exceed the boundary. Filesystem reads are size-checked before allocation. A host promise without a cancellation API may settle after expiry, but the capture returns `budget/time-limit` at its deadline and observes then ignores any late result or rejection. The execution envelope has separate ceilings of 1,000 selected jobs and 1 MiB of canonical config, setup, and job-definition input, size-checked before serialization, while remaining under the shared deadline. A committed benchmark fixture with 250 one-KiB files must remain below one tenth of the path limit, one hundredth of the byte limit, and the time limit.

Any key, Git, filesystem, path-decoding, submodule, execution-envelope, or budget uncertainty sets `complete: false`, records a categorical reason, and omits the affected combined digest. Both exported capture paths are total: dependency, canonicalization, and cryptographic failures become minimal internal/unavailable evidence and never replace the validation result already being recorded. Readers may compare only complete state and complete execution envelopes of the same validation-evidence version. Mode, writer, config/setup digests, test job definitions, and concurrent-sibling flags are part of the comparison key. Legacy identity is version-prefixed separately. Incomplete, legacy, and current evidence never blend.

The evidence rides from a Gate result to the recorder on an enumerable symbol. JavaScript object spread preserves it inside the process, while JSON serialization and the strict public CLI/MCP result schemas ignore symbol keys. The Logbook recorder alone lifts it into the optional event field. The public result contract is therefore unchanged.

Ignored files, external services, clocks, random seeds, the runtime environment, and concurrent external processes remain explicitly unrecorded dimensions. The evidence proves equality only for its stated repository and controlled-execution dimensions.

## Consequences

- Index-only, worktree-only, untracked, mode, symlink, binary, and submodule states no longer collapse into one current-version validation identity.
- A standalone test failure contributes a red test verdict. Skipped, cancelled, missing, and ambiguous legacy test evidence contributes neither red nor green.
- Running `git status` or refreshing a physical index does not invalidate otherwise identical semantic evidence.
- Two runs with the same project state but different commands, config/setup, standalone/full-Gate mode, or concurrency are not called the same input.
- Large, unreadable, racy, visibility-uncertain, or recursively incomplete-submodule trees still run their configured validation normally. Their Logbook event is honest about incompleteness and cannot support a same-input claim.
- The repository-common key is local runtime state removed with discern's Git-admin namespace. Worktrees share it, so their opaque digests remain comparable inside one repository and useless as cross-repository content fingerprints.
- Capturing changed tracked entries depends on Git's index/worktree comparison. A concurrent external writer can still race the capture; that dimension is disclosed rather than overstated as an atomic filesystem snapshot.

## Alternatives considered

- **Keep `git diff HEAD` and add untracked files.** Rejected because index-only and worktree-only forms still collapse and the capture moment remains wrong.
- **Hash the physical `.git/index` file.** Rejected because stat-cache refreshes and split/sparse encodings create false differences without semantic index changes.
- **Store SHA-256 hashes without a repository key.** Rejected because paths and low-entropy contents become testable by anyone who obtains a Logbook line.
- **Record paths, commands, or the canonical manifest.** Rejected because the Logbook is metadata, not a second source tree or secret-bearing execution trace.
- **Recursively fingerprint dirty submodule bytes.** Rejected for version 1 because it makes cost and nested ignore/config semantics unbounded. Version 1 recursively verifies initialized clean commits and fails comparability on dirt or missing initialization.
- **Treat partial component digests as comparable.** Rejected because equality of what happened to be readable is not equality of validation input.
- **Add validation evidence to the public result schema.** Rejected because it is recorder transport, not a CLI or MCP result contract, and would expose local operational metadata unnecessarily.
