# ADR 0374: Complete Proof is independent of measurement scheduling

**Status**: accepted on 2026-09-05; implemented by the complete completion and coordinated acceptance boundaries. Amends [ADR 0003](0003-named-metric-standards.md), [ADR 0133](0133-standards-join-the-gate.md), and [ADR 0319](0319-current-green-proof-composes-and-red-reruns-stay-explicit.md). Amended by [ADR 0389](0389-the-workspace-contract.md) on 2026-09-12: complete Proof now attests the invoked checkout's own committed tip rather than a composed integration candidate; the clean-tree rule and the shared producer stay unchanged, and the multi-context evidence model and queue admission retired with the borrowed machinery.

## Context

Expensive standards can currently defer measurement while the gate passes. That separates a passing completion claim from the quality obligations an owner expects it to establish. Running a second measured test suite also repeats work already performed by the test stage. Moving that work behind the owner's acceptance request adds delay at the moment the owner needs the change.

The project is prelaunch. The owner accepts semantic breaks and will migrate the local installations. Compatibility with deferred enforcement does not constrain this decision.

## Decision

A passing Proof establishes every required gate and standard obligation for the exact commit it validates. Required evidence is measured or reused under a declared validity contract. Missing, stale, failed, or unmeasured required evidence prevents passing Proof.

Measurement scheduling is separate from enforcement. Gate jobs and standards may share a producer. A standard can consume a producer's captured output or an explicitly declared artifact through a project extractor. The execution plan resolves demand before producers run, runs each demanded producer once per valid execution identity, and evaluates each consuming standard separately. An otherwise skipped scope producer runs when required evidence has no valid baseline.

Reuse binds the relevant inputs, producer and extractor definitions, policy, toolchain, and execution conditions. Uncertainty causes execution. An arbitrary shell command gains no narrow cache key by inference. Different validated commits may share eligible component evidence; each still receives its own complete Proof.

The protected definition includes facts that can weaken enforcement, including producer selection and input declarations. Required standards cannot become advisory through scheduling configuration. The existing on-demand deferral is removed at cutover. This decision does not require a new advisory-metrics subsystem.

`done` remains the normal full-validation command and requires a clean, committed tree. Explicit `done --standalone` runs provide working-tree diagnostics without landing Proof. `test` remains a diagnostic surface, with shared execution evidence preventing unnecessary repetition where valid.

Local and CI execution use the same requirement evaluator. A report-only result cannot authorize local acceptance.

Producer receipts describe immutable execution subjects. A cancelled attempt without completed component evidence contributes no new verdict and cannot clear an earlier failure. Completed receipts retain their outcome; reuse and complete Proof still require their own current checks.

## Clean-tree amendment — 2026-09-09

`done` requires a clean, committed tree. The cutover let a dirty tree run the complete gate as a diagnostic that issued no Proof and recorded no reusable evidence. In practice that spent a full validation on a tree that could never land, and agents cannot be relied on to avoid it. Completion now refuses an uncommitted or dirty tree before selecting a candidate or running any producer, and names the uncommitted paths. `done --standalone` remains the only explicit diagnostic route for such a tree; its results stay transient. Iteration uses `prepare`, `test`, or that explicit standalone run.

## Consequences

- Required measurement can increase iteration cost. The design prioritizes useful feedback and time from approval to landing while making discarded work observable.
- Standards hold against the candidate's expected predecessor policy. A lower value cannot inherit an older, more permissive limit.
- The producer graph, evidence keys, and artifacts become correctness boundaries with structural and behavioral guards.
- Complete evidence remains distinct from landing authority and from independent third-party attestation.

## Alternatives considered

- A second landing-only measurement lifecycle creates a completion claim with required work outstanding.
- Instrumenting every execution without demand or reuse spends work when existing evidence is sufficient.
- Keeping prelaunch on-demand enforcement semantics preserves the gap this decision closes.
