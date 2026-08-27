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

Setup and upgrade treat generated agent instructions as a required late outcome. Their structured results use `data.instruction_refresh`: `status: "complete"` carries the compiled artifacts, including an empty list when everything was already current; `status: "partial"` carries completed artifacts, non-empty failure evidence, `effects_preserved: true`, and a safe-to-retry `discern refresh` recovery. A partial refresh makes top-level `ok` false and the CLI exit nonzero while preserving every earlier scaffold or migration effect. Callers do not infer completion from an empty list or warning prose ([ADR 0349](../_adr/0349-top-level-success-follows-completion-policies.md)).

Project-authored `[worktree.setup].steps` use a separate per-worktree journal. [Recover an interrupted worktree setup step](worktree-setup-step-recovery.md) defines its states and owner-confirmed recovery commands.

## Prove, land, then verify activation

After interruption, `discern setup` or `discern status` resumes without replaying writes. `setup done` proves the committed tree and derives its project-guide, TODO, job, starting-point, rule, principle, and instruction accounts from committed authorities. Off trunk, output stops at Proof and landing.

After `setup accept`, each provider gets one fresh-session instruction. Inspect registered tools, then invoke its exact local callable, including a namespaced form such as Codex's `mcp__discern__discern_status`. A missing action routes to local recovery or `discern doctor`, with `discern status --json` as fallback.

Acceptance is idempotent where no landing applies. A project without a Git repository and a checkout already on the trunk both return `ok: true` with typed `data.completion.status = "no_op"`; `data.completion.reason` distinguishes the two states. An absent landing payload is not a no-op signal.

For truncated results, consume state, diagnostics, location, next action, recovery, Proof, and relay from the structured or retrievable view. Never repeat an effectful command to recover output; completion replay belongs to follow-on work.
