# ADR 0055: `discern integrate` — the third verb in the worktree lifecycle, bundling merge with re-materialize

**Status**: accepted. Completes the worktree lifecycle alongside
[ADR 0011](0011-adopt-worktree-workflow.md), resolves the fail-fast merge check
of [ADR 0050](0050-merge-check-fail-fast.md), and respects the no-auto-heal
boundary of [ADR 0034](0034-agents-md-untracked-currency-check.md).

## Context

discern wraps both _ends_ of a worktree's life in deterministic verbs.
**create** (the `worktree create` hook) adds the worktree, then materializes the
agent files and skills. **`graduate`** hands the branch back to the main
checkout. The middle transition — _bring the latest main into this branch_ — had
no verb. A raw `git merge main` carried it, and the guidance and the gate both
pointed there.

That raw merge is where re-materialization gets forgotten. The generated agent
files (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) and the materialized
`.claude/skills/` are build artifacts, compiled from `[guidance].sources` and
`[skills].dir` ([ADR 0034](0034-agents-md-untracked-currency-check.md)). A merge
pulls in another line of work's edits to those sources, and the generated files
go stale. The agent finds out only at the _end_ of a full `discern finish` run:
the currency check fails there and sends it back to `discern refresh` and
another finish. The merge and the refresh belong together, but nothing tied
them.

[ADR 0050](0050-merge-check-fail-fast.md) sharpened the cost. `finish` checks
"is this branch behind main?" first, fail-fast. An agent behind main learns to
integrate at once. The remedy it points to is still a two-step manual dance:
`git merge`, then remember `discern refresh`. 0050 **rejected** auto-integrating
_inside_ `finish`: that would make a pure check verb mutate the branch, and
could throw merge conflicts mid-gate. It would break the `finish`-is-a-check /
`graduate`-is-the-mutation split. This ADR fills the gap that left: one
_separate_, deterministic verb for the integrate + refresh, which the merge
check points at.

## Decision

**Add `discern integrate` (the tool `discern_integrate`): a first-class worktree
verb that merges the integration branch into the current worktree branch and
re-materializes the agent files + skills in one step.** It inverts `graduate` —
graduate hands the branch _out_ to main, integrate brings main _in_.

It follows graduate's structure and runs from inside a linked worktree only:

- **Already up to date** → a no-op success ("Already up to date with `main`"):
  nothing merged, so nothing refreshed.
- **Behind, clean tree** → `git merge` (a fast-forward or a merge commit), then
  `compileGuidelines` re-materializes the agent files + skills. The result
  carries the merge + refresh steps and a hint.
- **Dirty tree** → it refuses (`error: "precondition_failed"`): integrate merges
  into a clean tree only, mirroring graduate's "commit first" model.
- **Merge conflict** → it aborts the merge (`git merge --abort` restores the
  clean pre-merge tree), then refuses, naming the conflicted files and the
  manual path to resolve them. Conflicts need judgment, so integrate steps aside
  rather than leave a half-merge.

`--dry-run` previews the plan (behind by N, would merge + re-materialize) and
touches nothing. The git mechanics live in a pure `integrateMain` primitive in
`worktree/git.ts`, funnelled through the shared `runGit`
([ADR 0054](0054-subprocess-single-source.md)). The orchestration and the
re-materialize live in `worktree/lifecycle.ts`. The CLI `--json` and the tool
both render one `integrateResult` core — the result-spine parity of
[ADR 0028](0028-result-envelope-and-diagnostics.md).

**The refresh is the core of the verb, not an add-on.** Bundling it is the whole
reason integrate exists rather than a documented `git merge`. The merge and the
re-materialize are one logical operation, so one verb performs both — and the
staleness stops.

**Why this respects [ADR 0034](0034-agents-md-untracked-currency-check.md).**
0034 rejected auto-healing the generated files _in the fix stage_: a regenerate
there erases a deliberate hand-edit before anyone sees it. That objection does
**not** apply here. A post-merge re-materialize has no hand-edit to erase. It
reconciles the generated artifacts after a known upstream integration the agent
just asked for — exactly the create-time refresh 0034 already endorses. The
currency check stays the gate's authority on stale artifacts. integrate just
keeps them current across the one operation that most reliably staled them.

**Scope held to v1.** Two follow-ups stay **out of scope** here, each a separate
later change. One re-runs the worktree's setup after a merge — realized by
[ADR 0059](0059-worktree-setup-ensure.md) as the convergent
`[worktree.setup].ensure` bucket (not a blind re-run of the one-shot `steps`).
The other moves `finish`'s currency checks to a fail-fast precondition. Bundling
the merge with the refresh is the irreducible core.

Adding the verb followed the canonical-set discipline of
[ADR 0051](0051-canonical-set-parity.md). Every satellite of the verb vocabulary
learned about it: the engine-verb source of truth, the recipe-name list, the
Cliffy registration, the tool table, the per-verb feature gate, the bootstrap
gate. None needed an **exception-set edit**. `integrate` is an ordinary worktree
verb that has a tool, so the forcing-function test went green once every
satellite was in place, not by weakening it.

## Consequences

- **The lifecycle is symmetric.** create → **integrate** → graduate are all
  deterministic verbs. A verb that also refreshes now replaces the one piece of
  manual git in the common loop, `git merge main`.
- **The merge check resolves in one step.** `finish` (behind main, fail-fast)
  and `graduate` (it refuses a behind branch) both point at `discern integrate`.
  It brings main in _and_ re-materializes, so the follow-up `finish` passes — no
  separate `discern refresh`, no second failure.
- **`finish` stays a pure check.** The auto-integrate 0050 rejected inside
  `finish` lives here instead, as an explicit verb invoked on its own. The
  mutation stays out of the gate, and a conflict surfaces in integrate — where
  the agent expects to resolve it — never mid-gate.
- **Idempotent and safe to over-call.** A no-op when already up to date, a clean
  refusal when dirty or conflicting. The tool advertises
  `idempotentHint: true,
  destructiveHint: false`. The guidance tells agents to
  just call it rather than pre-flight preconditions with `git`.
- **One more verb to carry.** The tool table, the guidance, and the docs each
  gained an integrate entry. The parity test holds them in step, so none drifts.
- **A refresh can fail without losing the merge.** If `compileGuidelines` throws
  after a successful merge, integrate records the refresh step as `failed` and
  keeps the merge. The gate's currency check is the backstop. Losing the merge
  over a refresh hiccup is the worse failure.

## Alternatives considered

- **Document `git merge main` + `discern refresh`, add no verb.** Rejected — the
  status quo, whose two-step nature is the bug. The steps are one logical
  operation. Leaving them apart is what lets an agent forget the refresh, which
  the gate then catches late and slow.
- **Auto-integrate inside `finish`** (merge when behind and clean, then gate the
  merged tree). Rejected by [ADR 0050](0050-merge-check-fail-fast.md): it makes
  a pure check verb mutate, and can throw conflicts mid-gate. A separate verb
  wins the same ground with none of the surprise.
- **Auto-heal generated files in the fix stage.** Rejected by
  [ADR 0034](0034-agents-md-untracked-currency-check.md): in the fix stage a
  regenerate erases a deliberate hand-edit. integrate is the right home for the
  refresh — post-merge, there is no hand-edit to erase.
- **Resolve conflicts for the agent** (a merge strategy, or leaving the
  half-merge in place to fix). Rejected for v1 — conflicts need judgment.
  integrate aborts to a clean tree and hands back the conflicted files, so the
  agent resolves them with a normal `git merge`.
