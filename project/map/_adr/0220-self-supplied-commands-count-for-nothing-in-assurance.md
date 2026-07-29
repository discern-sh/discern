# ADR 0220: Self-supplied commands count for nothing in setup assurance

**Status**: accepted; applies the additive-output discipline of [ADR 0208](0208-public-contracts-version-by-schema-major.md)

## Context

`discern setup done` closes with a quality-coverage assurance: each known job classified from `[jobs]` alone, rolled into a `full` / `partial` / `minimal` verdict, with `minimal` carrying the honest "no quality checks are wired yet" message. The classification was two-valued on presence: any command surviving no-op filtering made a job `enforced`.

The scaffold seeds `format = "discern tidy"` into every install. Under that rule the seed alone made `enforced` ≥ 1 on every fresh project, so the `minimal` verdict was unreachable in practice: a project with zero real checks completed setup reading "quality checks are wired". `discern doctor`'s known-jobs warning — "gate may pass without the built-in protections" — was silenced by the same seed. For a product whose claim is that it checks what agents claim, awarding itself an unearned green at first contact contradicts the thesis.

Two constraints shape the fix. The seed is worth keeping: `discern tidy` genuinely runs in the gate and keeps discern's own surfaces canonical — but it is discern maintaining discern, present everywhere, evidence of nothing about the project. And the assurance `state` vocabulary is a closed enum on the public result contract, which evolves additively within a schema major ([ADR 0208](0208-public-contracts-version-by-schema-major.md)): a consumer pinned to the published schema may validate results and switch exhaustively over the three states, so widening the enum is a breaking change the compatibility guard rejects.

## Decision

A command that invokes discern's own built-in vocabulary — `discern` followed by a built-in verb, driven off `KNOWN_VERBS` as the single source of truth — is **self-supplied** and counts for nothing in coverage accounting. A known job whose real commands are all self-supplied classifies as `deferred` — the existing "present but counts for nothing" state — carrying a new optional `self_supplied: true` marker that distinguishes it from the `:`/empty no-op deferral. Only `enforced` jobs count toward the verdict, so a fresh scaffold reads `minimal`. Doctor's known-jobs warning keys on the same shared classifier. Human surfaces render the marked case as **housekeeping**; the wire keeps the three-state vocabulary and gains only the additive marker, per the additive-output discipline.

A Project Script invoked through the namespace (`discern <script>`) is project-authored and still counts: the predicate matches the built-in verb set, not the `discern` program name.

Explicitly not done: the seed is unchanged (tidy stays wired and the gate still runs it), and the exclusion is not an exact-string match on `discern tidy` — any built-in verb in a job command is equally self-supplied, and a new verb enrols the moment it joins `KNOWN_VERBS`.

## Consequences

A skeptic pointing discern at an empty repository now gets the floor verdict and the honest copy, and doctor warns until a real check is wired. The completion report can only improve by wiring genuine project commands. Consumers pinned to the published v1 schema keep validating: the state vocabulary is unchanged and the marker is an optional field addition.

`deferred` now spans two distinguishable cases — the deliberate no-op (with its inline-comment reason channel) and the self-supplied housekeeping job (with the marker) — and renderers that want the housekeeping distinction must read the marker, not the state.

Guards hold the semantics: every `KNOWN_VERBS` member is asserted self-supplied, and the template's canonical `[jobs]` block must assess as `minimal`, so a future seed cannot quietly re-award coverage.

## Alternatives considered

**Stop seeding `discern tidy`.** Restores honesty by removing the cause, but loses canonical formatting on fresh installs and doctor's during-setup guarantee that the tidy hygiene survived the setup agent.

**A fourth `housekeeping` state.** The cleanest vocabulary, but it widens a closed enum on the public result contract within a major — a breaking change for pinned validators, rejected by the compatibility guard. The additive marker carries the same information compatibly.

**Exclude the exact string `discern tidy`.** Fixes the instance, not the class: any other self-invocation seeded or hand-wired later would re-create the unearned green, with no forcing function enrolling new verbs.
