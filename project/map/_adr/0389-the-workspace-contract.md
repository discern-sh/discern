# ADR 0389: The workspace contract — a checkout changes only under its own operation

**Status**: accepted on 2026-09-12. Supersedes [ADR 0377](_superseded/0377-execution-environments-declare-reuse-and-recovery.md). Amends [ADR 0374](0374-complete-proof-is-independent-of-measurement-scheduling.md), [ADR 0375](0375-source-authority-survives-declared-composition.md), [ADR 0376](0376-active-commands-advance-an-authorized-landing-queue.md), and [ADR 0378](0378-landing-completion-survives-checkout-retirement.md). Restores the landing behavior of [ADR 0110](0110-the-landing-model.md) and the effort grant of [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md).

## Context

A worktree is a temporary, isolated copy of the project. `discern start` creates it, the project's `[worktree]` setup provisions it, and discern removes it after its change lands. That contract predates every landing-queue decision and every agent instruction discern ships assumes it: an agent keeps one worktree for an effort, never adopts another effort's checkout, and expects the checkout it left to be the checkout it returns to.

Between September 4 and September 11, 2026, the completion programme built early validation on a different substrate. Under ADR 0377 a green `done` released the agent's worktree, acceptance installed a composed candidate into it, ran the checks there, captured every file the candidate changed, including ignored build outputs, so the checkout could be put back exactly, and restored it. Everything the owner could not explain afterwards followed from that one choice: the release and retain flags on `done`, the queue controls and reconciliation on `accept`, reservations and capacity settings, environment declarations and the setup probe that proved them, recovery of interrupted returns, reclamation of captured bytes, and the rebinding of a desk grant to one exact commit. The captures alone held about 48 GB in this repository's Git administration directory. The declaration was never proved after setup changed here and is off by default everywhere else, so the machinery was inert cost.

The owner reviewed the programme on 2026-09-11 and 2026-09-12. The first decision, complete Proof on every `done`, is right and stays. The second, a landing queue, is on the roadmap but never needed to borrow a checkout: a moved trunk can be composed and checked in a disposable integration worktree that discern creates for that landing and removes afterwards. Early validation is one dependency chain, and removing its top link, the installation of a foreign commit into an authoring worktree, leaves the rest of the chain with no reason to exist.

## Decision

**An operation changes the checked-out revision, index, or working tree of a checkout only under one of three allowances.**

1. **The invoked checkout.** An operation may change the checkout it was invoked in. Ordinary checks in a worktree, in the main checkout, and in CI run here, as do `update`, setup, a standard pin, and the rollback of a discern-authored commit.
2. **A worktree discern created.** `start` and the setup viability probe create worktrees discern owns; `accept`, `drop`, `park`, and a confirmed `prune` remove worktrees registered to the repository. A landing that must compose a moved trunk creates an integration worktree for that one operation and removes it when the operation ends.
3. **The main checkout, converged by a landing.** A landing advances the trunk under one compare-and-swap and converges the main checkout to the trunk it advanced.

No operation installs another revision into an authoring worktree. No checkout is borrowed, released, retained, captured, restored, or reclaimed. A checkout's cleanliness or idleness never makes it available to another operation.

**The landing model returns to its recorded shape, with one addition.** `done` proves the committed tip of the invoked checkout against every configured check and standard and records complete Proof for that exact commit. `accept` lands one submitted, proven commit: it writes a small durable submission record naming the effort, its branch, and the exact revision, stored beside the effort grant in Git administration state so no branch can forge it; it fast-forwards the trunk under the acceptance transaction; it records the Proof note; it converges the main checkout; it tears down the effort's resources; and it removes the checkout and deletes the branch when the branch holds nothing beyond the landed submission. A later `accept` from the same effort replaces its submission, a landing consumes it, and dropping the worktree removes it. The landing queue is a derived view over submissions: each submission with honored Proof that has not landed, pre-authorized ones first. A green run its agent never submitted is absent from the queue and lands only by the owner's explicit act.

**The desk's grant binds to the effort.** "Pre-authorize landing once green" allows a named branch to land once green without a further conversation. Any later green `done` on that branch is covered once its agent submits it. The grant is consumed by the landing, revocable from the desk, dies with the worktree, and never covers a checkpoint variance, a standard proposal, or an emergency. Exactness comes from the submission, not from binding the grant to one commit.

**When the trunk moves after Proof, `accept` refuses** and names the route: `discern update`, `discern done`, then `discern accept`. Landing a moved trunk through an integration worktree is a separate decision; until it lands, the refusal stands.

**The guard is structural.** Every argument list in authored TypeScript outside test harnesses that hands a Git runner one of `checkout`, `switch`, `reset`, `read-tree`, `restore`, `clean`, `worktree add`, or `worktree remove` is one registered row naming its allowance and a one-line reason. An unregistered invocation and a stale row both fail the guard, which runs in the canary, and the falling `checkout_mutation_boundaries` Standard holds the registered population so a new site needs a conscious allowance. Ordinary authoring commands such as `merge` and `commit` stay outside the predicate: they advance the invoked checkout's own history and cannot install a foreign revision.

The explicit *no*s:

- **No migration and no compatibility reader.** discern launches at schema version 1. The retired record families, the environment registry, the queue ledger, the capture store, and the pre-launch shapes of the Proof note payload, the completion record, and the effort grant have no reader. Installations that carry them are cleaned by hand.
- **No borrowed pool and no isolated pool.** A reusable environment carries state between candidates whatever its ownership; the disposable integration worktree is the shape that needs no return journey.
- **No early validation against unlanded work.** If it ever returns, it composes in another integration worktree and discards that worktree when its predecessor changes.

## Consequences

- The public surface shrinks to what the owner can explain in one sentence per flag: `done` keeps its diagnostic, rerun, CI, checkpoint, and policy-base options; `accept` keeps its preview, target, consent, variance, standard-approval, and emergency options.
- `.git/discern` no longer grows with captures; this repository's store falls from about 50 GB to a few megabytes once the retired stores are removed.
- An effort whose trunk moved after its Proof runs `update` and `done` again before it can land, until the integration-worktree landing exists. Parallel efforts pay a gate per landing they fall behind; the queue no longer reduces that cost.
- The owner can pre-authorize a task at the desk and go to sleep: the agent's later green `done` and its own `accept` land the task. The widening from one commit to one branch is bounded by the submission an agent must make.
- Proof notes written by this repository's pre-launch engines in September 2026 may no longer read; the Git history, the notes, and the logbook are kept as evidence.
- A change that adds a checkout-changing Git invocation fails the gate until it is registered under an allowance, and raising the ceiling needs a standard proposal.

## Alternatives considered

- **Keep borrowing behind a proved declaration.** Rejected: a proof of restoration is a claim about ignored state and running processes that a project cannot make in general, and the measured cost was the capture store and a test-stage median that rose from 2.5 to 17.2 minutes across the programme.
- **Bind the desk grant to one exact commit.** Rejected: it made "pre-authorize and step away" impossible, since every review fix needed another visit to the desk. The submission record supplies the exactness a landing needs without binding the owner's decision to a commit the agent has not made yet.
- **Compose a moved trunk in the agent's worktree.** Rejected: it installs a revision the agent did not author into the checkout the agent is working in, which is the contract's one prohibition.
