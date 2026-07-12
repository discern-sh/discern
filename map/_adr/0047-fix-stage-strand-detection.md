# ADR 0047: `done` blocks a fix stage that strands uncommitted changes

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` →
> `accept`, the retired product-category wording → `discern`, the gate, or the
> bar; the decision and reasoning are unchanged.

**Status**: accepted. Mirrors, for the working tree, the generated-artifact
currency check from [ADR 0034](0034-agents-md-untracked-currency-check.md);
relies on the post-fix timing of the plan/apply seam
([ADR 0027](0027-plan-apply-engine-execution.md)) and rides in the result
envelope from [ADR 0028](0028-result-envelope-and-diagnostics.md).

## Context

The `fix` stage runs first in `done` and is **meant** to mutate the tree — a
formatter, an import-sorter, a codemod. It auto-fixes and exits zero, so the
gate goes green. But `done` never checked what the fix stage left behind, and
the success tail said only "Everything built and all checks passed." Nothing
told the agent the working tree was now dirty.

That gap had teeth in the final lifecycle. The healthy order is _iterate on
uncommitted work → commit the intended final tree → run `done` on the clean HEAD
→ hand off or accept only when asked_. If the fix stage reformats a file the
agent already committed — the everyday case for `deno fmt`, which reflows
committed Markdown to 80 columns — that reformat lands uncommitted, and a plain
green `done` would tell the agent the branch is done even though the worktree is
no longer clean. Acceptance now refuses dirty worktrees
([ADR 0094](0094-final-lifecycle-checks-require-clean-trees.md)), but surfacing
the formatter diff at `done` is still the useful point of failure: the agent is
already looking at the gate result and can commit the fixer output deliberately.

Two facts framed the fix:

- **The whole committed tree already sits at the formatter's fixed point** (CI
  enforces it), so a whole-tree fixer on a clean checkout is a no-op. The fix
  stage can only dirty a file the agent committed in a non-canonical state — or
  was mid-editing. The first is the trap; the second is the normal inner loop
  and must stay silent.
- **CI already guards this**, with a `git diff --exit-code` after `done`. So the
  property is wanted; it was simply absent from the _local_ gate an agent
  actually runs. (Discern was extracted from a project whose only fixers were
  code formatters, which reformat the agent's active, uncommitted work — never a
  committed-then-finished doc — so the gap never surfaced there. Pointing
  `deno fmt` at hand-written prose docs is what exposed it.)

## Decision

**`done` blocks when the fix stage strands changes on a previously clean tracked
file**, detected by a before/after snapshot around the fix stage.

- **The signal is `D1 \ D0`.** Snapshot the set of tracked-dirty paths
  immediately before the fix stage (`D0`) and immediately after it (`D1`). The
  stranded set is the paths dirty in `D1` but not `D0` — files the fix stage
  dirtied that were **not** already dirty. A fixer reworking the agent's own
  uncommitted edits touches files already in `D0`, so the inner loop never
  trips; only a fixer touching a committed-clean file does. The comparison is by
  **path, not porcelain line**, so a file whose status code merely changes (a
  staged edit the fixer extends) is not mistaken for a fresh strand.
- **Tracked changes only.** The snapshots use `git status --untracked-files=no`
  — exactly what CI's `git diff --exit-code` sees. A fixer that emits a
  brand-new **untracked** file is **out of scope** by design: it shows plainly
  as `??` in `git status`, `git diff` ignores it too, and a codemod that creates
  a file (with a scope gate to validate it) is a legitimate, pre-existing
  pattern this must not break.
- **It is a final gate check, not a plan stage.** Like the guidance/skills
  currency checks and the merge check, it sets `failed_stage = "fix_drift"` and
  attaches a diagnostic rather than appearing as a job step. It runs **only when
  the gate is otherwise green** (every real stage passed); commit the fixer
  output before integrating `main`. (At the time of this ADR it ran just before
  the merge check; [ADR 0050](0050-merge-check-fail-fast.md) later moved that
  check to the front of the gate as a fail-fast precondition, so it now precedes
  this one.)
- **The diagnostic carries the rescue.** It lists the stranded files, embeds a
  capped `git diff` of them (so the agent sees the change is the fixer's own,
  usually trivial), and says to commit and re-run; `git diff` is its reproduce
  command.
- **It blocks; it does not auto-fix.** `done` neither commits nor stages the
  fixer output. A gate is not a committer: it surfaces the diff and lets the
  agent commit it.
- **No toggle.** A fix stage exists to produce changes you then commit; a green
  gate that hides uncommitted fixer output is the bug, so the check is core gate
  behaviour, not a feature.

## Consequences

- **A green local `done` now means a clean tree** (in tracked files), the same
  guarantee CI gave — so the bar discern advertises for "done" is finally true
  at the point an agent checks it.
- **The macrograph-era implicit discipline becomes enforced.** "The agent will
  have run the formatter before committing" held for code by habit and failed
  for prose; the check turns it into an invariant independent of content type or
  editing rhythm.
- **The surprise moves early and explained.** The agent commits the fixer output
  at `done` (with a diff in hand) instead of reaching a later dirty-tree
  refusal. It is the same one commit either way, but with the cause in view.
- **CI's `git diff --exit-code` becomes partly redundant but stays.** It still
  catches tracked mutations from _non-fix_ stages (a test that writes a tracked
  file), which this check, scoped to the fix stage, does not.
- **Two extra `git status` calls per `done`** (skipped when no fix stage is
  wired), plus one `git diff` only when a strand is found. Negligible, and the
  gate already shells to git for scope classification and the merge check.
- **A new `failed_stage` value, `fix_drift`,** joins the envelope. Consumers
  switch on it with a default already, so it flows through; the human headline
  and the diagnostic make it self-explanatory.
- **A fixer that emits a new untracked file can still leave the worktree
  dirty.** Accepted: that case is visible in `git status` and outside CI's diff
  guard too. Acceptance refuses it under ADR 0094; catching it in `done` remains
  a possible later extension.

## Alternatives considered

- **Advisory hint on a green result instead of blocking.** Rejected: agents key
  on `ok`, and a hint riding on a green gate is exactly what gets ignored today
  — that _is_ the current failure mode. `ok:false` with a diagnostic is the
  signal that reliably changes behaviour.
- **Exclude Markdown from `deno fmt` (project-level).** Rejected as the fix: it
  abandons automated doc formatting (which the prose check and standard
  complement, not replace) and leaves the engine gap — any mutating fixer, in
  any project, has the same trap. This is an engine fix, not a config
  workaround.
- **Block on any dirty tree after the fix stage.** Rejected: it would fire in
  the inner loop, where the agent's own uncommitted work is legitimately dirty
  and a fixer reformatting it is expected. The `D1 \ D0` set is the surgical
  signal that excludes exactly that case.
- **Block on untracked fixer output too.** Rejected for parity: CI's
  `git diff --exit-code` ignores untracked files, the timing-sensitive codemod
  pattern relies on creating them, and a new file is visible in `git status`
  where a silent reflow is not.
- **Auto-commit (or stage) the fixer output in the fix stage.** Rejected: a gate
  that silently commits surprises in the other direction, and folding formatter
  noise into the agent's commit without review is the opposite of surfacing it.
