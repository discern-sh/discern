# ADR 0055: `discern integrate` — the third verb in the worktree lifecycle, bundling merge with re-materialize

**Status**: accepted; completes the worktree lifecycle alongside
[ADR 0011](0011-adopt-worktree-workflow.md), resolves the fail-fast merge check
of [ADR 0050](0050-merge-check-fail-fast.md), and respects the no-auto-heal
boundary of [ADR 0034](0034-agents-md-untracked-currency-check.md).

## Context

discern wraps both _ends_ of a worktree's life in deterministic verbs:
**create** (the `worktree:create` hook adds the worktree, then materializes the
agent files + skills) and **`graduate`** (hands the branch back to the main
checkout). The middle transition — _bring the latest main into this branch_ —
had no verb. It was left to a raw `git merge main`, which the guidance and the
gate both pointed at.

That raw merge is exactly where re-materialization gets forgotten. The generated
agent files (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) and the materialized
`.claude/skills/` are build artifacts compiled from `[guidance].sources` and
`[skills].dir` ([ADR 0034](0034-agents-md-untracked-currency-check.md)). When a
merge pulls in another line of work's edits to those sources, the generated
files go stale — and the agent only finds out at the _end_ of a full
`discern finish` run, where the currency check fails and tells it to run
`discern refresh` and finish again. The merge step and the refresh step belong
together, but nothing tied them.

[ADR 0050](0050-merge-check-fail-fast.md) sharpened the cost. `finish` now
checks "is this branch behind main?" first and fail-fast, so an agent behind
main is told to integrate immediately. But the thing it was told to do was still
a two-step manual dance (`git merge`, then remember to `discern refresh`). 0050
explicitly **rejected** auto-integrating _inside_ `finish` — that would make a
pure check verb mutate the branch and could throw merge conflicts mid-gate,
breaking the `finish`-is-a-check / `graduate`-is-the-mutation split. The gap it
left open is the one this ADR fills: a _separate_, deterministic verb that does
the integrate + refresh, which the merge check points at.

## Decision

**Add `discern integrate` (MCP tool `discern_integrate`) — a first-class
worktree verb that merges the integration branch into the current worktree's
branch and re-materializes the agent files + skills in one deterministic step.**
It is the inverse of `graduate`: where graduate hands the branch _out_ to main,
integrate brings main _in_.

It is modelled structurally on `graduate` and runs from inside a linked worktree
only:

- **Already up to date** → a no-op success ("Already up to date with `main`");
  nothing merged, so nothing refreshed.
- **Behind, clean tree** → `git merge` (a fast-forward or a merge commit), then
  `compileGuidelines` re-materializes the agent files + skills. Returns the
  merge + refresh steps and a hint.
- **Dirty tree** → refuses (`error: "precondition_failed"`): integrate merges
  into a clean tree only. Deterministic, mirroring graduate's "commit first"
  model.
- **Merge conflict** → aborts the merge (`git merge --abort`, restoring the
  clean pre-merge tree), then refuses, naming the conflicted files and the
  manual path to resolve them. Conflicts need judgment; integrate steps aside
  cleanly rather than leaving a half-merge.

`--dry-run` previews the plan (behind by N; would merge + re-materialize) and
touches nothing. The git mechanics live in a pure `integrateMain` primitive in
`worktree/git.ts` (funnelled through the shared `runGit`,
[ADR 0054](0054-subprocess-single-source.md)); the orchestration and the
re-materialize live in `worktree/lifecycle.ts`, with the CLI `--json` and the
MCP tool both rendering the one `integrateResult` core — the result-spine parity
of [ADR 0028](0028-result-envelope-and-diagnostics.md).

**The refresh is the core of the verb, not an optional add-on.** Bundling it is
the whole reason integrate exists rather than a documented `git merge`: the
merge and the re-materialize are one logical operation, so making them one verb
is what stops the staleness.

**Why this respects [ADR 0034](0034-agents-md-untracked-currency-check.md).**
0034 rejected auto-healing the generated files _in the fix stage_, because
silently regenerating would erase a deliberate hand-edit before anyone saw it.
That objection does **not** apply here. A post-merge re-materialize has no
hand-edit to erase: it reconciles the generated artifacts after a _known
upstream integration the agent just asked for_, exactly like the create-time
refresh 0034 already endorses. The currency check stays the gate's authority on
stale artifacts; integrate simply keeps them from going stale across the one
operation that most reliably staled them.

**Scope held to v1.** Re-running the worktree's idempotent
`[worktree.setup].steps` after a merge, and reordering `finish`'s currency
checks to fail-fast, are deliberately **out of scope** here — each a separate,
later change. The merge + refresh bundling is the irreducible core.

Adding the verb followed the canonical-set discipline of
[ADR 0051](0051-canonical-set-parity.md): it was taught to every satellite of
the verb vocabulary (the engine-verb SSOT, the recipe-name list, the Cliffy
registration, the MCP tool table, the per-verb feature gate, the bootstrap gate)
with **no exception-set edits** — `integrate` is an ordinary worktree verb that
has an MCP tool, so the forcing-function test went green by completing the
satellites, not by weakening it.

## Consequences

- **The lifecycle is symmetric.** create → **integrate** → graduate are all
  deterministic verbs now; the only manual git in the common loop —
  `git merge
  main` — is replaced by a verb that also refreshes.
- **The merge check resolves in one step.** `finish` (behind main, fail-fast)
  and `graduate` (refuses a behind branch) both now point at
  `discern integrate`, which brings main in _and_ re-materializes — so the
  follow-up `finish` passes with no separate `discern refresh` and no second
  failure.
- **`finish` stays a pure check.** The auto-integrate 0050 rejected inside
  `finish` lives here instead, as an explicit, separately-invoked verb — the
  mutation stays out of the gate, and a conflict surfaces in integrate (where
  the agent expects to resolve it), never mid-gate.
- **Idempotent and safe to over-call.** A no-op when already up to date, a clean
  refusal when dirty or conflicting; the MCP tool advertises
  `idempotentHint: true, destructiveHint: false`. The guidance tells agents to
  just call it rather than pre-flighting preconditions with `git`.
- **One more verb to carry.** The MCP tool table, the guidance, and the docs
  each gained an integrate entry; the parity test holds them in step so none can
  drift.
- **The re-materialize can fail without losing the merge.** If
  `compileGuidelines` throws after a successful merge, integrate records the
  refresh step as `failed` but keeps the merge — the gate's currency check is
  the backstop. Losing the merge over a refresh hiccup would be the worse
  failure.

## Alternatives considered

- **Document `git merge main` + `discern refresh` and add no verb.** Rejected —
  this is the status quo whose two-step nature is the bug. The steps are one
  logical operation; leaving them separate is what lets the refresh be
  forgotten, which the gate then catches late and slowly.
- **Auto-integrate inside `finish`** (merge when behind and clean, then gate the
  merged tree). Rejected by [ADR 0050](0050-merge-check-fail-fast.md) and not
  revisited: it makes a pure check verb mutate and can throw conflicts mid-gate.
  A separate verb captures the win with none of the surprise.
- **Auto-heal generated files in the fix stage instead.** Rejected by
  [ADR 0034](0034-agents-md-untracked-currency-check.md): in the fix stage a
  regenerate could erase a deliberate hand-edit. integrate is the right home for
  the refresh because, post-merge, there is no hand-edit to erase.
- **Resolve conflicts for the agent** (e.g. a merge strategy, or leaving the
  half-merge in place to fix). Rejected for v1 — conflicts need judgment.
  integrate aborts to a clean tree and hands back the conflicted files, so the
  agent resolves them deliberately with a normal `git merge`.
