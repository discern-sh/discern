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

An effectful setup command therefore performs its own point-in-time write preflight. Success means only that representative writes worked in that invocation; discern cannot grant, persist, or bypass the provider's policy. Logbook recording remains advisory: a denied Logbook write warns and disables recording for the process, but does not become a required setup target.

## The effect plan owns required writes

`discern setup verify` and every dry run are read-only and perform no probe. After consent and cheap read-only preconditions, each effectful command derives all required targets from the same plan its executor will apply, then probes them before its first mutation:

| Command        | Required surfaces checked before effects                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `setup begin`  | Selected scaffold paths and the Git branch, ref, index, and commit surfaces.           |
| `setup done`   | Completion config and commit state, the Git common directory, and probe-worktree root. |
| `setup accept` | Checkout, ref advancement or merge, and setup-branch deletion.                         |

A denial returns `write_access` with the exact path and retry command and leaves the setup phase unchanged. Successful probes leave no temporary entry or changed marker. Later effects can still fail and follow ordinary partial-effect recovery.

## Resume, then verify activation

After interruption or restart, run `discern setup` or `discern status`. The recorded phase, dedicated branch, and bounded continuation let setup resume without replaying completed writes.

After completion, `setup done` serves one registry-derived activation check, one provider-local recovery step, and `discern status --json` as the CLI fallback. MCP integrations use the local `discern_status` call. Run the exact check in the fresh session: generated files alone do not prove that the provider loaded them.
