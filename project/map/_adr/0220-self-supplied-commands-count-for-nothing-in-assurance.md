# ADR 0220: Self-supplied commands count for nothing in setup assurance

**Status**: accepted

## Context

`discern setup done` closes with a quality-coverage assurance: each known job classified from `[jobs]` alone, rolled into a `full` / `partial` / `minimal` verdict, with `minimal` carrying the honest "no quality checks are wired yet" message. The classification was two-valued on presence: any command surviving no-op filtering made a job `enforced`.

The scaffold seeds `format = "discern tidy"` into every install. Under that rule the seed alone made `enforced` ≥ 1 on every fresh project, so the `minimal` verdict was unreachable in practice: a project with zero real checks completed setup reading "quality checks are wired". `discern doctor`'s known-jobs warning — "gate may pass without the built-in protections" — was silenced by the same seed. For a product whose claim is that it checks what agents claim, awarding itself an unearned green at first contact contradicts the thesis.

The tension: `discern tidy` genuinely runs in the gate and is worth seeding (it keeps discern's own surfaces canonical), but it is discern maintaining discern — present everywhere, evidence of nothing about the project.

## Decision

A command that invokes discern's own built-in vocabulary — `discern` followed by a built-in verb, driven off `KNOWN_VERBS` as the single source of truth — is **self-supplied** and counts for nothing in coverage accounting. A known job whose real commands are all self-supplied classifies as a fourth state, `housekeeping`: distinct from `enforced` (nothing of the project's own runs), from `deferred` (it is not a no-op), and from `absent` (the key exists). Only `enforced` jobs count toward the verdict, so a fresh scaffold reads `minimal`. Doctor's known-jobs warning keys on the same shared classifier.

A Project Script invoked through the namespace (`discern <script>`) is project-authored and still counts: the predicate matches the built-in verb set, not the `discern` program name.

Explicitly not done: the seed is unchanged (tidy stays wired and the gate still runs it), and the exclusion is not an exact-string match on `discern tidy` — any built-in verb in a job command is equally self-supplied, and a new verb enrols the moment it joins `KNOWN_VERBS`.

## Consequences

A skeptic pointing discern at an empty repository now gets the floor verdict and the honest copy, and doctor warns until a real check is wired. The completion report can only improve by wiring genuine project commands.

The `state` enum on the wire gains `housekeeping`, a compatibility surface consumers must know. Guards hold the semantics: every `KNOWN_VERBS` member is asserted self-supplied, and the template's canonical `[jobs]` block must assess as `minimal`, so a future seed cannot quietly re-award coverage.

## Alternatives considered

**Stop seeding `discern tidy`.** Restores honesty by removing the cause, but loses canonical formatting on fresh installs and doctor's during-setup guarantee that the tidy hygiene survived the setup agent.

**Classify a tidy-only job as `deferred`.** Avoids the new enum value, but `deferred` is the deliberate `:`/empty "not yet" signal with an inline-comment reason channel; overloading it misreports config that carries neither.

**Exclude the exact string `discern tidy`.** Fixes the instance, not the class: any other self-invocation seeded or hand-wired later would re-create the unearned green, with no forcing function enrolling new verbs.
