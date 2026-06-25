# ADR 0037: Setup-incompleteness is an observable state, not a prose handoff

**Status**: accepted

Hardens the handoff introduced by [ADR 0036](0036-unify-setup.md) (unify init +
bootstrap into `discern setup`), applying the "gate-detectable, not a plea"
pattern of [ADR 0034](0034-agents-md-untracked-currency-check.md) and leaning on
`status` as the reflexive orientation verb
([ADR 0033](0033-status-verb-and-location-aware-scope.md)).
[ADR 0044](0044-setup-involve-not-gate.md) later revises the same brief's
interaction model (propose-and-confirm → involve-narrate-commit-revert) while
preserving the incompleteness signaling hardened here.

## Context

ADR 0036 made `discern setup` a single command: it scaffolds the machinery, lays
the doc skeletons, prints an authoring brief for the agent in the loop, and
exits 0. The project-specific work — principles, docs, capability fills — is the
**agent's** job, and `discern setup done` is the gate that validates it (no
skeleton markers left) and records `[meta].bootstrapped`.

In practice an agent ran `discern setup` and **stopped**, reporting the work as
finished without doing it. The tell: the bullets it handed back were a
near-verbatim echo of the brief's closing **"Done when"** checklist. It had read
three signals, all pointing at "done" — exit 0, the green `✓`, and a closing
checklist phrased as past-tense-able assertions — and mistook the brief's
stop-conditions for a report of completed work. The brief said "this is your
job" at the top (line 3), but the most salient artifacts at the moment of
stopping all said "success."

The root cause is structural, not a wording slip: **a command that delegates
work and then exits 0 has converted "the task is done" into "the command
succeeded," and the agent reads the stronger signal.** The handoff was prose at
the tail of a long stdout dump — the weakest possible enforcement — and nothing
surfaced the half-finished state where the agent looks next.
`[meta].bootstrapped = false` was tracked, but only as a soft,
main-checkout-only hint buried in `status`. No backstop pulled a stopped agent
back.

Sterner prose can lower the probability but cannot prevent it — agents skim. To
_prevent_ the misread, the incomplete state has to become structural: machine-
detectable, surfaced in the reflexive loop, and never dressed as success.

## Decision

**Make "setup not finished" a first-class observable state, defended at four
points, and stop the `setup` command's output from reading as completion.**

1. **De-success-ify the command output.** `discern setup` leads with a loud
   `SETUP STARTED — NOT FINISHED` banner that names the trap (work to do now,
   not a result to report), drops the green `✓` headline, and ends with a
   **tail-survivable footer** — so even if the top is truncated to save context,
   the last lines still carry "not done," how to reprint the brief (re-run
   `discern setup`, idempotent), and how to finish (`discern setup done`).
   Everything prints on stdout so the frame can't land on a stream the agent
   ignores. `--json` carries `complete:false`, `bootstrapped:false`, and a
   `next_action`, so a JSON-consuming agent can't read `ok:true` / exit 0 as
   done.

2. **Surface it loudly in `status`, in every location.** Whenever
   `[meta].bootstrapped` is unset, `status` reports `data.setup_unfinished`
   (structured evidence: the scaffolded files still carrying markers), a
   **leading** hint, and a banner under the heading. The old nudge fired only
   from the main checkout and only as a buried hint; this fires from a worktree
   too. The marker walk runs only while `!bootstrapped`, so a finished project
   pays nothing. This generalizes ADR 0034's currency check — evidence in
   `data`, a lead hint — from "is the generated file stale?" to "is setup
   finished?".

3. **Remind on session start.** The SessionStart hook already runs
   `discern worktree:ensure`; while `!bootstrapped` it now prints the canonical
   resume reminder to stdout (which a SessionStart hook injects as context), so
   a session opened mid-setup is told to finish it. Teaching the **command's
   behaviour** rather than the settings template means existing installs get it
   on binary upgrade, with no migration.

4. **Reframe the brief's close.** `## Done when` (a report) becomes
   `## You are not done until all of these are true` (stop-conditions to
   verify), and the brief names the echo-it-back trap explicitly. The opening
   banner does too: "work to do now, not a summary to hand back."

The marker detection and the canonical reminder wording live once, in
`src/shared/setup_state.ts`, consumed by `setup done`, `status`, and the session
hook — so the three surfaces can never drift.

The explicit **no**s:

- **Exit stays 0.** The scaffold genuinely succeeded; a non-zero exit would
  break CI and the `--config` declarative path and misreport what happened.
  "Incomplete" belongs in the payload and the framing, not the exit code.
- **No per-step progress tracker — yet.** A "4/9 steps done, next: X" state
  machine would make stopping early _visibly_ incomplete, but several brief
  steps have no reliable completion predicate (which model is running, "ask the
  user"), and the marker list in `status` already answers "what's left" with
  evidence. Deferred until the hardening above proves insufficient, recorded
  here so it is a known next step rather than a fresh idea.

## Consequences

- The failure is now **self-correcting**: any reflexive `status` call or any new
  session re-surfaces the half-done state with evidence, the command no longer
  presents success, and the brief can't be mistaken for a summary. Regression is
  guarded by `tests/engine_setup_handoff_test.ts`.
- The marker walk runs on `status` and on every session start while
  `!bootstrapped` — bounded to `docs/**.md` + `guidance.md`, and gated so a
  finished project never pays for it.
- A worktrees-off install has no SessionStart hook, so it loses defence (3);
  defences (1), (2), (4) still apply. Acceptable for a rare configuration.
- The CLI human `status` shows the reminder both as a top banner and as a bottom
  hint. The mild redundancy is intentional — loud beats subtle for the one state
  that, missed, makes every later session inherit an unfinished setup.

## Alternatives considered

- **Sterner prose only.** Rejected: it lowers the probability but cannot prevent
  the misread, because the agent skims to the checklist. Naming the trap helps
  at the margin and is kept (defence 4), but it is not the mechanism.
- **Non-zero exit for `setup`.** Rejected: see the explicit no above — it would
  break CI and `--config`, and lie about a scaffold that succeeded.
- **A per-step stateful progress tracker now.** Deferred, not rejected: it is
  the version where stopping early is structurally impossible, but it is a
  larger change with brittle per-step predicates, and the observable-state
  hardening delivers most of its value. Recorded so it is not re-proposed as
  novel.
