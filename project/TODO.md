# Open work — discern

Small outstanding fixes and improvements, grouped by subject for review. Groups do not imply priority. The [map](map/README.md) describes what exists; this file records what remains to fix or decide.

This tracked backlog publishes with the repository by design. It records inspectable outstanding work, not a promised roadmap; private research and launch material stay in the `_private` overlay.

## For agents (any agent — and the maintainer)

- **Record deferred work in the project.** Use the scope rule below to choose its home; private memory, chat replies, and lone code comments do not make work discoverable to the next agent or maintainer.
- **Format:** use one tidy-stable line with an unchecked checkbox, bold title, bounded standalone description, and terminal `Evidence:` field. Wrap live repository-relative paths in code spans. When no checkout artifact can exist, use `Evidence: Owner-only: <concrete external fact>.` instead.
- **When you finish an item, delete it**—the resolving commit is the record. Never leave checked boxes behind.
- **Scope:** keep small leftovers that outlive the effort which discovered them in this file; larger programmes belong in `project/map/_private/planning/` workstreams and must not be duplicated here. Omit routine workflow actions such as pinning improved standards, and track active task steps in the agent's own task tooling.
- This is a backlog, not documentation—modal verbs are fine here. Every item must remain pickup-able without session-relative context.

## Gate performance and reliability

- [ ] **Reduce coverage-report overhead.** Reduce profile filesystem costs using a new matched-input approach after the recorded disposal and concurrency comparisons failed to improve large-corpus elapsed time, while preserving complete native LCOV evidence. Evidence: `scripts/coverage.ts`; `scripts/coverage_profiles.ts`; `project/map/_private/gate-performance.md`.

## Setup and recovery

- [ ] **Review the improvement suggestions.** Assess whether job progress reporting and the concurrent-test limit deserve advisory improvement rules, and seek owner approval before changing how projects are scored. Evidence: `src/engine/improve/rules.ts`; `project/map/_private/planning/completion-workstreams/evidence/7c.md`.
- [ ] **Exercise worktree resources in discern itself.** Choose a useful per-worktree resource, such as a local site server, to exercise creation, recovery, and cleanup during ordinary development. Evidence: `src/engine/worktree/resources.ts`; `discern.toml`; `project/map/_adr/0025-worktree-resources.md`.

## Code and documentation maintenance

- [ ] **Reduce duplicated code.** Use the duplication census to consolidate copies that should change together, preserve independently evolving implementations, and pin each measured reduction. Evidence: `scripts/duplication_census.ts`; `project/map/80-development/maintenance.md`; `discern.toml`.
- [ ] **Remove remaining lint suppressions.** Replace suppression directives with compliant code, pin each reduction, and keep a permanent zero-count guard once none remain. Evidence: `scripts/lint_suppressions.ts`; `project/map/80-development/code-conventions.md`; `discern.toml`.
- [ ] **Reduce unused site-component output.** Render components included in live route bundles or stop shipping their unused output, reducing the measured component gaps toward zero. Evidence: `scripts/site_component_coverage.ts`; `site/design_system.ts`; `project/map/90-site/the-design-system.md`.
- [ ] **Upgrade Vale and fix the findings it reveals.** Evaluate a newer Vale release, update the tracked version and integrity data, and correct the additional prose issues while preserving the quality standard. Evidence: `.vale-version`; `scripts/vale_toolchain.ts`; `project/map/_adr/0337-vale-self-provisions-from-tracked-release-integrity.md`.
- [ ] **Bring contributor documentation up to date.** Add the missing Canonical sets link and reconcile descriptions of test layers, build ownership, and generated files with their live authorities. Evidence: `project/map/80-development/README.md`; `project/map/80-development/testing.md`; `project/map/80-development/code-conventions.md`; `src/shared/paths_registry.ts`.

## Launch checks and public evidence

- [ ] **Validate the manual with readers and accessibility journeys.** Once launch entry pages are settled, test comprehension with fresh readers, complete screen-reader, keyboard, zoom, mobile, reduced-motion, print, no-JavaScript, browser, and terminal journeys, and record the owner's release judgment. Evidence: `project/map/_private/planning/public-manual-workstreams/7a-comprehension-and-closeout.md`.
- [ ] **Confirm production hosting and DNS are ready.** Verify the owner-managed Deno Deploy application, release credentials, custom domains, and DNS against the publishing checklist, then complete any missing setup. Evidence: `project/map/90-site/publishing.md`; `.github/workflows/release.yml`.
- [ ] **Tie the machine edition's claims to real checks.** Generate its checkable claims from entries that name the tests or checks supporting them, so published claims and validation cannot drift apart. Evidence: `site/text/discern.txt`; `scripts/brand/claims.ts`; `tests/evidence_basis_guard_test.ts`.
- [ ] **Link homepage claims to their evidence.** Give material landing-page claims typed references to the claims registry and enable the deferred claim-annotation check. Evidence: `site/page-src/clarity-first.tsx`; `site/page-src/trust.tsx`; `scripts/brand/vale.ts`.
- [ ] **Keep evidence illustrations tied to their dated source.** Generate the site's quality-trajectory figures from a recorded snapshot or test them against it so each illustration stays consistent with the date and evidence it cites. Evidence: `site/page-src/specimens.tsx`; `project/map/_private/brand/claims-residue.md`.

## Diagnostics

- [ ] **Recognize more diagnostic formats.** Add parsers for GitHub Actions annotations, TeamCity messages, and Checkstyle XML, with fixtures and a failed-job test for each format. Evidence: `src/engine/gate/diagnostics.ts`; `tests/gate_diagnostics_test.ts`; `tests/engine_done_json_test.ts`.

## Editing tools

- [ ] **Extend Canon Editor to consequences and readiness.** Add consequence fields and, when question editing is needed, readiness questions, approaches, and routes through the editor's existing projections and pickers. Evidence: `scripts/brand/consequences.ts`; `scripts/brand/readiness.ts`; `scripts/canon_editor/fields.ts`; `scripts/canon_editor/registry_ast.ts`.
- [ ] **Add structural editing and commit support to Canon Editor.** Use real editorial work to decide which add, retire, reorder, and stage-and-commit controls are worth building. Evidence: `scripts/canon_editor/fields.ts`; `project/map/80-development/canon-editor.md`.
- [ ] **Explore Docs Studio after launch.** Specify a local worktree-based editor for the public manual with live production previews, validation, document management, and review through discern's existing completion and landing workflow. Evidence: `project/manual/`; `src/lib/manual.ts`; `site/docs.ts`; `project/map/_adr/0314-separate-public-manual-and-project-map.md`.
