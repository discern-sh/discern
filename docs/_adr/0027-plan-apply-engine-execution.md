# ADR 0027: Plan/apply as the engine's execution model

> **Current-state note.** The plan vocabulary (`StepKind`, `EnginePlan`,
> `renderPlan`, `planToJson`) was consolidated into `src/shared/result.ts`
> alongside the result envelope
> ([ADR 0028](0028-result-envelope-and-diagnostics.md)); the per-verb plan
> builders live in `src/engine/gate/plan.ts`, `src/engine/gate/ratchet_plan.ts`,
> and the worktree lifecycle. The decision stands; only the file locations moved
> (the cited `engine/plan/*` paths below are updated to match).

**Status**: accepted

## Context

discern is two halves that share one binary: the **installer**
(`src/commands/**`) and the **engine** (`src/engine/**`). The installer half
already had the right execution shape. `init`/`add-preset` compute a pure `Plan`
— a flat list of operations, built _before_ anything is written
([`src/lib/fs_plan.ts`](../../src/lib/fs_plan.ts)) — and a thin executor applies
it, with rendering kept separate
([`src/lib/plan_view.ts`](../../src/lib/plan_view.ts)) so planning stays pure.
That one split is why those verbs get `--dry-run`, a review screen, and
near-free idempotency.

The **engine half never adopted it.** Every effectful engine verb computed _and_
executed in a single imperative pass:

- The gate (`gate/finish.ts`) loaded config, queried git, derived jobs, spawned
  subprocesses, and formatted output in one function — and then **re-derived**
  the `--json` report by calling `jobsInStage` again _after_ execution, rather
  than serializing what it actually ran.
- `graduate`, `worktreeSetup`, `worktreeTeardown`, `worktreePrune`
  (`worktree/lifecycle.ts`) were imperative effect-chains. The scary, stateful
  ones (prune's GC; graduate's teardown / checkout or fast-forward dance) fired
  with no inspectable preview — only `prune` had an ad-hoc `--dry-run`.

The costs of that asymmetry:

1. **No `--dry-run` on the verbs that most need it.** You could not preview a
   graduation or a prune-GC pass before it mutated git and destroyed resources.
2. **`--json` was reconstructed, not serialized.** The gate report re-walked the
   config after execution; a divergence between "what ran" and "what was
   reported" was a latent bug the structure invited.
3. **The decision logic was unreachable without spawning subprocesses.** Testing
   "given this config and these changed scopes, which jobs run" meant
   scaffolding a temp repo and driving the CLI — 100–500 ms per assertion
   instead of 1–5 ms.

## Decision

**Generalize the installer's plan/apply pattern across the engine seam.** Every
effectful engine verb now computes a pure plan first, then a thin executor
applies it; `--dry-run` renders the plan and touches nothing, and `--json` is a
**serialization of (plan, results)**, never a re-derivation.

### Engine ops are not filesystem writes

We did **not** force-fit `fs_plan.ts`'s `PlanOp` (whose `kind` is
`write`/`merge`/`append`). We modelled the _shape_ — a pure data description
with a disposition + note, separate from both the executor and the renderer —
but gave the engine its own op vocabulary in
[`src/shared/result.ts`](../../src/shared/result.ts): a `StepKind` of `job` /
`scope-gate` / `merge-check` / `resource-create` / `resource-destroy` / `git` /
`setup-step` / `env` / `refresh` / `ratchet`, with a `StepDisposition` of `run`
(will act) / `skip` (in the plan but won't act — a configured-but-unchanged
scope gate) / `gate` (a read-only precondition that can _block_ but mutates
nothing — the merge check).

Each verb keeps its **own typed plan** (a `GatePlan` carries job groups with
commands; a `GraduatePlan` carries the diagnosed git state) so its executor
stays type-safe, and projects that plan to a common `EnginePlan` for
presentation. A gate plan and a worktree plan are different types sharing one
renderer.

### Where the read/effect line sits

Following the `fs_plan` precedent: **planning may do read-only I/O** — load the
typed config, classify the changed scopes, query the merge status, read the
resource ledger. The **executor owns every mutation and every job spawn.** Then,
_only where it pays_, the **decision logic** is factored into pure functions
that take state as arguments and run with zero I/O:

- gate job derivation and scope-gate selection — `planStageJobs`,
  `planScopeGates`, `buildGatePlan` in
  [`gate/plan.ts`](../../src/engine/gate/plan.ts);
- the prune-GC reclaim decision — `classifyOrphans` in
  [`worktree/resources.ts`](../../src/engine/worktree/resources.ts), the
  load-bearing safety logic (an entry is kept when its worktree is live by
  git_key, path, OR resource handle, or it opted out of GC; everything else is
  reclaimable), now rebuilt under the effectful `gcOrphanResources` and unit-
  tested directly;
- ratchet derivation — `buildRatchetPlan` in
  [`gate/ratchet_plan.ts`](../../src/engine/gate/ratchet_plan.ts).

We did **not** dogmatically inject every read. The plumbing (resolving a git
dir, reading a ledger file) stays where it is; only the _decisions_ were lifted
out.

### One renderer

[`src/shared/result.ts`](../../src/shared/result.ts) is the engine mirror of
`plan_view.ts`: `renderPlan` (→ human listing) and `planToJson` /
`resultsToJson` (→ JSON). Every converted verb routes its `--dry-run` and
`--json` through it. It writes through a minimal `RenderSink` that **both** the
gate's `Out` and the installer's `Logger` implement (via `outSink` /
`loggerSink`), which begins collapsing discern's two presentation paths into one
— a welcome side-effect, not the goal.

### The gate plan is a substrate for the next thread

The gate plan carries its stages as **data** — an ordered list of `JobGroup`
(`{stage, mode: serial|parallel, jobs}`) — not baked into the type. The current
gate still _builds_ that list by unrolling
`fix → build → check∥test →
scope-gates` by hand, but a future change can
resolve a `needs`/`provides` DAG by topological sort and **produce the same
`GatePlan`**; the executor and the report never learn which produced it.

### `finish --json` is preserved byte-for-shape

The published report contract
([ADR 0004](_superseded/0004-structured-finish-json.md)) —
`{ ok, jobs:[{name,kind,stage,status,duration_s}], scope_gates:[…],
scopes_changed:[…], failed_stage }`
— is now built by `buildGateReport`, which **serializes the plan it executed
plus the per-job results** (walking the plan's groups, looking each job up by
label, missing → `skipped`). It is no longer re-derived from the config. The
existing `finish --json` tests stay green unchanged.

## Consequences

- **`--dry-run` works on every effectful verb** — `finish`, `graduate`,
  `worktree` (setup), `worktree:teardown`, `worktree:prune`, and `ratchets` —
  free, because the plan is computed before any effect. Each also accepts
  `--dry-run --json` (the plan as JSON) and, when applied, `--json` (a
  serialization of plan + results). The pure-query verbs `worktree-name` and
  `changed-scopes`, and the thin `prepare`/`test` gate variants, were left alone
  — they have no apply step to plan.
- **The planners are unit-tested without a subprocess.** `gate_plan_test.ts`,
  `worktree_plan_test.ts`, and `ratchet_plan_test.ts` exercise the whole "what
  would run / what would be reclaimed / how does it serialize" decision in ~1 ms
  per assertion (a full file in single-digit milliseconds), versus ~150–200 ms
  for the subprocess-driven integration tests, which stay as the
  behavioural-parity oracle.
- **No schema bump, no migration, and no `MIGRATION_PROMPT.md`.** Unlike the
  typed-config change ([ADR 0026](0026-typed-config-schema.md)), which tightened
  the _validation_ a project's config could trip on, this is internal control-
  flow restructuring: it changes no config shape, no on-disk format, and no
  project file. `SCHEMA_VERSION` is untouched. A dogfooding project needs
  nothing but the rebuilt binary — so, deliberately, none was written.
- **One intended human-output change.** `worktree:prune --dry-run` now renders
  the shared plan listing instead of the old per-function "Would reclaim N …"
  narration. Its scan stays read-only and its _apply_ narration is byte-
  identical; only the dry-run preview text changed (folding prune's pre-existing
  `--dry-run` into a real plan rather than leaving a parallel path was the
  point). Every other existing human string and the `finish --json`,
  `changed-scopes --json`, and `worktree-name --json` contracts are unchanged.
- **Scope timing is preserved exactly.** The gate's apply path still classifies
  the changed scopes _after_ the stage groups run (`buildStageGroups` →
  `changedScopes` → `scopeGatesGroup`), not before — because `changedScopes`
  reads the working tree, which a fix-stage codemod can mutate, and classifying
  earlier could run _fewer_ scope gates than the post-fix tree warrants, against
  the fail-open bias. `--dry-run` classifies once, read-only (it runs no fixers,
  so the tree it sees is the one the apply would start from); the pure
  `buildGatePlan` composes the same two halves for that preview and for the unit
  tests.
- **One genuinely safe ordering shift.** Graduation now creates the worktree's
  branch in the _executor_ (after the read-only preconditions pass) rather than
  during diagnosis, so a detached+behind worktree fails the precondition
  _before_ a branch is created rather than after — strictly better. The only
  observable consequence is cosmetic: in the doubly-rare
  detached-HEAD-plus-dirty-main case, the refusal message names the base branch
  (`agent/foo`) rather than a disambiguated created one (`agent/foo-a1b2c3d4`).

## Alternatives considered

- **Force-fit `fs_plan.ts`'s `PlanOp`.** Rejected: the engine's operations are
  job spawns, resource lifecycles, and git surgery, not file writes. Sharing the
  _shape_ (pure description + disposition + separate executor and renderer)
  while giving the engine its own op vocabulary keeps each side honest.
- **One universal engine plan type.** Rejected: a gate plan (job groups) and a
  graduate plan (diagnosed git state) carry genuinely different data. Letting
  each verb keep its typed plan and project to a common `EnginePlan` for
  rendering keeps the executors type-safe without a lowest-common-denominator
  union.
- **Keep prune's dry-run as a parallel `if (dryRun)` path.** Rejected: that is
  the exact "compute-and-execute, plus a second branch that lies a little" shape
  this ADR removes. Prune now builds one plan and either renders or applies it;
  the resource-GC decision (`classifyOrphans`) is shared by the preview and the
  real reclaim, which is what de-risks the future resource-ledger work — a GC
  pass is inspectable before it destroys anything.
- **Inject every read to make the verbs fully pure.** Rejected as dogma:
  factoring the _decisions_ (job derivation, GC reclaim) buys the fast tests;
  injecting the plumbing (git-dir resolution, ledger reads) would add ceremony
  for no test or clarity gain.

This generalizes the installer's [`fs_plan`](../../src/lib/fs_plan.ts) pattern
across the engine seam, preserves
[ADR 0004](_superseded/0004-structured-finish-json.md)'s structured-output
contract, and deliberately shapes the gate plan so a future job-graph resolver
can produce it.
