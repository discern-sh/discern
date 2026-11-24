# ADR 0435: A runtime override limits concurrent gate commands

**Status**: accepted.

## Context

A gate run starts every command whose dependencies are met. In a project with many jobs and standards, most of them start in the same second. On a machine with enough memory that is the fastest schedule. On one without enough, the commands push each other into swap, and commands that take seconds elsewhere overrun their time limits.

This repository met that twice on its hosted macOS lane. The first remedy raised the per-command time limit from 10 minutes to 30. The commands later overran 30. The hosted WSL 2 lane, which samples its machine, recorded the same gate needing about 14.5 GB in its first three minutes and about 2.5 GB for most of the remaining run.

## Decision

`DISCERN_GATE_CONCURRENT_COMMANDS` names how many commands one gate run starts at a time. It is a runtime override, and it is off unless set. [The concurrent-commands limit](../20-quality-gate/concurrent-commands.md) describes its behavior.

The control is an environment variable because the right value belongs to a machine, and `discern.toml` is shared by every machine a project runs on. A number in the config would slow a workstation to protect a small runner.

discern takes the number from the person who knows the machine. It does not derive one from the processor count or installed memory, because how much memory a project's commands need is the project's own fact.

Waiting commands start longest time limit first. A time limit is a statement about a command's length that every project already makes. Ordering by recorded durations would be more accurate where history exists. A fresh CI checkout has none, and the order would then depend on a machine's past.

A value that is not a positive whole number refuses every operation that runs project commands. A value that only resembles a limit would otherwise leave a run unbounded while its owner believes the limit is set.

## Consequences

A run that sets no value behaves as it did before. A run that sets one starts fewer commands at a time and finishes no later than its longest command allows, as long as that command starts early. The waiting order exists for that case, and a project whose longest command has an ordinary time limit gets declared order instead.

The limit counts commands. It does not measure memory, so the number that suits a machine is found by trying it. The limit also belongs to one run: two runs on one machine each start up to that number. The fleet test-run cap remains the control across checkouts.

The refusal reaches operations that run project commands without running the gate, such as a project script. That is broader than the limit's own reach. Refusing later, inside a run that had already claimed its attempt, would leave partial state behind for a value the environment can correct.

A project-wide default in `discern.toml` and a per-invocation flag are not built. Either can be added without changing this override.
