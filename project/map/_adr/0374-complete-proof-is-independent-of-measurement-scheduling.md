# ADR 0374: Complete Proof is independent of measurement scheduling

**Status**: accepted on 2026-09-05; implementation pending. Amends [ADR 0003](0003-named-metric-standards.md), [ADR 0133](0133-standards-join-the-gate.md), and [ADR 0319](0319-current-green-proof-composes-and-red-reruns-stay-explicit.md). Their documented runtime behavior remains current until the implementation lands.

## Context

Expensive standards can currently defer measurement while the gate passes. That separates a passing completion claim from the quality obligations an owner expects it to establish. Running a second measured test suite also repeats work already performed by the test stage. Moving that work behind the owner's acceptance request adds delay at the moment the owner needs the change.

The project is prelaunch. The owner accepts semantic breaks and will migrate the local installations. Compatibility with deferred enforcement does not constrain this decision.

## Decision

A passing Proof establishes every required gate and standard obligation for its exact integration candidate. Required evidence is measured or reused under a declared validity contract. Missing, stale, failed, or unmeasured required evidence prevents passing Proof.

Measurement scheduling is separate from enforcement. Gate jobs and standards may share a producer. A standard can consume a producer's captured output or an explicitly declared artifact through a project extractor. The execution plan resolves demand before producers run, runs each demanded producer once per valid execution identity, and evaluates each consuming standard separately. An otherwise skipped scope producer runs when required evidence has no valid baseline.

Reuse binds the relevant inputs, producer and extractor definitions, policy, toolchain, and execution conditions. Uncertainty causes execution. An arbitrary shell command gains no narrow cache key by inference. Different candidates may share eligible component evidence; each candidate still receives its own complete Proof.

The protected definition includes facts that can weaken enforcement, including producer selection and input declarations. Required standards cannot become advisory through scheduling configuration. The existing on-demand deferral is removed at cutover. This decision does not require a new advisory-metrics subsystem.

`done` remains the normal full-validation command. Dirty runs provide working-tree diagnostics without landing Proof. A clean run can select a predicted candidate before validation; queue admission adds no mandatory preliminary standalone gate. `test` remains a diagnostic surface, with shared execution evidence preventing unnecessary repetition where valid.

Local and CI execution use the same requirement evaluator. A report-only result cannot authorize local acceptance. External required contexts need explicit identity and evidence rules; a partial lane cannot present itself as aggregate completion.

## Consequences

- Required measurement can increase iteration cost. The design prioritizes useful feedback and time from approval to landing while making discarded work observable.
- Standards hold against the candidate's expected predecessor policy. A lower value cannot inherit an older, more permissive limit.
- The producer graph, evidence keys, and artifacts become correctness boundaries with structural and behavioral guards.
- Complete evidence remains distinct from landing authority and from independent third-party attestation.

## Alternatives considered

- A second landing-only measurement lifecycle creates a completion claim with required work outstanding.
- Instrumenting every execution without demand or reuse spends work when existing evidence is sufficient.
- Keeping prelaunch on-demand enforcement semantics preserves the gap this decision closes.
