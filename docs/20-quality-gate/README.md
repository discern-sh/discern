# The quality gate

_`discern finish` — the compound gate that fixes, builds, checks, and tests
before work is called done._

This subtree covers the gate and everything it runs. The built-in
[`finish`](../../src/engine/gate/finish.ts) verb first runs fail-fast
preconditions: the **merge check** — in a Worktree, that the branch contains the
latest `main` ([ADR 0050](../_adr/0050-merge-check-fail-fast.md)); the
tracked-artifacts guard, which refuses discern-managed ignored artifacts that
were force-added to Git; and the generated guidance/skills currency checks. If a
precondition fails, the gate stops before spending the slow Stages on a result
that the required tree or index repair would invalidate. It then walks the
**Stages** in order — **fix** (serial, mutating fixers), **build** (parallel
artifact producers), then **check** and **test** in parallel — and each
**Capability** and **Check** runs as its own labelled job, so a failure points
at the exact one rather than a whole Stage. A known Capability's Stage is
derived from its name; a Check states its own. After the Stages come the
**Scope** `gate`s for any Scope that changed.

Interrupting the gate stops it cleanly: each job runs detached in its own
process group so the runner can tree-kill it whole, and every shutdown path — a
fail-fast sibling failure, Ctrl-C/SIGTERM on the process, an MCP client
cancelling its call, or the MCP server shutting down — funnels into that same
kill, so no orphaned gate processes outlive the run
([ADR 0105](../_adr/0105-interruption-reaches-detached-gate-jobs.md)).

Every job runs through `sh -c` in a **non-interactive environment**: stdin is
closed, there is no TTY, and `NO_COLOR` / `TERM=dumb` / `CI=1` are exported. The
first two tell tools they are not on a terminal, so they emit plain text an
agent can read rather than colour and cursor control; `CI=1` is the honest
signal for what the gate is — a local CI run — and is what flips the many
watch-vs-single-run test runners into their single-run form, so a bare
`test = "<runner>"` never enters watch mode and waits forever for a file change.

As a backstop, every job is bounded by `[gate].timeout` (default 600 seconds): a
command that never exits within it is tree-killed — its whole process group,
grandchildren included — and the stage fails with a plain-language diagnostic
that names the usual cause (a watch-mode runner or a dev server) and the ways
out (wire it in its single-run form, or raise the budget). So even a runner that
ignores `CI` cannot make the gate hang; the guarantee is behavioural, never a
list of known runner names ([ADR 0108](../_adr/0108-gate-job-timeout.md)).

`discern prepare` is the fast inner loop: the fix-stage then check-stage work,
with no build or test. `--json` emits the **`DiscernResult` envelope** — the one
result shape every verb returns
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)):
`{ok, verb, steps, diagnostics?, hints?, data}`, a serialization of the plan
`finish` executed, not a re-derivation. Each Capability/Check/Scope gate is a
`steps[]` entry with its outcome, duration, output artifact path, and
lightweight line counts. A genuine failure also yields a `diagnostics[]` entry
carrying the command to reproduce it and its captured output: either a clean,
capped Tier-0 excerpt with `output_path` for the full normalized capture when
truncated, or file/line/rule findings when the tool emits SARIF. Passing jobs
that print many error-like lines add an advisory `hints[]` pointer to their
output artifact without changing the gate result. This lets an agent loop
act→read-error→fix instead of re-running and scraping stderr, while still making
loud successful jobs inspectable
([ADR 0096](../_adr/0096-passing-jobs-keep-output-artifacts.md)). `hints[]`
carries the next-step advice the human tail prints. Under `--json` the envelope
is the **entire** output: all narration and command output is suppressed (not
rerouted), so the combined stdout+stderr is exactly that one object — safe for
an agent to capture
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md),
[ADR 0083](../_adr/0083-normalize-and-offload-diagnostic-output.md)).
`finish --dry-run` prints the plan (the jobs and Scope gates that _would_ run)
without running anything
([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)); it is honest that it
cannot predict which jobs fail-fast would skip. The same envelope is served to
agents natively over MCP by `discern mcp`.

The supporting ideas: **Capabilities** are the six known commands (`format` /
`build` / `lint` / `typecheck` / `test` / `smoke`) and a **Check** is custom
gate work with an explicit Stage (ADR 0017); **Scopes** classify which part of
the repo a change touches and **fail open** (an unknown path runs more gates,
never fewer), and a Scope can carry its own `gate` so a sub-component plugs in
(ADR 0018); **Ratchets** hold never-loosen metric floors and ceilings — a raw
value or, via `per`, a rate that doesn't rise just because the project grew — on
demand, outside `finish` because they are slow (ADR 0003, ADR 0057).

Alongside the gate sits the **[continuous-improvement coach](improve.md)**:
where `finish` asks _did this change pass?_,
[`improve`](../../src/engine/improve/rules.ts) asks _what should get better
next?_ It reports objective baseline health, keeps qualitative reviews visible,
and prioritizes one action. Deterministic rules remain distinct from subjective
reviews the agent judges against cited material
([ADR 0029](../_adr/0029-best-practices-audit.md),
[ADR 0079](../_adr/0079-improve-is-a-coach-not-an-audit.md)).

Alongside it sits the **[co-change advisory](coupling.md)**: where `improve`
asks _is this setup any good?_,
[`coupling`](../../src/engine/coupling/coupling.ts) asks _what tends to change
with what?_ — mining git history for the files that move together and naming the
sibling a change is likely missing. It is purely advisory and **never blocks**
(it only ever adds `hints[]`), surfacing on demand or, behind
`[coupling].in_gate`, at the tail of `finish`. It is the discovery end of the
canonical-set discipline (ADR 0051) that the gate's parity tests enforce
([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)).

## In this section

| Leaf                                               | What it covers                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ratchets.md`](ratchets.md)                       | Never-loosen floors and ceilings, raw counts versus `per` rates, the `DISCERN_METRIC` protocol, and what to do when one fires.                                       |
| [`the-result-envelope.md`](the-result-envelope.md) | The `DiscernResult` envelope every verb returns, its `diagnostics[]`, the typed result schemas, and `discern mcp`'s self-describing surface (ADR 0028, ADR 0041).    |
| [`ci.md`](ci.md)                                   | How to run `discern finish` on GitHub Actions so the gate protects `main` outside local runs, and what an ephemeral cloud-agent environment sees without the binary. |
| [`improve.md`](improve.md)                         | The continuous-improvement coach — what should get better next, versus the gate's did-this-pass.                                                                     |
| [`coupling.md`](coupling.md)                       | The co-change advisory: the self-calibrating metric, the diff-aware/query/evidence modes, and the default-off gate hint (ADR 0084).                                  |

## See also

- [concepts.md](../00-orientation/concepts.md) — the gate in the daily loop.
- [finish-gate-gotchas.md](../80-development/finish-gate-gotchas.md) —
  non-obvious ways `finish` fails.
