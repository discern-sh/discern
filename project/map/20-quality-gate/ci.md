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

CI and local completion use the same producer planner and evaluator. The invocation declares its execution context and policy base; its result states whether it is strict completion or a report. See [complete evidence](complete-evidence.md) for the assembly boundary.

## Add the workflow

The repository's [gate workflow](../../../.github/workflows/gate.yml) is the executable recipe. Its [policy-base action](../../../.github/actions/policy-base/action.yml) fetches the pull request's actual base commit or the push's prior commit into a dedicated local ref. It preserves the checked-out source. Comparing a push only with its new trunk tip would hide changed policy and checkpoint subjects.

Provision the pinned toolchain and locked dependencies before the gate. Run the source wrapper against the checked-out engine. A report-only invocation names both facts:

```sh
discern done --ci --standalone --context local --policy-base refs/discern/ci-policy-base --json
```

A missing policy ref is a refusal. A remote-tracking ref or the latest trunk does not replace the requested base.

## Wrapped test tasks

The configured test producer owns instrumentation, reporting, and child cleanup. The root recipe runs `deno task coverage` once; coverage consumers use its captured metrics. CI selects its reporter through the declared environment variable. The evaluator counts physical producer executions independently of consumer results.

## Require the result

Branch protection can require a CI report. That external check grants no discern landing authority. `--ci` reports checkpoint questions without declaring them and cannot create strict landing Proof.

## Standards in CI

Every required standard belongs to completion. There is no measurement-deferral setting or separate PR-only measurement job. The root binary-size standard builds its representative target locally, so local Proof needs no hosted size result.

Contexts remain separate evidence subjects. A configured remote requirement needs evidence for that exact candidate, context, mode, inputs, producer, and policy. A skipped status, a local report, or another context's receipt cannot satisfy it. Projects that require strict remote evidence must arrange that declared execution and retain its component evidence for complete assembly.

The root gate currently requires the local context. Its hosted Linux, macOS, and WSL lanes explicitly report the local obligation set in report mode. Platform and toolchain observations remain part of applicability; these reports do not supply a separately required remote context. Producer budgets cover the command through cleanup; enclosing action and job budgets also cover setup and reporting. Current hosted instrumented calibration remains outstanding.

## Cloud-agent changes

A task validates and commits its own source, then obtains complete strict Proof and separate landing authority. A passing hosted report does not replace either decision.

## Where it lives in code

Use [context selection](../../../src/engine/validation/context.ts), the [public evaluator](../../../src/engine/validation/public_run.ts), and [CI integration tests](../../../tests/completion_public_ci_test.ts) for execution semantics. The workflow and shared actions own platform setup and outer budgets.

## Current state & gotchas

A fixer or generator that changes tracked content leaves the checked-out commit unproved. Run `discern prepare`, commit its output, and validate the resulting candidate. Fetch the actual comparison base again when the event changes.
