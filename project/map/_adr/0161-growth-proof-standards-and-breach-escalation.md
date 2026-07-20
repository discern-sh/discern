# ADR 0161: Standards hold growth-proof numbers, and a breach from the work itself escalates

**Status**: accepted; extends [ADR 0057](0057-rate-standards.md) and [ADR 0133](0133-standards-join-the-gate.md), and revisits the programme-end settlement of [ADR 0154](0154-launch-standards-recalibrated-to-the-public-corpus.md)

## Context

A standard is a number that can never get worse, and the doctrine around a fired one said: never loosen the limit, move the metric the right way. That instruction assumed every metric movement is healthy. It is not. Four of the repo's standards were ceilings on totals that rise whenever the project healthily grows — the largest rendered docs page, the docs CSS and JavaScript bundles, and the search index — each pinned at (or within tens of bytes of) its measured value. ADR 0154 closed the launch programme by pinning the index at "zero headroom", noting the next addition "must either pay for itself elsewhere or come back to the owner".

Determined agents chose "elsewhere", every time. Documenting one feature (a new reference leaf) breached the index and page ceilings, and the branch answered with size engineering unrelated to its task: stripping table pipes from the search projection, flattening template whitespace that existed for readability. An earlier toolchain update moved the compiled binary's byte count on its own, and the responding agent replaced an installed JSR YAML parser with a hand-rolled one to claw the bytes back. Each commit was individually defensible and honestly described; the pattern makes the codebase harder to reason about while every measured number improves. The mechanism is general: a gate that measures N dimensions pushes optimization pressure into the dimensions it does not measure, and with autonomous agents the gate is the only reviewer present, so all of the pressure lands there. The agents were not working around the doctrine — they were obeying it. The doctrine was wrong.

## Decision

Numbers are sorted before they are held, and the sort is authoring doctrine at every surface (config schema, CLI and MCP descriptions, the config template, the bundled skill, the standards page):

- An **invariant** a healthy project never adds (suppressions, a banned pattern) holds the raw count.
- A **quality that scales** (coverage, alert density) holds a rate via `per`.
- A **growing total** rises with every shipped feature. It is held only with a `margin` and an owner who treats raising the limit as routine; pinned raw at today's value it gates growth, not regression.

A fired standard now names two legal responses in its own breach diagnostic: waste the change added is removed within the task's scope; growth the work itself caused is reported to the owner, and offsetting it with unrelated edits is worse than the breach. The never-loosen gate check is untouched — a branch still cannot loosen or delete a limit at all.

The repo's own set recalibrates accordingly, on the trunk, at the owner's instruction: `docs_page_size` and `docs_search_index_size` are dropped (growing totals whose breaches were overwhelmingly legitimate growth); `docs_css_size` and `docs_js_size` are dropped (the browser frontend moved to the `@discern-sh/design-system` package, whose repository holds its own budgets); `public_doc_leaf_density` keeps its rate form but re-floors from 12.68 to 12.18 with `margin = 0.5`, keeping room to deepen existing pages; `binary_size` stays despite its toolchain sensitivity, because it has caught agents installing unexpected dependencies; `coverage`, `prose`, and `guidance` stay unchanged.

What this decision does **not** do: it adds no bypass. A breach still fails the gate, and the escalation it instructs ends in an owner edit on the trunk. A receipt-recorded override adjudicated at `accept` (`discern standards override`) is designed in outline in the project TODO and deliberately deferred.

## Consequences

- Documentation and features can grow without triggering size engineering on unrelated code; the standards that remain move only when quality moves.
- The doctrine is now stated at the moment of temptation — the breach diagnostic itself — rather than only in guidance an agent may summarize away.
- Nothing mechanically bounds the docs site's page or index size anymore. A pathological page will be caught by review, not by the gate. That is the accepted cost of removing a ceiling that mostly gated healthy growth.
- `binary_size` keeps its known false positive: a toolchain jump can breach it with no tree change at fault. Until the override verb exists, that ends in an owner-adjudicated trunk edit, which is judged acceptable for a rare event with real catch value.
- `guidance` remains a raw-total ceiling on purpose: its words are context every agent pays for in every session, so "adding words must hurt" is the product claim, and doctrine additions must displace weaker material to fit.

## Alternatives considered

- **Margins on the dropped ceilings.** Rejected: a margin on a monotonically growing total only schedules the next collision; the incentive at collision time is unchanged.
- **Converting the index ceiling to a rate** (index bytes per 1,000 public words). Viable and compatible with this decision, but deferred: no current claim about index efficiency is worth a standard, and `prose` plus `public_doc_leaf_density` already hold the corpus's quality.
- **Building the override verb first.** Sequenced later on purpose: the doctrine and the recalibration remove today's perverse incentive without new machinery; the verb needs receipt and accept design work recorded in the TODO.
