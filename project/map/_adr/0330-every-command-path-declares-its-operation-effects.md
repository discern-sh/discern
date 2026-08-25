# ADR 0330: Every command path declares its operation effects

**Status**: accepted. Extends the canonical-set forcing function in [ADR 0051](0051-canonical-set-parity.md), keeps the Logbook recording concern from [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md) separate, and supplies policy metadata beside the plan/apply model in [ADR 0027](0027-plan-apply-engine-execution.md).

## Context

discern commands range from observations to checkout writers, common-repository transitions, project-authored command execution, and setup or resource effects outside the repository. That distinction existed only in scattered handlers. `LOGBOOK_EFFECTFUL_VERBS` answered whether an invocation needed a paired activity record, which is a recording question. It could not state which state an operation might change, where exclusion belonged, or which preview obligation applied.

The command surface also has nested paths and mixed behavior. Bare command groups can observe while a child or flag writes. Dry runs perform no apply effects. The command-line interface (CLI) and Model Context Protocol (MCP) reach the same cores through different adapters. A policy attached only to selected handlers would leave a new route able to bypass classification.

## Decision

**[`OPERATION_EFFECTS`](../../../src/shared/operation_effects.ts) is the canonical policy for every live CLI command path.**

Each entry declares:

- one or more effect classes: observation, discern-owned checkout mutation, discern-owned common-repository or main-checkout mutation, project-authored command execution, and external setup or resource effects;
- the required lock boundary: none, checkout, common repository, or common repository plus checkout;
- a preview obligation of none, disclose, or required; and
- optional invocation conditions for mixed command paths, plus whether a writer is valid before a discern project exists.

Invocation facts select the active lock without changing the declared effect set. A dry run takes no writer lock. A mixed command's observational form can remain concurrent while its writer form acquires its declared boundary.

The CLI and MCP adapters resolve the same command path and invocation facts before the command body runs. An unknown command path has no default policy and refuses before effects. [`tests/operation_effects_test.ts`](../../../tests/operation_effects_test.ts) derives live nested and top-level paths from the command tree. It requires registry parity, checks MCP mapping, and proves that each effect class has a live member. [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts) enrolls the operation-effects set.

Logbook enrollment remains a separate authority. Recording an operation start does not classify its effects, and an observation can still produce Logbook evidence.

## Consequences

- A new command path fails its forcing-function test until maintainers review its effects, lock boundary, and preview obligation.
- The registry represents project-authored commands as potentially effectful. It makes no claim that their subprocesses are side-effect-free.
- Classification does not imply one universal lock: `queue` retains its own concurrency authority, while Project Script execution holds its checkout boundary.
- Mixed paths keep useful read concurrency without treating their write forms as observations.
- One registry can enforce preview policy without recovering intent from help text or handler structure.
- Registry maintenance is an added requirement for every command-path change. That cost keeps CLI and MCP execution policy aligned.

## Alternatives considered

- **Use `LOGBOOK_EFFECTFUL_VERBS` as the policy.** Rejected because paired activity recording does not describe the effect class, lock scope, or preview contract.
- **Infer effects from handler imports or result step kinds.** Rejected because those are implementation details observed after dispatch and cannot reliably classify project commands or mixed invocation forms.
- **Give unknown commands a checkout lock.** Rejected because a conservative lock would still guess the wrong common-repository and preview boundaries.
