# ADR 0081: `discern setup accept`, a main-checkout landing command for the finished setup

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md)):** current spellings are `accept` (formerly `graduate`), `discern`, the gate, or the bar for the retired product-category wording, and the trunk for the shared-branch label; the decision and reasoning are unchanged.
> - **[ADR 0153](0153-repository-owns-shared-checkout-convergence.md) — trunk configuration:** the configured trunk now lives at `[repository].trunk`, and the per-invocation environment override (`DISCERN_MAIN_BRANCH` below, originally `MAIN_BRANCH`) is now `DISCERN_TRUNK` — `src/shared/environment_variables.ts` is the live authority.
> - **[ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md) — evidence and merge rule:** setup acceptance requires complete current Gate Proof and full worktree cleanliness. A moved trunk is merged into the setup branch and the merge commit is proved before an exact trunk transition; successful landing records the standard Proof note and converges local agent artifacts.

**Status**: accepted

## Context

A fresh `discern setup` isolates its several commits on a dedicated `discern-setup` branch (ADR 0065), and the engine commits its own machinery there (ADR 0076). After `setup done`, discern therefore exists on `discern-setup` — often many commits ahead of `main` — and **not** on the trunk. The completion output explained the MCP/hooks reactivation handoff (ADR 0075) but never said the work was on `discern-setup` and not yet on `main`. A clean-room run flagged this as the single largest setup UX gap: a novice (or their agent) could restart, switch to `main`, and appear to have "lost" discern entirely — the config, the docs, the wiring, all seemingly gone.

discern already lands a linked **worktree's** branch with `discern accept` (ADR 0046/0067): it fast-forwards the trunk to the branch tip, deletes the merged branch, and tears the worktree down. But `accept` asserts it is run from inside a linked worktree and refuses on the main repo — and setup runs on the **main checkout**, not a worktree. So the existing landing machinery cannot land a finished setup, and a novice was left to reconstruct `git checkout main && git merge discern-setup` by hand at exactly the moment they understand git the least.

We want a deterministic, low-risk way to land setup that mirrors `accept`'s safety (clean-tree precondition, fast-forward when possible, refuse on conflict) without its worktree teardown, and a completion output that names where the work lives and the exact command to land it.

## Decision

Add **`discern setup accept`** — the main-checkout counterpart to `discern accept`. It fast-forwards the current setup branch onto the trunk (`DISCERN_MAIN_BRANCH` / `[project].main_branch`), or merges it when the trunk has advanced, then deletes the merged branch — leaving the user on the trunk with discern in place. It supports `--dry-run` (preview, touch nothing) and `--json`, and returns the standard result envelope (verb `setup accept`).

It is **not** a reuse of `accept`: the two share a land-onto-trunk _shape_ but differ in scope. `accept` removes the clean worktree it ran in and tears down that worktree's resources; `setup accept` has no worktree to tear down and refuses a dirty setup branch rather than sweeping changes into the merge. "Dirty" is the same notion setup itself uses to gate branch creation (`worktreeState` — uncommitted _tracked_ changes; untracked scratch files are ignored). On a merge conflict it steps the conflict aside (`git merge --abort`) and refuses, leaving the branch intact. It is a clean no-op when already on the trunk or outside a git repo.

The three choices a user has — **merge into `main`**, **leave the branch for review**, or **abort** — are not three flags. The command _is_ the merge action; "leave for review" and "abort" are simply _not running it_ (the branch keeps every commit, so doing nothing is always safe). `discern setup done` spells out all three in prose and names the exact land command, so the choice is presented even though only one of them is a command.

The sub-verb joins the `SETUP_SUBVERBS` single source of truth, tied to its CLI registration by the setup-phase parity forcing function (ADR 0051).

## Consequences

- The largest setup UX gap closes. `setup done` now states plainly that the work lives on `discern-setup`, not yet on `main`, and that switching branches would _look_ like discern vanished — then gives one command to land it. Landing is a deterministic, reflog-reversible, purely-local git operation.
- A new public sub-verb to maintain and document. Because it is in `SETUP_SUBVERBS`, a future edit can't register it without the SSOT (or vice-versa) without failing the gate.
- A little of `accept`'s land shape is duplicated (checkout + fast-forward-or-merge + delete). We accept that over contorting `accept`'s worktree-scoped flow to also serve the main checkout: the preconditions diverge (worktree teardown/resources vs none, different dirty-tree scopes), so a shared abstraction would be mostly conditionals.
- The command mutates the user's trunk locally. The risk is bounded: it refuses on a dirty tree or a conflict, fast-forwards where possible (no merge commit), and on any refusal the branch keeps all its commits and the user stays put.

## Alternatives considered

- **Reuse `discern accept`.** Rejected: it is worktree-scoped and refuses on the main repo, where setup runs. Teaching it to also land the main checkout would fork its preconditions down the middle for no real saving.
- **Output-only — print the git commands, ship no command.** This is the brief's stated minimum, and `setup done` does name where the work lives. But a deterministic command is far lower-friction for a novice and their agent than hand-assembled git, and gives the completion output something concrete to point at. We do both: the output names the work _and_ the command.
- **A general "land any branch onto `main`" verb.** Rejected as scope creep. `setup accept` is intentionally framed around the post-setup flow (its messaging, its home under `setup`), even though it operates on whatever branch is currently checked out.
