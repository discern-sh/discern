---
title: The concurrent-commands limit
description: Start a set number of a gate run's commands at a time on a machine that cannot hold them all, with DISCERN_GATE_CONCURRENT_COMMANDS.
order: 125
aliases:
  - DISCERN_GATE_CONCURRENT_COMMANDS
  - concurrent commands
  - command limit
---

# The concurrent-commands limit

_`DISCERN_GATE_CONCURRENT_COMMANDS` bounds how many commands one gate run has running at a time. Unset, a run starts every ready command together._

A gate run starts each command as soon as its dependencies allow, so a project with many jobs and standards starts most of them in the same second. A machine with enough memory finishes them quickly. A machine without enough begins to swap. Every command slows, and commands that take seconds elsewhere overrun their time limits. Set the override on that machine:

```sh
export DISCERN_GATE_CONCURRENT_COMMANDS=2
```

The right value belongs to a machine, and `discern.toml` is shared by every machine, so the control is an environment variable with no config key. A shell profile can carry it, as can a CI lane's environment or the environment of the process that runs discern's MCP server. A nested `discern` run inherits it.

## What the limit counts

Each command a gate run starts in a parallel stage holds a place while it runs. That covers a job, a scope gate, a standard's measurement, and a measurement's extraction command. The fix stage starts one job at a time with or without a limit. A checkpoint's `when` probe runs before the gate's commands and holds no place.

The limit belongs to one gate run, so a second run on the same machine starts its own commands up to the same number. [The fleet test-run cap](concurrent-test-runs.md) is the control that spans checkouts. A test run takes its fleet slot first and asks for a place afterward, so a run waiting on the fleet holds no place.

## Which command starts next

A free place goes to the command that asks for it. When commands are waiting, the next free place goes to the waiting command with the longest time limit, and a command with no time limit counts as the longest. Equal limits keep the gate's declared order.

A project gives a slow command its own `timeout`, so this order starts the command expected to run longest first and lets the short ones run beside it. A project with no custom time limits gets its declared order.

A waiting command's time limit starts when the command starts. Waiting spends none of it.

If the run stops while a command waits, the command never starts. Its step reports `skipped`, as an unreached job in a serial stage does.

## What a run reports

When the limit made a command wait, the result's hints name the limit and count the commands that waited. A run in which nothing waited carries no notice.

A set value must be a positive whole number. Any other value refuses every operation that runs project commands with `invalid_value`, before a journal entry, a lock, or a command exists. An unset or empty value asks for no limit, and a dry run reads none.

## Where the limit lives

[`command_limit.ts`](../../../src/engine/jobs/command_limit.ts) owns the places, the waiting order, and the override's syntax. [`gateRunContext`](../../../src/engine/gate/execute.ts) builds the limit for a run, and a validation run without that context asks the environment itself.

The gate launches commands through the job runner and through validation, and each asks the limit for a place. [`runParallel`](../../../src/engine/jobs/runner.ts) admits the stages a verb runs itself. The command funnel in the [validation runtime](../../../src/engine/validation/runtime.ts) admits producers and extractions. [`command_launch_limit_guard_test.ts`](../../../tests/command_launch_limit_guard_test.ts) fails when a new call starts a command outside the limit. [`executeOperation`](../../../src/engine/operation_execution.ts) refuses an unusable value for every command path whose [effect policy](../../../src/shared/operation_effects.ts) includes `project-command`.

[`engine_concurrent_commands_test.ts`](../../../tests/engine_concurrent_commands_test.ts) drives each launch path through the CLI with a limit of 1. The suite's fixture environment blanks the override, so a suite running under a limit starts its fixtures' commands as an unconfigured machine would.

[ADR 0435](../_adr/0435-a-runtime-override-limits-concurrent-gate-commands.md) records the decision. This repository's [hosted macOS and WSL 2 lanes](ci.md#limit-concurrent-commands-on-a-small-runner) set the limit.
