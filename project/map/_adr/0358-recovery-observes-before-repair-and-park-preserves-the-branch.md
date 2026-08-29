# ADR 0358: Recovery observes before repair and Park preserves the branch

**Status**: accepted. Extends the plan/apply boundary from [ADR 0027](0027-plan-apply-engine-execution.md), the Desk action authority from [ADR 0353](0353-desk-actions-are-registry-facts-reviewed-before-effects.md), interrupted setup recovery from [ADR 0332](0332-worktree-setup-steps-preserve-interruption-ambiguity.md), and task metadata lifetime from [ADR 0356](0356-task-metadata-follows-the-worktree-identity.md).

## Context

A registered checkout can retain several useful facts after Git status or setup becomes unreadable. Git's registration can still name the path, branch, commit, lock, and prune state. The filesystem can still establish presence. The setup marker and step journal can establish whether an automatic retry is safe. Resource and task records can remain readable. Treating the whole task as a single broken boolean discards that evidence and makes deletion appear to be the only lifecycle path.

A healthy task can also outlive its need for a checkout. Removing that checkout through Drop deletes the branch, while contained Reclaim retains a branch because another live branch carries its commits. Neither operation represents an ordinary paused task whose branch and human wording must remain available for later work.

## Decision

Fleet status records recovery evidence as independent typed observations. A non-main row can carry:

- Git registration, branch reachability, and filesystem presence;
- the exact Git command and diagnostic when checkout-local Git state is unavailable;
- setup-ready marker state, the setup-step journal, and a classified repair command;
- recorded resource identities, task metadata, recent lifecycle evidence, landing authority, and Proof inspection.

Missing facts stay absent or explicitly unavailable. Unreadable Git never supplies clean or divergence values. A configured checkout without a setup-ready marker is an incomplete setup, even when Git reports a clean tree.

The Desk recommends read-only recovery detail for every broken, setup-incomplete, or Git-unreadable row. The detail composes Diagnostic, RetryNotice, and ResultSummary Components from the observed status facts. Ordinary task actions stay unavailable until their required evidence is restored. Drop remains a separate destructive action and never becomes the recommendation for a degraded row.

Automatic `Retry setup` is available only when the existing setup core can resume without guessing about a one-shot effect. A missing journal is safe to retry when the configuration declares no one-shot setup commands. A recorded journal is safe to retry when no step remains `running`; completed step identities remain skipped by the setup core. A missing journal beside declared one-shot commands, a running step, an unreadable journal, or unreadable identity evidence supplies the specific manual or doctor command instead. The Desk previews the same setup plan and the apply boundary checks current state again.

`discern worktree park <target>` is the branch-preserving checkout-removal operation. Its read-only plan requires a named non-trunk branch, a clean readable checkout, completed setup, matching Git registration and branch tip, readable task metadata, and a reviewable resource ledger. It has no force path.

Park writes a versioned common-Git-directory record keyed by branch before cleanup. That record retains the task id, branch, commit, Park time, title, optional brief, and creation source. Apply then destroys the reviewed resource set and removes the checkout. Git removes worktree-scoped Proof, grant, task metadata, and other checkout-local records with the registration. The branch and committed work remain. Status joins the Park record to the existing unlanded-branch population, and `start --from <parked-branch>` uses its wording as defaults when the recorded commit still matches. A successful resume consumes the Park record.

Park rebuilds its plan immediately before cleanup and checks checkout identity, branch tip, cleanliness, and the post-teardown ledger again before removal. A resource failure or changed task keeps the checkout and branch. Successful resource teardown can therefore be followed by a refusal; the result names `discern worktree setup` as the convergence path before another Park attempt.

Reclaim keeps its containment predicate and retained branch. Drop keeps its recovery-ref transaction, force boundary, and branch confirmation. Their consequence accounts remain separate from Park.

Recent completed tasks derive from the bounded local successful-accept Logbook tail and the latest landed Proof note. This view is read-only evidence, not a task archive.

## Consequences

- Recovery can state which command failed, which identities remain verified, and which next command is safe without converting unknown state into clean state.
- A setup-ready marker is positive lifecycle evidence. Hand-created and half-created worktrees stay in recovery until setup establishes it.
- Park removes disk and resource occupancy while preserving committed branch work and person-authored task wording.
- Park intentionally consumes worktree-scoped Proof and landing authority. Resumed work receives a new checkout identity and must establish current Proof and authority through the normal lifecycle.
- The common Park record is operational metadata for resumable branches. It disappears after a successful resume and does not travel through Git branch transport.
- A changed fleet can move a selected row to its resumable branch or recent completion evidence after refresh. An unexplained disappearance remains an explicit changed-task result.

## Alternatives considered

- **Keep Drop as the primary broken-task action.** Rejected because it makes diagnosis and preservation secondary to deletion and cannot explain which evidence is still available.
- **Retry every setup with a missing ready marker.** Rejected because an interrupted one-shot command may have changed external state before its completion record was written.
- **Add a Park force option.** Rejected because branch retention does not preserve uncommitted files, and unreadable cleanliness cannot establish what the checkout alone contains.
- **Store parked wording on the branch.** Rejected because task presentation would enter project history and create commits or conflicts unrelated to the work.
- **Reuse Reclaim for every branch-preserving removal.** Rejected because Reclaim safety and self-cleanup behavior derive from strict containment in another live branch.
- **Create a completion database.** Rejected because the Logbook and landed Proof note already provide bounded local evidence for the distinction between landed and unexplained removal.
