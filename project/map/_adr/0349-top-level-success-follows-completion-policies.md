# ADR 0349: Top-level success follows completion policies

**Status**: accepted. Extends the one-result projection model from [ADR 0028](0028-result-envelope-and-diagnostics.md), canonical-set parity from [ADR 0051](0051-canonical-set-parity.md), classified recovery from [ADR 0266](0266-public-failure-recovery-is-classified-by-error-family.md), structurally valid result states from [ADR 0334](0334-result-envelopes-encode-valid-structural-states.md), and typed advisories from [ADR 0346](0346-machine-facts-are-typed-advisories.md).

## Context

`DiscernResult<TData>` made contradictory structural states impossible by type, but it did not give every producer the same meaning for `ok`. A verb could report `ok: true` after a required late operation failed, provided its own Boolean convention happened to treat an earlier effect as success. Setup and upgrade exposed this defect when required instruction compilation failed after other files had changed. Similar ambiguity existed around cancelled steps, incomplete landing cleanup, failed optional resources, Proof recording, and observational warnings.

Repairing only the known setup fields would leave the semantic rule distributed across verb implementations. A future verb could repeat the defect, while command-line interface (CLI), human, JSON, Markdown, and Model Context Protocol (MCP) adapters could disagree if each interpreted the payload independently. An empty list or warning sentence could not safely distinguish an idempotent success, a required failure, and an explicitly optional degradation.

The result contract therefore needs a total authority over the live result-verb set, typed evidence for every permitted degradation, and one evaluation seam before projection. It must preserve the truth of effects that already happened instead of implying rollback.

## Decision

Every public result verb has one entry in [`RESULT_COMPLETION_POLICIES`](../../../src/shared/result_completion.ts). The policy declares its required typed outcomes, permitted advisory kinds, refusal meaning, cancellation meaning, partial-effect meaning, no-op meaning, and recovery owner. Compile-time parity ties the literal policy keys to the result-contract registry; an injected bidirectional coverage check rejects missing, stale, and duplicate members.

[`evaluateResultCompletion`](../../../src/shared/result_completion.ts) derives the top-level verdict from the result's typed plan/apply outcomes and the verb's policy. `ok: true` means every required outcome in that policy holds. A required failed or cancelled step is false. A refusal is false. A no-op is true only where the policy admits one. The evaluator does not parse messages or renderer prose.

A degradation may coexist with `ok: true` only as a policy-permitted `ResultAdvisory`. Each advisory has a closed `kind`, non-empty structured `evidence`, and a non-empty `next_action`. A failed executed step counts as optional only when it carries such an advisory and its verb policy permits that kind. Hints remain presentation and navigation records; they do not waive required completion.

Required failures after effects preserve those effects in typed data and steps. Acceptance uses its landing-effect record; setup and upgrade use a discriminated `data.instruction_refresh` outcome. `status: "partial"` carries completed artifacts, non-empty failures, `effects_preserved: true`, and the safe `discern refresh` recovery. The top-level result is false and the CLI exits nonzero. No result claims rollback unless a typed rollback operation actually occurred.

Result capture, quiet CLI emission, serialization, MCP adaptation, and the Logbook CLI completion wrapper all consume the evaluated result. Human, Markdown, JSON, generated schemas, and MCP project that verdict; they cannot upgrade or downgrade it. MCP `isError` is the inverse of the evaluated `ok`. Generated result-contract metadata publishes each verb's exact completion policy so a consumer can audit the declared contract without reconstructing it from prose.

## Consequences

- An agent or integration can branch on `ok` as the truth of the verb's documented completion contract before inspecting verb-specific data.
- Adding a result-producing verb now requires choosing its semantic state table, not merely its schema and renderer. A missing policy fails compilation or the architectural guard.
- Optional failures are visible and actionable without turning every warning into failure. Adding a new permitted degradation requires a typed kind and explicit policy enrollment.
- Late required failures return false while retaining partial-state and safe-rerun evidence. Callers must not assume `ok: false` means no effects occurred.
- Setup and upgrade consumers must migrate from ambiguous compilation Booleans and lists to `data.instruction_refresh`. This intentionally breaks consumers that treated a required compilation failure as success.
- Completion evaluation is a shared boundary with some defensive repetition. That cost prevents a surface adapter or manually returned exit code from publishing a verdict that differs from the core envelope.

## Alternatives considered

- **Fix setup and upgrade locally.** Rejected because it would cure two instances while leaving every current and future verb free to define `ok` differently.
- **Infer completion from error strings, warnings, or empty collections.** Rejected because wording and absence are not typed state, and renderers would become semantic authorities.
- **Treat every warning or failed step as failure.** Rejected because optional resources, cleanup, and observations can degrade explicitly without invalidating the verb's required contract.
- **Keep renderer-specific verdict rules for compatibility.** Rejected because CLI, JSON, Markdown, human, and MCP consumers would observe different facts for one operation.
- **Hide partial effects behind a generic failure.** Rejected because safe recovery depends on knowing what changed and whether rerunning is valid.
