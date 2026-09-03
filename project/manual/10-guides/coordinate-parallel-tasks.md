---
id: guide-coordinate-parallel-tasks
title: "Coordinate parallel tasks"
description: "Start, inspect, compose, open, and resource parallel work without treating separate checkouts as separate products."
order: 60
publish: true
kind: guide
aliases:
  - "guide-coordinate-parallel-tasks"
  - "The fleet test-run cap"
  - "concurrent_test_runs"
  - "test slots"
  - "fleet test-run cap"
  - "Per-worktree resources"
  - "worktree resources"
  - "resource lifecycle"
  - "resource garbage collection"
  - "worktree database"
  - "Parallel and team work"
  - "team workflow"
  - "parallel agents"
  - "worktree fleet"
  - "Multi-repo workspaces"
  - "multi-repo work"
  - "polyrepo"
  - "workspace"
  - "local packages"
  - "submodules"
  - "Open another worktree"
  - "switch worktrees"
  - "worktree shell picker"
---

# Coordinate parallel tasks

Use this guide when several coding-agent tasks must move at once, or when one later task must build on another before the earlier work lands. Each effort keeps its own checkout, branch, identity, and declared resources. The person sees the fleet and retains every landing decision.

Parallelism is safe only when ownership is clear. Split work on real seams, name any shared files before dispatch, and choose whether streams land independently or compose below the trunk.

## Starting state

- Run one discern install at each Git repository root. A workspace containing several repositories has one fleet and one Proof boundary per repository.
- Begin task creation from the main checkout. Existing worktrees remain assigned to their original efforts.
- The person has identified each task's owned files, dependencies, and landing order.
- Project-specific databases, emulators, containers, ports, or environment values are declared under `[worktree]`. Agents do not assign them independently.

## Start one worktree per task

**Coding agent or person operating the Desk:** Call `discern_start` once for each approved task. Use a literal, predictable name and keep the returned branch and absolute path.

```sh
discern start --name programme-1a
discern start --name programme-1b
```

Each receiving agent must re-root into its own returned path before reading or editing. A start result that refuses because a worktree or resource is occupied names the safe recovery. Do not redirect the task into a sibling's checkout.

When a new task needs a chosen base, pass a real ref or commit:

```sh
discern start --name programme-2a --from <commit>
```

Use the exact commit returned by a successful dependency wait when composing green work. A branch name can disappear during acceptance.

## Confirm isolation beyond the checkout

**Coding agent:** Run `discern identity --resources` in the new worktree when the task depends on local services. The result should show that worktree's derived identity and resource handles.

`discern start`, session hooks, and `discern worktree ensure` converge the declared environment. A required resource failure leaves the worktree unfinished and names the failed command. Follow that result; do not substitute a shared service whose state can collide with another task.

The [Config reference](../30-reference/config-reference.md) owns resource fields, environment inheritance, retries, and identity tokens.

## Inspect and open the fleet

**Person:** From the main checkout, run bare `discern` to open the Desk, or use:

```sh
discern status
```

The main status groups work by state, shows branches that share changed files, and separates owner attention from agent work. A clean row is still occupied until its effort lands or is explicitly reclaimed.

In an interactive terminal, `discern enter` opens a child shell in the selected worktree at the matching project-relative directory. From a task worktree, `discern status --all` adds the fleet without changing any checkout.

## Share limited test capacity

**Person or project maintainer:** When full test runs compete for scarce local capacity, set one fleet-wide cap:

```toml
[gate]
concurrent_test_runs = 2
```

Every `discern done`, `discern test`, and Standard measurement waits for a slot when needed. Agents should route direct test commands through:

```sh
discern queue -- <test-command>
```

The queue counts each whole test-stage run. The test runner still controls its internal workers. A waiting result reports the queue state; no agent needs to poll or reserve a slot by hand.

## Keep independent streams current

For streams that will land separately, **person:** choose the within-wave landing order. **Coding agent:** before proving a later stream, call `discern_update` to bring in the latest trunk.

```sh
discern update
```

The update result names incoming overlap. Re-read those files, resolve combined assumptions, then run the stream's Gate again. Each branch needs its own current Proof and landing authority.

## Compose dependent work below the trunk

Use this path when a later stage should include an earlier stage before either reaches the trunk.

1. **Earlier coding agent:** commit the complete stage, run `discern_done`, report its Proof, keep the branch, and do not accept it.
2. **Later coding agent:** use the `discern-await-the-fleet` Skill to wait for the exact earlier branch to become green.
3. Follow the successful wait's hint. Start from or update from the immutable observed commit.
4. Verify that the expected files or behavior are present, then build the next stage on that combined tree.
5. Run the full Gate on the final composed branch. Only that final branch crosses the trunk and needs landing authority.

An earlier worktree whose committed tip is fully contained in a later live branch may be offered for reclaim. **Person:** review the bounded plan and confirm it through the Desk or `discern worktree prune --contained`. Reclaim removes the checkout and its Proof but keeps the branch ref as the recovery route.

## Coordinate several repositories

Treat each repository as a separate delivery boundary. Start and prove work in each repository's own fleet. A commit, package version, or declared dependency carries integration between them; there is no cross-repository worktree, Gate Proof, or landing grant.

When repository B depends on repository A, state the required A commit or release in B's task. Verify both repository results before the person makes their separate landing decisions.

## Reclaim finished or stale worktrees safely

Acceptance removes a successfully landed worktree. For leftovers, **person:** preview from the main checkout:

```sh
discern worktree prune --dry-run
```

Confirm only the positively owned paths in the plan. If removal reports a remaining writer, Git registration, changed snapshot, or uncertain ownership, stop that writer or repair the named entry and repeat the same lifecycle command. Do not replace the refusal with a broad recursive deletion.

## Park a task you will return to

Parking frees a healthy task's checkout, resources, and disk while keeping its branch, committed work, and task wording. Use it when a task must wait but its work should not be reviewed or discarded yet. **Person or agent:** preview the exact plan from the main checkout, then run it:

```sh
discern worktree park <id-or-path> --dry-run
```

Park requires a clean checkout on a named task branch and refuses otherwise, naming the command to run before retrying; it has no force option. The worktree's Proof, landing grant, and setup evidence leave with the checkout, so a resumed task needs fresh Proof and authority. Afterward, status lists the branch under **Work without a worktree**; resume it with `discern start --from <parked-branch>`, which restores the parked title and brief as the new task's defaults.

## Completion

Parallel coordination is working when every live task has one returned branch and path, declared resources are distinct, fleet status shows the expected ownership, direct tests respect the configured cap, and each dependency is either independently landed or present in the composed branch's tree. The final next step for each landing branch is [Finish and land a change](finish-and-land-a-change.md).

Read [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md) for the model, [Worktrees and status](../30-reference/worktrees-and-status.md) for fields and identity selectors, and [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) for refused cleanup or resource recovery.
