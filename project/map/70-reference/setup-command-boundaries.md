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

Owner consent authorizes the requested setup act. Provider authorization controls what the running process may access. A landing grant authorizes discern to advance trunk within its recorded scope. None of those proves that a filesystem or Git write will work now.

Before consent, setup recommends the strongest suitable reasoning model because it authors project context later sessions inherit. The executing agent separately reports its self-declared provider/model identifier, or `unreported`. The owner may continue or switch through the coding tool's model selector and a fresh project session; the current agent stops when the owner switches. [Setup decisions](../10-getting-started/setup-decisions.md) explains the lasting outcome and advisory-provenance boundary.

An effectful setup command therefore performs its own point-in-time write preflight. Success means only that representative writes worked in that invocation; discern cannot grant, persist, or bypass the provider's policy. Logbook recording remains advisory: a denied Logbook write warns and disables recording for the process, but does not become a required setup target.

## The effect plan owns required writes

`discern setup verify` and every dry run are read-only and perform no probe. After consent and cheap read-only preconditions, each effectful command derives all required targets from the same plan its executor will apply, then probes them before its first mutation:

| Command        | Required surfaces checked before effects                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `setup begin`  | Selected scaffold paths and the Git branch, ref, index, and commit surfaces.           |
| `setup done`   | Completion config and commit state, the Git common directory, and probe-worktree root. |
| `setup accept` | Checkout, ref advancement or merge, and setup-branch deletion.                         |

A denial returns `write_access` with the exact path and retry command and leaves the setup phase unchanged. Successful probes leave no temporary entry or changed marker. Later effects can still fail and follow ordinary partial-effect recovery.

## Prove, land, then verify activation

After interruption, `discern setup` or `discern status` resumes the recorded phase and branch without replaying writes.

`setup done` proves the committed tree and derives its Map, TODO, and job inventory. It also derives the primary subsystem's start point, boundary, non-obvious invariant, project principles, and instruction sources from committed authorities. This qualitative account explains what later sessions inherit. The counts support it. Off the trunk, every surface leads with Proof and landing. Restart and improvement remain absent.

After `setup accept`, each integration gets one registry-derived fresh-session instruction. Inspect the session's registered tools before opening external documentation, then invoke the exact provider-local callable. Namespaced hosts receive their namespaced form, such as Codex's `mcp__discern__discern_status`; other adapters name the stable callable they expose. A missing action routes to the provider's local registration recovery or `discern doctor`, with `discern status --json` as the CLI fallback. Success makes the optional `discern improvement` owner review available.

If a result is truncated, consume its state, diagnostics, location, next action, recovery, Proof, and human relay from the structured or retrievable view. Never repeat `setup done`, `setup accept`, or another effectful command merely to recover omitted output; completion-result replay belongs to the follow-on completion-recovery work.
