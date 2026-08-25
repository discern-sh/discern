---
title: Setup command boundaries
description: Owner consent, point-in-time write checks, resumable phases, and provider activation during setup.
order: 180
aliases:
  - setup write authority
  - setup activation
  - setup recovery
---

# Setup command boundaries

_Setup keeps consent, provider authority, landing authority, and observed write access separate._

## Authority is specific

Owner consent authorizes the setup act, provider authorization controls process access, and a landing grant covers trunk advancement. Each effectful command still performs a point-in-time write preflight; success cannot grant or persist provider authority. A denied Logbook write remains advisory.

Before consent, setup recommends the strongest suitable model and records the executing agent's self-declared identifier, or `unreported`. The owner may continue or switch through the provider's model selector; [Setup decisions](../10-getting-started/setup-decisions.md) explains that boundary.

## The effect plan owns required writes

`discern setup verify` and dry runs perform no probe. After consent and read-only preconditions, each effectful command derives and probes required targets from its execution plan:

| Command        | Required surfaces checked before effects                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `setup begin`  | Selected scaffold paths and the Git branch, ref, index, and commit surfaces.           |
| `setup done`   | Completion config and commit state, the Git common directory, and probe-worktree root. |
| `setup accept` | Checkout, ref advancement or merge, and setup-branch deletion.                         |

A denial returns `write_access` with the path and retry while preserving the phase. Successful probes leave no temporary entry; later effects retain their ordinary recovery.

## Worktree setup steps retain interruption evidence

Top-level `setup begin`, `setup done`, and `setup accept` keep their `SetupEffectPlan` write targets and resumable phase state. Project-authored `[worktree.setup].steps` use a separate per-worktree journal because discern cannot prove the outcome of an interrupted arbitrary shell command.

Each configured step has a stable identity and `not_started`, `running`, or `completed` state. `discern worktree setup` records `running` before invocation and `completed` after success. A completed identity remains complete when a later setup phase fails, so re-entry skips it without relying on the final worktree-ready sentinel.

A running identity stops automatic replay before other setup effects. Observe the command's external state, then choose one recovery:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
```

Use that command when observation establishes completion. To authorize another run:

```sh
discern worktree setup --retry-step <id> --confirmed
```

Each recovery is idempotent. A retry does not make the command transactional, and the journal promises at-most-once automatic replay rather than once-only external effects. discern validates and atomically replaces the journal in the worktree's Git administration area ([ADR 0332](../_adr/0332-worktree-setup-steps-preserve-interruption-ambiguity.md)).

## Prove, land, then verify activation

After interruption, `discern setup` or `discern status` resumes without replaying writes. `setup done` proves the committed tree and derives its project-guide, TODO, job, starting-point, rule, principle, and instruction accounts from committed authorities. Off trunk, output stops at Proof and landing.

After `setup accept`, each provider gets one fresh-session instruction. Inspect registered tools, then invoke its exact local callable, including a namespaced form such as Codex's `mcp__discern__discern_status`. A missing action routes to local recovery or `discern doctor`, with `discern status --json` as fallback.

For truncated results, consume state, diagnostics, location, next action, recovery, Proof, and relay from the structured or retrievable view. Never repeat an effectful command to recover output; completion replay belongs to follow-on work.
