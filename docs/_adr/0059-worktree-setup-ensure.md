# ADR 0059: `[worktree.setup].ensure` — a convergent setup bucket that re-runs every pass

**Status**: accepted. Realizes the deferred "Part B" of
[ADR 0055](0055-integrate-verb.md), and mirrors the resource `create`/`ensure`
split of [ADR 0025](0025-worktree-resources.md).

## Context

`[worktree.setup].steps` run **once**, at worktree creation: they are
sentinel-guarded and skipped on re-entry. Yet the schema told authors to write
them "idempotent so a recovered partial setup re-runs safely." That contract was
near-vestigial — the steps run once — and easy to miss. Idempotency was hung on
the wrong hook.

[ADR 0055](0055-integrate-verb.md) gave the worktree lifecycle its middle verb,
`discern integrate`: it brings `main` into a branch and re-materializes the
**discern-owned** artifacts (the generated agent files + the materialized
skills). It does **not** keep the **user-owned** environment current. A merge
that changes a lockfile leaves the worktree's dependencies stale, and the agent
finds out only when the gate's tests fail on a missing module — exactly the
late, slow failure integrate exists to prevent for agent files. ADR 0055
deferred "re-run the worktree's setup after a merge" as **Part B**.

The naive Part B — blindly re-run **all** setup steps on every integrate — was
rejected. It forces _global_ idempotency on every step to solve a _local_
problem, and a one-shot step (create a database, append to a file) would break
on every integrate, its "already exists" non-zero exit turning a good worktree
red.

## Decision

**Give `[worktree.setup]` a second list, `ensure`, beside `steps`.** `steps`
stays one-shot (run once at creation, not re-run); `ensure` is **convergent** —
it re-runs on **every** setup pass to keep the worktree current with the tree.
The buckets are the same split discern already has for a resource:

| bucket   | runs                                       | author it  |
| -------- | ------------------------------------------ | ---------- |
| `steps`  | once, at creation                          | one-shot   |
| `ensure` | every pass (creation, re-entry, integrate) | idempotent |

This mirrors a resource's `create` (once) and `ensure` (reconcile at session
start) from [ADR 0025](0025-worktree-resources.md). **The re-run contract
becomes legible from the config _shape_, not a prose footnote**: a command in
`ensure` obviously re-runs; a command in `steps` obviously does not. A user who
already understands resource `ensure` understands this immediately.

**`ensure` runs at three points**, through one shared `runEnsureSteps` helper
(the single implementation):

- **creation** — after the one-shot `steps`, as the final environment step
  before the agent-file refresh;
- **session-start re-entry** — in `worktree:ensure`'s already-configured branch,
  alongside resource `ensure`, so a re-entered worktree re-converges (gated by
  the existing `[worktree].enabled` session-start mechanism);
- **`discern integrate`** — after the merge + the agent-file refresh. This is
  the motivating case: a merge that changed a lockfile is followed by a
  reinstall, with no manual step.

**Failure semantics** track where the failure happens:

- at a **fresh creation**, an `ensure` failure is **fatal** — it aborts setup,
  exactly like a `steps` failure. A worktree that cannot ready its environment
  is broken; fail loudly.
- on **re-entry or integrate**, an `ensure` failure is **non-fatal but
  recorded** — a failed step plus a warning. It never undoes a completed merge
  or breaks session start over a convergence hiccup; the gate is the backstop.
  This mirrors how integrate already treats its post-merge refresh (recorded as
  `failed`, merge kept).

The reframe is the point: **idempotency is expressed as config shape, not a
prose contract and not a brittle shell-inspecting linter.** So `steps` is
reworded to drop its idempotency over-claim, and no per-step machinery is added.

**`ensure` runs at session start too**, not only at creation and integrate, for
exact parity with resource `ensure`. The cost lever is the author's: a
fast-when-current command (`<install> check || <install>`) over an always-clean
one (`<install> --clean`). The deliberate trade is one cheap reconcile per
session for a worktree that is never silently stale.

Adding the key is backward-compatible: it is optional and defaults to `[]`, so a
config with only `steps` behaves exactly as before. No `SCHEMA_VERSION` bump or
migration is needed (an additive optional key with a default). A new
`setup-ensure` step kind lets the setup and integrate plans — and their
`--dry-run` / `--json` — distinguish the two buckets.

## Consequences

- **The staleness gap closes for the user-owned environment.** A merge that
  changes a lockfile, followed by `discern integrate`, leaves dependencies
  current with no manual reinstall — the same gap integrate already closed for
  the discern-owned agent files, now closed for the environment.
- **The idempotency requirement lives where it is true.** It moved off `steps`
  (which run once) onto `ensure` (which re-runs), so the schema no longer
  misdirects authors.
- **One more step kind to carry.** `setup-ensure` joins the closed `STEP_KINDS`;
  the wire schema and its round-trip test follow from that one edit.
- **A per-pass cost at session start.** The author controls it by writing a
  fast-when-current command; an always-clean install is a choice, not a default.
- **No silent middle ground.** A failed `ensure` is either fatal (creation) or a
  recorded failed step (re-entry / integrate) — never swallowed.

## Alternatives considered

- **Blindly re-run all `setup.steps` on every integrate** (the naive Part B).
  Rejected — it forces global idempotency on every step, and a one-shot step
  breaks on every integrate.
- **Per-step config flags, `watch`/fingerprint globs, or idempotency wrappers.**
  Rejected — the two-bucket split _is_ the design. Per-step machinery re-hangs
  the same contract on a knob the shape already expresses.
- **A linter that inspects setup commands for idempotency.** Rejected —
  idempotency of an arbitrary shell command is undecidable; a denylist is
  brittle and theatre. The config shape makes the contract legible without
  guessing at command semantics.
- **Run `ensure` only at creation + integrate, not session start.** Rejected —
  it breaks parity with resource `ensure`, and session start is the natural
  reconcile point for an environment that drifted out-of-band (a host reboot, a
  pruned dependency cache).
