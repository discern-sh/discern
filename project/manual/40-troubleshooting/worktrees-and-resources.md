---
id: troubleshoot-worktrees-and-resources
title: "Worktrees and resources"
description: "Recover a refused or interrupted worktree lifecycle, reclaim finished checkouts and reappeared paths, and diagnose resource and environment state."
order: 40
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-worktrees-and-resources"
  - "Reclaiming contained worktrees"
  - "contained worktree"
  - "worktree prune --contained"
  - "reclaim a worktree"
  - "spent train stage"
  - "Cleanup ownership and successful teardown"
  - "worktree cleanup ownership"
  - "verified teardown"
  - "branch cleanup"
  - "Reappeared worktree paths"
  - "reappeared worktree path"
  - "stale worktree files"
  - "files left after worktree removal"
  - "retired worktree path"
  - "precondition_failed"
  - "awaiting_consent"
  - "partial_acceptance"
  - "provisioned_resources"
  - "worktree disk usage"
redirect_from:
  - "/docs/worktrees/reclaiming-contained-worktrees"
  - "/docs/worktrees/cleanup-ownership"
  - "/docs/worktrees/reappeared-worktree-paths"
---

# Worktrees and resources

Parallel work multiplies the things that can look wrong: several checkouts, branches at different stages, provisioned resources, and lifecycle commands that refuse rather than guess. Almost every situation on this page shares one recovery shape: fix what the result names, then repeat the same discern command, which re-checks everything from the current state and converges. The risk worth respecting is improvised cleanup, because a recursive delete or a hand-removed Git entry can destroy work and evidence that a bounded retry would have preserved.

[Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) is the mental model behind these states; this page starts from what you can observe.

## A lifecycle command refuses

`discern start`, `discern update`, and `discern accept` check their preconditions first and refuse with the missing one named. Nothing has changed when you see this — the refusal is the command protecting the states it would otherwise have to guess about. The common ones:

- **The worktree has uncommitted changes.** Acceptance lands one exact commit, and discern never creates a work-in-progress commit for you. The agent commits the changes, or discards them as a decision of their own, then reruns.
- **The branch is behind the trunk.** The agent runs `discern update`, re-reads any overlapping files the result names, reruns `discern done`, and then returns to acceptance.
- **The main checkout is busy.** Acceptance moves the trunk _in the main checkout_, so it refuses while that checkout has uncommitted tracked changes or is parked on another branch. It won't move your work for you: commit or stash there, return the checkout to the trunk, and rerun. The worktree branch is untouched and keeps all its commits throughout.
- **Generated artifacts would change.** A pending refresh effect means the tree about to land isn't final. The agent runs `discern refresh`, commits the result, reruns `discern done`, then accepts.

One refusal is not a precondition problem: `discern accept` with green Proof but no verified authority changes nothing and re-serves the review moment. That's the design — landing is the owner's decision. [Proof](../20-understand/proof.md#who-supplies-what) explains the authority sources.

## Acceptance was interrupted partway

Acceptance is a sequence (fast-forward the trunk, record the Proof note, tear down the worktree), and an interruption can stop it after an irreversible step. The result reports how far it got. Read that state before acting on anything:

- **If the trunk already landed the commit,** the remaining work is only cleanup. Don't try to land it again.
- **Otherwise,** resolve the named failure, run `discern status` to see the current state, and rerun `discern accept`. It recognizes its own interrupted transaction and finishes it rather than starting over.

[Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) walks the full recovery, including resuming from a fresh session.

## Removal failed, or a removed path came back

Teardown succeeds only when discern verifies absence: Git no longer registers the worktree _and_ nothing exists at the path. When either check fails, the lifecycle fails visibly instead of reporting a success it can't prove.

**Removal reports a remaining path or registration.** Some program is still writing there (an editor, a file watcher, a shell session), or a Git worktree entry needs repair. The result names which. Stop that one writer, or repair that one entry, then repeat the same lifecycle command; it re-checks identity and the filesystem before continuing, so repeating is safe. Don't substitute a parent-directory delete or a repository-wide sweep — the containment and ownership checks inside the retry are the protection you'd be discarding.

**A removed worktree's directory exists again.** An external program that still had the checkout open can recreate the directory after removal — a save, a shutdown flush. Git no longer knows the path, but discern recorded the removal, so `discern status` reports the reappeared path with what it observed there. Review the plan, then reclaim it:

```sh
discern worktree prune --dry-run
```

Close the program that's writing into the path, then confirm the prune. It removes only paths backed by discern's own removal evidence (a neighboring directory it never removed stays outside the plan no matter how similar it looks), and it re-checks the record, Git's registrations, and the filesystem immediately before deleting. A path that contains Git metadata, can't be read, or changes mid-plan is kept for another run. Success is the path absent and status quiet; if it reappears again, the evidence remains and the same steps converge.

## A finished stage's checkout is taking space

When work composes in stages (a later worktree started from an earlier one's branch), the earlier checkouts remain after their content flows forward. discern calls such a worktree **contained** once its branch is fully part of a live later branch, its tree is clean, and it's idle. `discern worktree prune` and `discern status` point them out, and the [Desk](../10-guides/delegate-work.md) offers the reclaim.

Reclaiming is confirmation-only: no configuration, grant, or hint reclaims a checkout unattended, because the reclaim destroys the checkout and its worktree-local state — including its Gate Proof. After a reclaim, a `discern await --green` watch on that stage refuses and points at the containing branch instead, which is where the work now lives. The branch ref itself survives as the recovery path (`discern start --from <branch>`), and ordinary pruning offers to remove it only after the composed work lands.

If disk pressure is the actual symptom: land finished work with `discern accept` (which removes its worktree), then review `discern worktree prune --dry-run` for the rest.

## Cleanup kept something you expected it to remove

Automatic cleanup requires positive evidence that discern created the thing for this project — recorded identity in the worktree's own Git metadata, with a matching branch name. A branch that is merely merged, prefix-shaped, or similarly named grants nothing, and prune keeps it while showing it as context. That's not a fault; it's the boundary that keeps cleanup from ever deleting a checkout discern doesn't own.

For a foreign checkout you've judged yourself, `discern worktree drop <id|path>` removes the checkout you name — and still keeps its branch when discern can't prove ownership, so the commits stay recoverable.

## A branch or worktree was dropped by mistake

`discern worktree drop` prints a recovery ref before removing a branch, and discern retains those refs so a drop is reversible. [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) has the listing and restore commands and the retention bounds. For refs lost outside discern's lifecycle, `git reflog` is the general tool — and `discern doctor` warns ahead of time when reflog retention is configured below what recovery needs.

## A resource, port, or environment value is wrong

Each worktree gets its own identity (a stable id, a port, a database-safe name) plus whatever external resources the project declares (`[worktree.resources.<name>]`: a database, a container, anything with create/destroy commands). When an app in one worktree reads another's data, or a service won't start, the first check is what this worktree believes about itself:

```sh
discern identity
discern identity --resource <name>
```

- **A resource failed to provision.** Worktree setup reports the failing command's output. Fix the command or the environment it needs, then rerun the same lifecycle step — resource creation converges, and bounded retries are built in.
- **Environment values didn't arrive.** Only variables named in `[worktree.inherit_env]` are passed through, and only files listed in `[worktree.env_files]` are copied into a new worktree. A value set in the main checkout after the worktree was created isn't retroactively copied. The [worktrees and status reference](../30-reference/worktrees-and-status.md) has the exact identity and environment contract.
- **An orphaned resource lingers after a crash.** The resource ledger survives worktree removal precisely so garbage collection can find and destroy what a vanished worktree left behind — it acts only on resources discern recorded creating. `discern uninstall` refuses while provisioned resources remain, so nothing external is left orphaned on the way out.

## Ignored files changed under a worktree

Git can't see edits to ignored files, so discern records a baseline when it prepares a worktree and compares it again before the worktree is removed. A report of ignored-file changes at acceptance is your chance to review state that exists nowhere else (a locally edited `.env`, generated local data) before teardown destroys it. Copy out what matters; the report lists changes rather than blocking on them. Set `[worktree].ignored_file_drift = false` if the project doesn't want the check.

## A fleet row looks wrong

`discern status` from the main checkout surveys every worktree. A row it reports as unreadable, broken, or long-idle names its own next step — often repairing one Git entry or deciding the effort is abandoned. These rules keep the fleet safe while you tidy: never adopt another effort's worktree because it looks idle or clean, and never resolve a confusing row by deleting things Git still registers — route it through `discern worktree drop` or prune, where ownership and absence are verified.

## When to stop

Reclaims, prunes, and drops are owner-confirmed for a reason: each destroys state that can't be regenerated (a checkout, per-worktree Proof, ignored-only files). Stop at the confirmation when you're acting on someone else's effort, when the path in question holds work you can't account for, or when the same removal fails twice with the same writer named — at that point the other program is the blocker. And nothing on this page ever requires deleting `.git` contents by hand; if that seems like the only way forward, capture `discern status --json` and treat it as a defect to report.
