# Open work — discern

The single source of truth for **outstanding work**: verified defects, deferred fixes, known dead code, and at-risk or unmerged work. The [`project/map/`](map/README.md) describes what _currently exists_; this file tracks what's _still owed_.

This tracked backlog publishes with the repository by design, including its marketing and positioning work. An entry records inspectable outstanding work, not a promised roadmap; private research and private launch material stay in the `_private` overlay.

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

- [ ] **Cut the coverage producer's profile-handling cost.** The measured failure run spent 364 s on profile and report work and 228 s classifying 1.8 million raw profiles after an 1,863 s suite; a controlled profile-handling comparison is the recommended next probe before any other gate-cost work. Evidence: `scripts/coverage.ts`; `project/map/_private/planning/completion-workstreams/evidence/6b.md`.
- [ ] **Reduce maximal duplicated clone lines.** Use each census fingerprint and its exact ranges to consolidate incidental copies whose behavior should move together, keep independent-fate implementations distinct, and pin every reduction until the falling ceiling reaches its defensible minimum. Evidence: `scripts/duplication_census.ts`; `tests/duplication_census_test.ts`; `project/map/80-development/maintenance.md`; `discern.toml`.

- [ ] **Eliminate Deno lint suppression directives.** Replace each remaining suppression with compliant code, pin every census reduction, and convert the detector to an always-on zero guard when none remain. Evidence: `scripts/lint_suppressions.ts`; `project/map/80-development/code-conventions.md`.

- [ ] **Eliminate selected site-component gaps.** Render every component emitted for a live route bundle or stop shipping its unused output, pinning each reduction until the deficit reaches zero. Evidence: `scripts/site_component_coverage.ts`; `site/design_system.ts`; `project/map/90-site/the-design-system.md`.

## 🟡 Smaller fixes & polish

- [ ] **Run one shared producer command once per gate.** Four standard groups run one identical command each, nine repeated runs per gate: the ambient-boundaries task seven times, the process-boundaries and lint-suppressions tasks twice each, and the promise-effects task for both the job and a standard; the gate should run an identical command once and credit every standard that shares it, with a doctor note, instead of asking projects to restructure configuration. Evidence: `discern.toml`; `src/engine/gate/standard_plan.ts`.
- [ ] **Decide the setup checks that misread this repository.** The marker scan reads quoted skeleton text in three ADRs and one private page as unfinished setup, the design-principles check wants three level-2 headings on a page written in another shape, and the primary-region check expects sections the first map directory's README lacks; decide per check between satisfying it as written and narrowing it. Evidence: `src/shared/setup_checks.ts`; `project/map/_private/planning/completion-workstreams/evidence/8a.md`.
- [ ] **Audit the configuration schema for settings that do nothing.** Every combination a project can declare that changes no behaviour should carry a notice on status and done, with a guard, so no setting goes quietly inert; the early-checking notice was the first instance and retires with its setting. Evidence: `src/shared/config_schema.ts`.
- [ ] **Prevent concurrent site asset rebuilds during type-checking.** The site-component measurement calls `buildSite()` while the gate runs `deno check`; removing and recreating its generated JavaScript can cause transient missing-module failures. Measure a completed build or isolate measurement output while preserving fresh standalone measurement. Evidence: `scripts/site_component_coverage.ts`; `site/build.ts`; `discern.toml`; `deno.json`.

- [ ] **Complete the Git ref footprint inventory.** Enrol shared candidate refs and landing markers in the canonical footprint, align uninstall's retained-ref reporting with the actual created namespaces, and guard future ref writers against missing inventory entries. The manual describes current retention, but the runtime inventory omits these namespaces. Evidence: `src/engine/git_footprint.ts`; `src/shared/git_conventions.ts`; `src/engine/landing_queue/publication.ts`; `src/engine/worktree/git.ts`; `project/manual/30-reference/files-and-ownership.md`.

- [ ] **Bind the machine edition's checkable claims to their guards.** The "Checkable claims" section names six falsifiers as hand-authored prose; render it from a registry whose entries cite the guard test that proves each one, so the section and the suite cannot drift. Evidence: `site/text/discern.txt`; `scripts/brand/claims.ts`; `tests/evidence_basis_guard_test.ts`.

- [ ] **Cite claim slugs from the public landing copy.** The trust page declares its claims as typed slug references that its test resolves; the landing copy carries none, and the `claim-annotation` mechanical check stays deferred for want of an authority. Give the fresh landing copy typed claim citations and lift the deferral. Evidence: `site/page-src/trust.tsx`; `scripts/brand/vale.ts`; `tests/site_trust_test.ts`.

- [ ] **Derive the site's evidence specimen figures from the recorded snapshot.** The specimens page hard-codes dated Standard-trajectory numbers in source; read them from the recorded snapshot at build time, or hold them to it with a test, so the page cannot drift from the evidence it cites. Evidence: `site/page-src/specimens.tsx`; `project/map/_private/brand/claims-residue.md`.

- [ ] **Reconcile the contributor documentation with its live authorities.** Enrol the Canonical sets leaf, reconcile the documented test layers and build ownership, and align the generated ownership inventory with its live registry. Evidence: `project/map/80-development/README.md`; `project/map/80-development/testing.md`; `project/map/80-development/code-conventions.md`; `discern.toml`; `src/shared/paths_registry.ts`.

- [ ] **Provide a supported recovery for main-checkout divergence.** Add a declared operation or bounded workflow that transfers owned tracked and untracked changes into the assigned worktree without guessing ownership. Evidence: `src/shared/hints.ts`; `src/engine/dispatch.ts`.

- [ ] **Complete Canon Editor's remaining structural rung.** Use real launch-copy mileage to choose scaffolded add, retire, and reorder forms and a stage-and-commit composer. Evidence: `scripts/canon_editor/fields.ts`; `project/map/80-development/canon-editor.md`.

- [ ] **Complete the manual accessibility journeys before site publication.** Exercise VoiceOver, keyboard-only navigation, zoom, narrow viewport, reduced motion, print, and no-JavaScript journeys, then record the supported-browser and release judgment. Evidence: `project/map/_private/planning/public-manual-workstreams/7a-comprehension-and-closeout.md`.

- [ ] **Revisit generated-artifact preservation only with a non-inference design.** Reopen ignored-artifact rescue only when authorship can be established without mistaking stale generated prose for meaningful user edits, or when real incidents justify that trade-off. Evidence: `project/map/_adr/_superseded/0091-rescue-generated-content-before-overwrite.md`; `src/engine/instructions.ts`; `src/lib/skills.ts`.

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

- [ ] **Create the Deno Deploy application and point DNS.** Carry out the maintainer-owned account and DNS steps on the current Deno Deploy service before the public site launches. Evidence: `project/map/90-site/publishing.md`.

- [ ] **Make author-once agent wiring a first-class message.** Elevate discern's one-source compilation into vendor-specific instructions, skills, MCP, and hooks from a buried capability to a headline external principle. Evidence: `project/instructions.md`; `src/engine/instructions.ts`; `site`.

- [ ] **Use self-hosting as launch credibility.** Show that discern is developed under its own gate so launch material demonstrates a practiced workflow rather than a theoretical one. Evidence: `discern.toml`; `README.md`.

- [ ] **Explore the project-gets-smarter positioning.** Test language that explains how captured lessons enter durable project surfaces and become available to every future agent. Evidence: `templates/skills/discern-teach-the-project/SKILL.md`; `site`.

- [ ] **Explore taste as the human contribution.** Develop careful positioning for human technical and creative direction as the durable quality bar behind agent-written implementation, respecting the public voice constraints around the word taste. Evidence: `templates/skills/discern-write-it-once/SKILL.md`; `project/skills/discern-brand-voice/SKILL.md`.

- [ ] **Enrol the consequence canon in Canon Editor.** Register the consequence registry's fields, pickers, and page in the editor so its prose can be edited on the generated page like the other canons. Evidence: `scripts/brand/consequences.ts`; `scripts/canon_editor/fields.ts`; `scripts/canon_editor/registry_ast.ts`; `project/map/80-development/canon-editor.md`.

- [ ] **Explore grows-your-discernment as a marketing angle.** Test whether teaching reusable categories of judgment can frame discern as a mentor that compounds for an enthusiastic audience still building its own quality instincts. Evidence: `templates/skills/discern-write-it-once/SKILL.md`; `site`.

## Maintainer follow-ups

_Small review findings that remain worth carrying outside an active effort._

- [ ] **Complete the public-manual programme before launch.** Replace the filtered-Map manual with a dedicated kind-aware human corpus, retain the Map as trust evidence, deliver every surface, and pass the voice and comprehension stops. Evidence: `project/map/_private/planning/public-manual-workstreams/README.md`; `project/map/_adr/0314-separate-public-manual-and-project-map.md`.
