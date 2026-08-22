# ADR 0021: Migrations insert a new section's documented block at its canonical position

> **Amendments.**
>
> - **Vocabulary ([ADR 0137](0137-project-scripts-live-under-the-script-command.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** the `[recipes]` references below record the historical migration — live config uses `[scripts]` — and current pointers use `[jobs]` / `[jobs.<name>]`, known/custom `job` (formerly `[capabilities]` / `[checks.<name>]`, gate `capability` / custom `check`); the documented-block decision is unchanged.

**Status**: accepted

## Context

A fresh `discern setup` lays the whole config template down, so the config it produces reads well: every section preceded by its `# ───` documentation paragraph, in a deliberate order, `[meta]` first. The [migration chain](0014-versioned-migration-system.md) evolves an _existing_ config in place and is deliberately **only-if-absent / never-clobber** — it must never touch a value or comment the user wrote.

Within that constraint the migration added sections the cheapest way the comment-preserving editor ([ADR 0005](0005-declarative-config.md)) offered: a bare key edit, which **appends a new section as bare keys at EOF**. So the `5 → 6` step ([ADR 0020](0020-dissolve-discern-dir.md)) — which introduces `[features]`, `[guidance]`, `[skills]` — dumped them, undocumented, at the bottom of the file, in the reverse of the template's order. The longer a project had existed, the worse its config read: a fresh install was fully documented, an upgraded one was bottom-heavy and bare. The same edge bit `[meta]`: a manifest-anchored install with no `[meta]` got a bare one appended at EOF by the schema stamp, when it should lead the file.

Living with this on a real downstream project, the only way to get a readable config back was to **hand-copy the doc blocks out of the template** — exactly the papercut. The migration's safety property (append-only, only-if-absent) is worth keeping; the question was how to give a migrated config a fresh install's quality _within_ it.

## Decision

**When a migration adds a wholly-absent section, it inserts that section's canonical block — its doc-comment paragraph, header, and body — verbatim from the bundled template, at the section's canonical position.** The template stays the single source of the documentation prose; `sectionBlockFromTemplate` (`src/lib/config_template.ts`) reads it, and `TomlEditor` gains `insertSectionBlockAfter` / `insertSectionBlockAtTop` to place a documented block at a chosen position instead of bare-appending at EOF.

Concretely, the `5 → 6` step now:

- inserts `[features]`, `[guidance]`, `[skills]` — each with its doc block — grouped after `[project]`;
- gives a `[meta]`-less install a documented `[meta]` **first**, so the schema stamp updates it in place rather than appending a bare one at EOF;
- repoints a dead `[recipes].dir` default the same way.

Supporting changes keep the result coherent: `[guidance]`/`[skills]` are grouped **beside `[features]`** near the top of the template (so the inserted group reads as one), and the recipe-contract prose is stated positively rather than by negation against the retired shell engine.

The explicit **no**s:

- **The safety contract is unchanged.** Insertion happens only when a section is _wholly absent_. A section already partly present falls back to a per-key, only-if-absent edit (never clobbering a hand edit); a section already present is left exactly as the user has it. An existing `[meta]` is never moved.
- **No `discern config normalize` / `upgrade --reformat`.** A command that rewrites the whole config in template order was considered and rejected (see below): the papercut is about migration _output_, and fixing it at the point of insertion is lossless and simpler.
- **No doctor-only nudge as the fix.** Pointing at a manual remedy fails the bar ("a user shouldn't have to hand-copy doc blocks"). `doctor` does gain a _separate, advisory_ nudge — a `[jobs.<name>]` whose name and stage mirror a free known job — but that is symmetry with an existing check, not the remedy for this.

## Consequences

- A migrated config reads like a fresh init's: documented sections, in canonical order, `[meta]` first. The downstream hand-copy workaround is gone, and a long-lived project's config no longer degrades over time.
- The migration now reads the bundled template at upgrade time. That dependency already existed (the same step reads bundled skills). If the template can't be resolved, sections are still added — functional, just undocumented — so an upgrade never fails for want of a template. A test covers this fallback.
- The extractor is **template-shaped, not a general TOML parser**: it relies on the template's regular structure (a `# ───` doc paragraph per documented section; `[meta]` documented inline, with the file preamble never mistaken for its doc block). A future template restructure must preserve that shape; `config_template` tests guard it.
- The change is idempotent and lossless: re-running a migration inserts nothing the second time, and user comments, values, and custom sections are never rewritten.

## Alternatives considered

- **An explicit `config normalize` / `upgrade --reformat` that rewrites the whole config in template order with doc blocks.** Rejected as the primary fix: faithfully preserving every user comment and every custom-section body through a full re-render is hard and risky, and it solves a broader problem than the one observed. The papercut is specifically that the _migration_ emits bare sections; fixing it where the section is created is surgical and cannot lose user content. (Such a command remains a reasonable future addition for configs that drifted for other reasons — it would reuse `sectionBlockFromTemplate`.)
- **A `doctor` advisory pointing at a one-command fix.** Rejected as insufficient on its own: it still leaves the user to act. It is useful only as a backstop for configs already migrated under the old behaviour.
- **Hardcode the doc-comment blocks in the migration.** Rejected: it duplicates the template's prose and would drift from it. Reading the template keeps one source of truth.
