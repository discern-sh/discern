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

- [ ] **Stabilize queue-history readiness.** Make the queue-history regression wait for the observation it asserts: the initial waiting line precedes the optional activity read, so releasing the slot holder on that line can erase the expected history. Preserve the real capacity-wait boundary. Evidence: `tests/engine_queue_test.ts`; `src/engine/test_run_slots.ts`; `project/map/_private/coverage-partition-overlap-live.json`.
- [ ] **Reconcile existing Standard proposals atomically.** Let one proposal batch remeasure and renew unchanged live proposals alongside new or changed proposals, preserving exact-tree binding without caller-managed sibling staleness; until then the batch must refuse any new proposal when existing proposal state is present, before measuring or writing. Evidence: `src/engine/gate/standard_proposals.ts`; `tests/engine_standard_limit_proposals_test.ts`; `project/map/20-quality-gate/standards.md`.
- [ ] **Investigate carrying Proof across proposal commits.** Determine whether a failed gate whose only failure is a Standard comparison can carry eligible component receipts and exact measurement evidence across discern's controlled config-only proposal commit, while refusing the fast path for candidate-bound producers or inputs affected by the limit change. Evidence: `src/engine/gate/standard_proposals.ts`; `src/engine/completion/evidence.ts`; `project/map/20-quality-gate/standards.md`.

## Setup and recovery

- [ ] **Review the improvement suggestions.** Assess whether job progress reporting and the concurrent-test limit deserve advisory improvement rules, and seek owner approval before changing how projects are scored. Evidence: `src/engine/improve/rules.ts`; `project/map/_private/planning/completion-workstreams/evidence/7c.md`.
- [ ] **Exercise worktree resources in discern itself.** Choose a useful per-worktree resource, such as a local site server, to exercise creation, recovery, and cleanup during ordinary development. Evidence: `src/engine/worktree/resources.ts`; `discern.toml`; `project/map/_adr/0025-worktree-resources.md`.

## Code and documentation maintenance

- [ ] **Reduce duplicated code.** Use the duplication census to consolidate copies that should change together, preserve independently evolving implementations, and pin each measured reduction. Evidence: `scripts/duplication_census.ts`; `project/map/80-development/maintenance.md`; `discern.toml`.
- [ ] **Remove remaining lint suppressions.** Replace suppression directives with compliant code, pin each reduction, and keep a permanent zero-count guard once none remain. Evidence: `scripts/lint_suppressions.ts`; `project/map/80-development/code-conventions.md`; `discern.toml`.
- [ ] **Reduce unused site-component output.** Render components included in live route bundles or stop shipping their unused output, reducing the measured component gaps toward zero. Evidence: `scripts/site_component_coverage.ts`; `site/design_system.ts`; `project/map/90-site/the-design-system.md`.
- [ ] **Upgrade Vale and fix the findings it reveals.** Evaluate a newer Vale release, update the tracked version and integrity data, and correct the additional prose issues while preserving the quality standard. Evidence: `.vale-version`; `scripts/vale_toolchain.ts`; `project/map/_adr/0337-vale-self-provisions-from-tracked-release-integrity.md`.
- [ ] **Bring contributor documentation up to date.** Add the missing Canonical sets link and reconcile descriptions of test layers, build ownership, and generated files with their live authorities. Evidence: `project/map/80-development/README.md`; `project/map/80-development/testing.md`; `project/map/80-development/code-conventions.md`; `src/shared/paths_registry.ts`.

## Public site follow-ups

- [ ] **Review checkout locking for long-running project scripts.** Let a site watcher coexist with preparation in its worktree through an appropriate script capability or per-script locking policy, while preserving exclusion for scripts that mutate protected checkout state. Evidence: `src/engine/project_scripts.ts`; `src/engine/operation_execution.ts`; `src/engine/operation_lock.ts`; `project/scripts/site-watch`.

- [ ] **Convert the document shell to package React components.** Move the corpus shell into the shared site UI while retaining raw editions, workflow directives, glossary hooks, navigation, and search. Evidence: `site/docs.tsx`; `site/ui/`; `project/map/90-site/authoring.md`.
- [ ] **Decide on React browser hydration when a page needs it.** Introduce a browser entrypoint, consistent initial state, and suitable development feedback with the first interaction requiring React effects or event handlers. Evidence: `site/ui/Document.tsx`; `project/map/90-site/authoring.md`.

## Launch checks and public evidence

- [ ] **Validate the manual with readers and accessibility journeys.** Once launch entry pages are settled, test comprehension with fresh readers, complete screen-reader, keyboard, zoom, mobile, reduced-motion, print, no-JavaScript, browser, and terminal journeys, and record the owner's release judgment. Evidence: `project/map/_private/planning/public-manual-workstreams/7a-comprehension-and-closeout.md`.
- [ ] **Confirm production hosting and DNS are ready.** Verify the owner-managed Deno Deploy application, release credentials, custom domains, and DNS against the publishing checklist, then complete any missing setup. Evidence: `project/map/90-site/publishing.md`; `.github/workflows/release.yml`.
- [ ] **Tie the machine edition's claims to real checks.** Generate its checkable claims from entries that name the tests or checks supporting them, so published claims and validation cannot drift apart. Evidence: `site/text/discern.txt`; `scripts/brand/claims.ts`; `tests/evidence_basis_guard_test.ts`.
- [ ] **Link homepage claims to their evidence.** Give material landing-page claims typed references to the claims registry and enable the deferred claim-annotation check. Evidence: `site/ui/pages/HomePage.tsx`; `site/ui/pages/TrustPage.tsx`; `scripts/brand/vale.ts`.
- [ ] **Keep evidence illustrations tied to their dated source.** Generate the site's quality-trajectory figures from a recorded snapshot or test them against it so each illustration stays consistent with the date and evidence it cites. Evidence: `site/ui/pages/SpecimensPage.tsx`; `project/map/_private/brand/claims-residue.md`.

## Public contract follow-ups

- [ ] **Split contract enforcement between the gate and a checkpoint.** Add an enforcement mode to each public schema publication: keep the hard guard for `discern.toml`, the setup config document, the proof note, conventions, and releases, and move the CLI, MCP tools, and results publications to a stop-mode `[checkpoints.public-contract]` whose `when` script fires only on compatibility issues the branch introduces beyond the trunk, so an owner variance lands a deliberate deprecation with its record in Proof. Evidence: `src/shared/public_schemas.ts`; `scripts/public_schema_compatibility.ts`; `tests/public_schema_compatibility_guard_test.ts`; `discern.toml`.
- [ ] **Capture the first tagged install as a fixture.** Run the tagged binary against a sample repository and commit the resulting `discern.toml`, provider files, and landing note, so the first schema migration and later upgrade tests start from a real install rather than a synthetic one. Evidence: `src/lib/migrations.ts`; `project/map/_adr/0219-public-install-schema-starts-at-one.md`.
- [ ] **Test upgrade and version skew against the last tag.** Run `discern upgrade` on the tagged fixture with the new binary, and run the tagged binary against a repository the new binary wrote, asserting every registered forward-skew policy holds. Evidence: `src/shared/on_disk_formats.ts`; `src/commands/upgrade.ts`.
- [ ] **Keep a proof-note reader corpus.** Commit one sample note per published proof-note major and decode each with the current reader, so notes already in Git history stay readable. Evidence: `src/engine/gate/proof_notes.ts`; `schema/discern-proof-note.schema.json`.
- [ ] **Require a migration for every durable break.** When the config-input comparison reports an incompatibility after the first tag, fail unless a migration step and a dead-position epitaph accompany it. Evidence: `scripts/public_schema_compatibility.ts`; `src/lib/migrations.ts`; `src/shared/vocabulary.ts`.
- [ ] **Add per-flag and per-input stability.** The `stability` field on a result contract marks a whole command, tool, and result together; add the same fact on one flag or one tool input once a stable command needs an evolving option. Help text and tool descriptions stay unmarked by decision: agents re-read them every session. Evidence: `src/shared/result_contracts.ts`; `src/shared/cli_reference_codegen.ts`; `src/engine/mcp/server.ts`.
- [ ] **Publish the contract digest as an internal generated inventory.** Move the digest from the private review into `project/map/_internal/` under a generated-inventory policy so codegen keeps it current. Evidence: `scripts/contract_digest.ts`; `scripts/generated_inventory_policy.ts`.

## Diagnostics

- [ ] **Recognize more diagnostic formats.** Add parsers for GitHub Actions annotations, TeamCity messages, and Checkstyle XML, with fixtures and a failed-job test for each format. Evidence: `src/engine/gate/diagnostics.ts`; `tests/gate_diagnostics_test.ts`; `tests/engine_done_json_test.ts`.

## Editing tools

- [ ] **Extend Canon Editor to consequences and readiness.** Add consequence fields and, when question editing is needed, readiness questions, approaches, and routes through the editor's existing projections and pickers. Evidence: `scripts/brand/consequences.ts`; `scripts/brand/readiness.ts`; `scripts/canon_editor/fields.ts`; `scripts/canon_editor/registry_ast.ts`.
- [ ] **Add structural editing and commit support to Canon Editor.** Use real editorial work to decide which add, retire, reorder, and stage-and-commit controls are worth building. Evidence: `scripts/canon_editor/fields.ts`; `project/map/80-development/canon-editor.md`.
- [ ] **Explore Docs Studio after launch.** Specify a local worktree-based editor for the public manual with live production previews, validation, document management, and review through discern's existing completion and landing workflow. Evidence: `project/manual/`; `src/lib/manual.ts`; `site/docs.tsx`; `project/map/_adr/0314-separate-public-manual-and-project-map.md`.
