---
title: Complete evidence
description: Trace the committed tip through required production, evidence reuse, and Proof.
order: 25
---

# Complete evidence

`done` requires a clean, committed tree, then assembles the required jobs, changed-scope gates, and standards for that exact `HEAD` through one producer graph. A successful subset cannot produce Proof. `done --standalone` provides transient diagnostics, including on a dirty tree, without Proof or landing authority. `test` reports readings its declared work already supplies; `prepare` requests no measurement. Every check runs in the invoking checkout; no operation installs another revision into it ([ADR 0389](../_adr/0389-the-workspace-contract.md)).

Known checkpoint questions are served before expensive production. Stop at the supplied question, record the conclusion, and continue the same effort.

[`configuredValidation`](../../../src/engine/validation/configuration.ts) is the configuration authority for producers, dependencies, and extraction. [`executePublicValidation`](../../../src/engine/validation/public_run.ts) supplies the native runtime and projects actual producer counts. Standalone standards uses that same evaluator. `run` always produces; `extract` consumes captured output or a declared artifact. One producer can serve several standards without another instrumented run. Each producer keeps its own watchdog.

Within an observed record snapshot, the [evidence index](../../../src/engine/validation/selection.ts) validates history once and indexes attempts by subject and receipts by producing attempt. Artifact selection and demand planning share that snapshot. A new observation gets a new index and audits its selected bytes again. This changes selection cost without changing failed, cancelled, ambiguous, or report-only evidence rules.

Evidence reuse binds the complete declared input closure, effective commands, policy, toolchain, environment, seed, and denominator. Missing closure binds a receipt to its commit. `done`, `test`, and `standards` results list each producer that ran or whose evidence stood in, with its closure kind and the reason, under `producer_evidence`. Doctor's `evidence reuse` check and setup's completion report name every commit-bound producer with the remedy; [`producer_facts.ts`](../../../src/engine/validation/producer_facts.ts) derives both from the producer graph. A failed producer blocks older passing receipts for its applicable subjects. A finished attempt without a completed component verdict contributes no new verdict for that subject. Cancelled, `unrun`, and stale observations cannot erase an earlier applicable failure. Reuse still checks the complete input identity and selected artifacts. Completed passing and failing component receipts retain their outcomes even when the enclosing attempt is cancelled. A dependency that did not complete leaves its consumers `unrun`. `done --rerun` records the latest finished validation attempt as its retry boundary and can retry earlier failed subjects; unrelated passing receipts remain reusable.

The protected-definition check resolves aliases through the same graph. An equivalent command may move to a referenced producer. Narrowing declared inputs or removing observed identities cannot weaken an existing standard. The trunk supplies the policy baseline.

CI uses the same evaluator with the event's actual policy base. Report evidence records machine work and checkpoint questions; it cannot replace strict completion evidence or authorize acceptance. This repository's coverage producer runs one instrumented suite in the local and CI gate. Required local binary-size evidence needs no hosted result.

Source scans and input enumeration follow Git's tracked and non-ignored files; tracked paths remain inputs even if an ignore pattern matches. Ignoring a scratch path does not exempt declared toolchain inputs or captured artifacts. Project commands must keep transient output outside the authored scan set throughout concurrent execution. Checkout verification names observed changes without inferring which concurrent command wrote them. [`checkout_changes.ts`](../../../src/shared/checkout_changes.ts) owns that diagnostic.

A known job's command array is one ordered producer recipe; later commands depend on earlier success. Independent named jobs retain their declared parallelism. Producer stdout feeds extraction separately. The existing supervised pipe drain also retains stdout and stderr together for public failure diagnostics, so measurement capture cannot hide a check's explanation.

Large gate, prepare, and standards results retain complete diagnostics in a referenced local artifact. CLI JSON and MCP return bounded excerpts with its path, digest, byte length, and exact observation counts. Read that artifact to retrieve omitted findings; do not repeat a producer to recover output. These diagnostic artifacts follow the existing temporary-output retention policy, so copy evidence needed beyond that lifetime. Failed, skipped, cancelled, and `unrun` outcomes keep their own meanings.

The clean gate retains its original Proof presentation beside the complete evidence in common storage. Acceptance reads that immutable receipt and rechecks its commit and evidence identity; it does not reconstruct jobs or measurements from the receiving checkout. Missing or corrupt presentation bytes remain a recovery condition.

Public contracts and the install schema remain at version 1 with no migration steps. Generators update their root `schema/` artifacts in place. A Proof note written in a pre-launch shape has no reader; the unchanged payload type cannot supply absent facts or authority.

[`events.ts`](../../../src/engine/completion/events.ts) exposes advisory producer-use, timing, and lifecycle facts within one invocation. Every component-use fact references a real receipt; several consumers may reference the same physical execution. The command's `producer_executions` counts physical runs. MCP clients that supply a progress token receive current phases and pending reasons while calls run. Observer delivery cannot change the operation's result.

Setup completion and setup acceptance publish the same compact Proof reading as status: current marker state, source commit, Proof identity, and the relay line. Full evidence stays behind the canonical Proof reader.

A diagnostic demand stays fixed during execution. If a project command introduces a new changed scope, the result stops and names it; preparation and a fresh diagnostic or committed completion run include its gate. Dirty feedback names the uncommitted paths.

Completion record inventories resolve the common Git directory once per observation, inside the operation's retained Git discovery ([Operation effects and exclusion](../50-engine-internals/operation-effects-and-locks.md#operations-retain-git-discovery)). [`store.ts`](../../../src/engine/completion/store.ts) retains only the directory during that operation; reads still validate current bytes, and later operations resolve storage again. Artifact audits read each distinct artifact coordinate once per observation and recheck containment, complete bytes, length, and digest; superseded history cannot become fallback evidence.
