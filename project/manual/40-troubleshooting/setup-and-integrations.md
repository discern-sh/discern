---
id: troubleshoot-setup-and-integrations
title: "Setup and integrations"
description: "Recover when setup or provider integration cannot begin, resume, prove, land, activate, or agree on a setup step."
order: 20
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-setup-and-integrations"
  - "Setup command boundaries"
  - "setup write authority"
  - "setup activation"
  - "setup recovery"
  - "Recover an interrupted worktree setup step"
  - "worktree setup recovery"
  - "setup step journal"
  - "ambiguous setup step"
redirect_from:
  - "/docs/reference/setup-command-boundaries"
  - "/docs/reference/worktree-setup-step-recovery"
---

# Setup and integrations

Recover when setup or provider integration cannot begin, resume, prove, land, activate, or agree on a setup step.

## Setup command boundaries

_Setup keeps consent, provider authority, landing authority, and observed write access separate._

### Authority is specific

Owner consent authorizes the setup act, provider authorization controls process access, and a landing grant covers trunk advancement. Each effectful command still performs a point-in-time write preflight; success cannot grant or persist provider authority. A denied Logbook write remains advisory.

Before consent, setup recommends the strongest suitable model and records the executing agent's self-declared identifier, or `unreported`. The owner may continue or switch through the provider's model selector; [Setup decisions](../00-start/first-success.md) explains that boundary.

### The effect plan owns required writes

`discern setup verify` and dry runs perform no probe. After consent and read-only preconditions, each effectful command derives and probes required targets from its execution plan:

| Command        | Required surfaces checked before effects                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `setup begin`  | Selected scaffold paths and the Git branch, ref, index, and commit surfaces.           |
| `setup done`   | Completion config and commit state, the Git common directory, and probe-worktree root. |
| `setup accept` | Checkout, ref advancement or merge, and setup-branch deletion.                         |

A denial returns `write_access` with the path and retry while preserving the phase. Successful probes leave no temporary entry; later effects retain their ordinary recovery.

Setup and upgrade treat generated agent instructions as a required late outcome. Their structured results use `data.instruction_refresh`: `status: "complete"` carries the compiled artifacts, including an empty list when everything was already current; `status: "partial"` carries completed artifacts, non-empty failure evidence, `effects_preserved: true`, and a safe-to-retry `discern refresh` recovery. A partial refresh makes top-level `ok` false and the CLI exit nonzero while preserving every earlier scaffold or migration effect. Callers do not infer completion from an empty list or warning prose ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

Project-authored `[worktree.setup].steps` use a separate per-worktree journal. [Recover an interrupted worktree setup step](setup-and-integrations.md) defines its states and owner-confirmed recovery commands.

### Prove, land, then verify activation

After interruption, `discern setup` or `discern status` resumes without replaying writes. `setup done` proves the committed tree and derives its project-guide, TODO, job, starting-point, rule, principle, and instruction accounts from committed authorities. Off trunk, output stops at Proof and landing.

After `setup accept`, each provider gets one fresh-session instruction. Inspect registered tools, then invoke its exact local callable, including a namespaced form such as Codex's `mcp__discern__discern_status`. A missing action routes to local recovery or `discern doctor`, with `discern status --json` as fallback.

Acceptance is idempotent where no landing applies. A project without a Git repository and a checkout already on the trunk both return `ok: true` with typed `data.completion.status = "no_op"`; `data.completion.reason` distinguishes the two states. An absent landing payload is not a no-op signal.

For a truncated result, repeat `setup done` on the unchanged clean marker: it returns the same Proof, inventory, and landing facts with `data.completion = "replayed"` and no effects or Gate. Missing or stale Proof validates that commit; dirty state retains existing evidence and refuses ([ADR 0351](https://discern.sh/docs/decisions/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips)).
## Recover an interrupted worktree setup step

_discern preserves uncertainty instead of automatically replaying a command whose outcome it cannot observe._

Each configured `[worktree.setup].steps` command has a stable identity and a `not_started`, `running`, or `completed` state. `discern worktree setup` atomically records `running` before invocation and `completed` after success in the worktree's Git administration area. Re-entry skips completed identities even if a later setup phase never reached the worktree-ready sentinel.

A `running` identity means the process stopped after invocation began but before completion was recorded. Automatic setup refuses before any other setup effect. Observe the command's external state, then choose one recovery.

If the step completed, preserve that observation without replaying it:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
```

If it did not complete, or another run is appropriate, authorize a retry:

```sh
discern worktree setup --retry-step <id> --confirmed
```

Both choices are idempotent. `--confirmed` records the owner's decision for that observed step. The shell command's outcome remains an observation rather than machine proof. A running state blocks automatic replay until the owner chooses retry ([ADR 0332](https://discern.sh/docs/decisions/0332-worktree-setup-steps-preserve-interruption-ambiguity)).

Top-level `setup begin`, `setup done`, and `setup accept` retain their plan-derived write checks and resumable phase state; [Setup command boundaries](setup-and-integrations.md) defines that separate contract.
