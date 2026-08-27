# Open work — discern

The single source of truth for **outstanding work**: verified defects, deferred fixes, known dead code, and at-risk or unmerged work. The [`project/map/`](map/README.md) describes what _currently exists_; this file tracks what's _still owed_.

## For agents (any agent — and the maintainer)

- **When you defer something, descope, or find a real issue you won't fix, record it here.** Don't bury it in private memory, a chat reply, or a lone code comment—the next agent and the maintainer cannot see those.
- **Format:** use one tidy-stable line with an unchecked checkbox, bold title, bounded standalone description, and terminal `Evidence:` field. Wrap live repository-relative paths in code spans. When no checkout artifact can exist, use `Evidence: Owner-only: <concrete external fact>.` instead.
- **When you finish an item, delete it**—the resolving commit is the record. Never leave checked boxes behind.
- **Scope:** this file is for work that outlives the work which discovered it. Track the steps of active work in the agent's own task tooling.
- This is a backlog, not documentation—modal verbs are fine here. Every item must remain pickup-able without session-relative context.

---

<!--
  The severity buckets below are empty by design — a fresh project owes nothing
  yet. Add items under the heading that fits; create a new bucket only if none
  do. Suggested order is most-urgent first.
-->

## 🟠 Cleanup — known dead or slow code

- [ ] **Reduce maximal duplicated clone lines.** Use each census fingerprint and its exact ranges to consolidate incidental copies whose behavior should move together, keep independent-fate implementations distinct, and pin every reduction until the falling ceiling reaches its defensible minimum. Evidence: `scripts/duplication_census.ts`; `tests/duplication_census_test.ts`; `project/map/80-development/maintenance.md`; `discern.toml`.

- [ ] **Eliminate Deno lint suppression directives.** Replace each remaining suppression with compliant code, pin every census reduction, and convert the detector to an always-on zero guard when none remain. Evidence: `scripts/lint_suppressions.ts`; `project/map/80-development/code-conventions.md`.

- [ ] **Eliminate selected site-component gaps.** Render every component emitted for a live route bundle or stop shipping its unused output, pinning each reduction until the deficit reaches zero. Evidence: `scripts/site_component_coverage.ts`; `site/design_system.ts`; `project/map/90-site/the-design-system.md`.

## 🟡 Smaller fixes & polish

- [ ] **Detect duplicated standalone-test preflights before the Gate.** Add a Logbook detector for a green standalone test followed by a full Gate on the same commit and validation configuration, while preserving intentional standalone results. Evidence: `src/engine/logbook/detectors.ts`; `src/engine/logbook/validation_findings.ts`; `tests/engine_patterns_test.ts`.

- [ ] **Detect the hot-test inversion and suggest a canary check job.** Rank test diagnostic classes against stage duration, detect when frequent failures occupy little runtime, and recommend a cheap check-stage canary while retaining the full evidence ranking in structured output. Evidence: `src/engine/logbook/detectors.ts`; `src/engine/logbook/schema.ts`; `tests/engine_patterns_test.ts`; `scripts/canary_registry.ts`; `scripts/canary_audit.ts`; `project/map/_adr/0325-the-canary-job-hears-hot-tests-before-the-full-suite.md`.

- [ ] **Show persistent and external state in the public system map.** Add Git-admin runtime records and optional managed resources to the system diagram without weakening the narrower claim that discern requires no daemon or product database. Evidence: `project/map/00-orientation/system-map.md`; `project/map/70-reference/artifact-ownership.md`; `project/map/30-worktrees/the-resources.md`.

- [ ] **Keep public documentation links inside the public projection.** Remove or repoint contributor-only destinations from published pages and add a projection-aware link guard so an existing source file cannot conceal an unreachable public link. Evidence: `project/map/_private/planning/public-manual-workstreams/6a-corpus-integration-and-coverage.md`; `src/lib/paths.ts`; `src/lib/docs.ts`.

- [ ] **Reconcile the contributor documentation with its live authorities.** Enrol the Canonical sets leaf, reconcile the documented test layers and build ownership, and align the generated ownership inventory with its live registry. Evidence: `project/map/80-development/README.md`; `project/map/80-development/testing.md`; `project/map/80-development/code-conventions.md`; `discern.toml`; `src/shared/paths_registry.ts`.

- [ ] **Provide a supported recovery for main-checkout divergence.** Add a declared operation or bounded workflow that transfers owned tracked and untracked changes into the assigned worktree without guessing ownership. Evidence: `src/shared/hints.ts`; `src/engine/dispatch.ts`.

- [ ] **Complete Canon Editor's remaining structural rung.** Use real launch-copy mileage to choose scaffolded add, retire, and reorder forms, a stage-and-commit composer, and the agent-brief escape hatch for campaign-sized changes. Evidence: `scripts/canon_editor/fields.ts`; `project/map/80-development/canon-editor.md`.

- [ ] **Complete the manual accessibility journeys before site publication.** Exercise VoiceOver, keyboard-only navigation, zoom, narrow viewport, reduced motion, print, and no-JavaScript journeys, then record the supported-browser and release judgment. Evidence: `project/map/_private/planning/public-manual-workstreams/7a-comprehension-and-closeout.md`.

- [ ] **Revisit generated-artifact preservation only with a non-inference design.** Reopen ignored-artifact rescue only when authorship can be established without mistaking stale generated prose for meaningful user edits, or when real incidents justify that trade-off. Evidence: `project/map/_adr/_superseded/0091-rescue-generated-content-before-overwrite.md`; `src/engine/instructions.ts`; `src/lib/skills.ts`.

- [ ] **Define top-level success when instruction compilation fails.** Decide whether setup and upgrade JSON success covers secondary agent-instruction compilation, then apply that result-envelope rule consistently across every affected verb. Evidence: `src/commands/setup.ts`; `src/commands/upgrade.ts`; `src/shared/result.ts`.

- [ ] **Keep HTML comments out of human Map projections.** Strip structural comments from search excerpts and terminal rendering while preserving byte-identical raw Markdown, MCP, and negotiated-text routes. Evidence: `src/lib/docs_search.ts:359`; `src/commands/docs.ts`; `src/lib/markdown.ts`; `project/map/_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md`.

- [ ] **Add the next auto-detected Tier-1 diagnostic formats.** Implement GitHub Actions annotations, TeamCity service messages, and Checkstyle XML in leverage order, with parser fixtures and a failed-job end-to-end guard for each format. Evidence: `src/engine/gate/diagnostics.ts`; `tests/gate_diagnostics_test.ts`; `tests/engine_done_json_test.ts`.

- [ ] **Support declared regex diagnostic formats.** Design the configuration and schema for named file, line, column, rule, and message captures, then feed declared text formats through the shared diagnostic normalizer. Evidence: `src/engine/gate/diagnostics.ts`; `src/engine/gate/plan.ts`; `src/shared/config_schema.ts`.

- [ ] **Give the setup wizard back-navigation through a sequential form.** Adopt the typed sequential-form flow once its step constructors can carry prior values into rerun steps automatically, avoiding cancellation and restart for corrections. Evidence: `src/lib/terminal_interaction.ts:668-785`.

## 🟢 Test & tooling hygiene

- [ ] **Publish the opt-in managed GitHub gate after launch.** Replace the one-shot scaffold with a deterministic ejectable workflow after release assets and managed-version authority exist, then add annotations, summaries, and deferred-Standard measurement. Evidence: `project/map/_private/planning/managed-ci-workstreams`; `.github/workflows`.

- [ ] **Follow up the Vale upgrades.** ADR 0337 was necessary because a local Homebrew upgrade of Vale created a version mismatch with the codebase. That was worked around, but the longer-term issue is that the upgraded Vale version changed its parser to detect many more previously undetected issues. The newer version should be considered 'correct', but due to ongoing work the project's pinned version stayed the same. Update the project's pinned Vale to its latest release, then fix the previously undetected issues it finds. Evidence: `project/map/_adr/0337-vale-self-provisions-from-tracked-release-integrity.md`

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing outstanding._

## ⚪ Explorations / ideas (unscheduled)

_Nothing outstanding._

## 📣 Marketing & positioning

_Product positioning, messaging, and launch/content tasks._

- [ ] **Lower the public-site reading-grade ceiling before publication.** Tighten the reading-grade limit after the landing copy settles, review its pinning margin, and retain only defensible headroom. Evidence: `discern.toml`; `scripts/site_reading_grade.ts`.

- [ ] **Restore the public-site prose-density Standard.** Measure the final public corpus and re-enable its prose-density baseline after launch wording stops moving. Evidence: `discern.toml`; `scripts/site_prose.ts`.

- [ ] **Make the advertised Homebrew installation real.** Stand up the tap before publication or change the plaintext edition to the installation path that will actually exist. Evidence: `site/text/discern.txt`.

- [ ] **Create the Deno Deploy application and point DNS.** Carry out the maintainer-owned account and DNS steps on the current Deno Deploy service before the public site launches. Evidence: `project/map/90-site/publishing.md`.

- [ ] **Make author-once agent wiring a first-class message.** Elevate discern's one-source compilation into vendor-specific instructions, skills, MCP, and hooks from a buried capability to a headline external principle. Evidence: `project/instructions.md`; `src/engine/instructions.ts`; `site`.

- [ ] **Use self-hosting as launch credibility.** Show that discern is developed under its own gate so launch material demonstrates a practiced workflow rather than a theoretical one. Evidence: `discern.toml`; `README.md`.

- [ ] **Explore the project-gets-smarter positioning.** Test language that explains how captured lessons enter durable project surfaces and become available to every future agent. Evidence: `templates/skills/discern-teach-the-project/SKILL.md`; `site`.

- [ ] **Explore taste as the human contribution.** Develop careful positioning for human technical and creative direction as the durable quality bar behind agent-written implementation, respecting the public voice constraints around the word taste. Evidence: `templates/skills/discern-write-it-once/SKILL.md`; `project/skills/discern-brand-voice/SKILL.md`.

- [ ] **Explore grows-your-discernment as a marketing angle.** Test whether teaching reusable categories of judgment can frame discern as a mentor that compounds for an enthusiastic audience still building its own quality instincts. Evidence: `templates/skills/discern-write-it-once/SKILL.md`; `site`.

## 👨‍💻 Jack's Odds and Ends

_Small things Jack finds while reviewing code and documentation; cleaned up periodically in maintenance batches._

- [ ] **Teach the Map as a distinct project-knowledge artifact.** Explain that the Map records agent navigation knowledge while a project's chosen human documentation can serve a separate audience and purpose. Evidence: `project/map/_private/planning/public-manual-workstreams/4c-explanations.md`; `project/map/_private/planning/public-manual-workstreams/6a-corpus-integration-and-coverage.md`.

- [ ] **Complete the public-manual programme before launch.** Replace the filtered-Map manual with a dedicated kind-aware human corpus, retain the Map as trust evidence, deliver every surface, and pass the voice and comprehension stops. Evidence: `project/map/_private/planning/public-manual-workstreams/README.md`; `project/map/_adr/0314-separate-public-manual-and-project-map.md`.
