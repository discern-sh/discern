---
title: Run the Gate in CI
description: Run discern done --ci on GitHub Actions and require the machine Gate result before a pull request can merge.
order: 70
aliases:
  - ci
  - GitHub Actions
  - branch protection
  - continuous integration
---

# Run the Gate in GitHub Actions

CI and local completion use the same producer planner and evaluator. The invocation declares its policy base; its result states whether it is strict completion or a report. See [complete evidence](complete-evidence.md) for the assembly boundary.

## Add the workflow

The repository's [gate workflow](../../../.github/workflows/gate.yml) is the executable recipe. Its [policy-base action](../../../.github/actions/policy-base/action.yml) fetches the pull request's actual base commit or the push's prior commit into a dedicated local ref. It preserves the checked-out source. Hosted contributor-agreement checks read that same fetched policy ref; local checks read the configured trunk. Neither path changes the source checkout. Comparing a push only with its new trunk tip would hide changed policy and checkpoint subjects.

Provision the pinned toolchain and locked dependencies before the gate. Run the source wrapper against the checked-out engine. A report-only invocation names both facts:

```sh
discern done --ci --standalone --policy-base refs/discern/ci-policy-base --json
```

A missing policy ref is a refusal. A remote-tracking ref or the latest trunk does not replace the requested base.

## Wrapped test tasks

The configured test producer owns instrumentation, reporting, and child cleanup. The root recipe runs `deno task coverage` once; coverage consumers use its captured metrics. Hosted lanes select JUnit through the declared reporter environment variable. Test names and fixture output belong to the diagnostic report; only emissions outside it supply measurements. The evaluator counts physical producer executions independently of consumer results.

## Require the result

Branch protection can require a CI report. That external check grants no discern landing authority. `--ci` reports checkpoint questions without declaring them and cannot create strict landing Proof.

## Standards in CI

Every required standard belongs to completion. There is no measurement-deferral setting or separate PR-only measurement job. The root binary-size standard builds its representative target locally, so local Proof needs no hosted size result.

The hosted Linux, macOS, and WSL lanes report the same obligation set in report mode. Platform and toolchain observations remain part of applicability, so a hosted receipt never stands in for local Proof. Producer budgets cover the command through cleanup; enclosing action and job budgets also cover setup and reporting. Current hosted instrumented calibration remains outstanding.

## Read a Windows lane timeout

The WSL 2 lane runs the gate inside a virtual machine with its own memory and swap. By default that machine gets half the runner's memory. The gate runs every check-stage producer at once, so the lane writes a `.wslconfig` before provisioning: ten of the runner's sixteen gigabytes, with swap to match. The suite's terminal captures run under the `en_US.UTF-8` locale and its browser journeys need a Chromium. The Ubuntu and macOS images carry both, so the lane installs them into the machine before the gate. A producer the gate kills at its budget looks the same whether the machine starved, a process held a lock, or the command hung. The [WSL 2 action](../../../.github/actions/wsl-gate/action.yml) therefore runs a [VM sampler](../../../.github/actions/wsl-gate/vm-samples.sh) as root beside the gate. Every twenty seconds it records memory, swap, pressure-stall figures, and swap traffic. It also records each process's state and resident size, the gate's job leaders, the kernel lock table, and any out-of-memory kill. The step log receives one line for every reading as the sampler takes it. The sampler also copies its files into the workspace as they grow, so a session the host tears down still leaves the evidence behind. The step log ends with a summary. The run keeps the complete samples and the host's virtual machine configuration as the `wsl-vm-samples` artifact, whatever the gate's outcome.

Read the summary first. Low available memory, exhausted swap, and high memory pressure identify starvation. A Deno process that stays in disk wait, or a lock that one process holds across samples, identifies the other causes. The job table gives each producer's start and last sighting inside the machine, which the gate's transcript cannot supply once the gate kills a job.

## Cloud-agent changes

A task validates and commits its own source, then obtains complete strict Proof and separate landing authority. A passing hosted report does not replace either decision.

## Where it lives in code

Use the [public evaluator](../../../src/engine/validation/public_run.ts) for execution semantics. The workflow and shared actions own platform setup and outer budgets.

## Current state & gotchas

A fixer or generator that changes tracked content leaves the checked-out commit unproved. Run `discern prepare`, commit its output, and validate the resulting commit. Fetch the actual comparison base again when the event changes.
