# ADR 0259: Generated groups opt in to review metadata; registered Markdown uses heading-aware diffs

**Status**: accepted

## Context

The managed `.gitattributes` block began with one job: mark declared generated artifacts and compiled Agent files with discern's merge driver, so worktree merges can keep one derived copy and regenerate it. Two adjacent review concerns remained unresolved.

GitHub can hide generated files in diffs by default and exclude them from repository language statistics when a path has the `linguist-generated` attribute. [ADR 0211](0211-agent-context-artifacts-carry-no-provenance-marker.md) set this aside because repository metadata did not explain an artifact's source or overwrite contract. The generated-artifact declaration added later supplies that missing context, but applying the presentation policy to every generated group would still make a project-wide review choice on the owner's behalf. Different generators deserve different treatment: a compiled bundle may be noise in ordinary review while a generated reference remains useful to read.

Git also ships a `markdown` diff driver whose hunk headers understand Markdown structure. The driver is built in, but Git does not select it from the `.md` extension: a path must receive `diff=markdown` through attributes. A repo-wide `*.md` rule would improve Map diffs but would also claim review policy over the project's README, hand-curated documentation, and any other Markdown unrelated to discern.

File ownership does not answer the presentation question by itself. The Map, guidance, authored skills, Project Scripts, TODO, and brief are Project-owned after setup, while still being registered discern surfaces. Applying a diff driver changes neither their bytes nor discern's overwrite authority.

## Decision

Each `[generated.<name>]` table has a boolean `linguist_generated`, defaulting to `false`. When true, the managed `.gitattributes` block sets the bare `linguist-generated` attribute on that group's translated `paths`. The choice is local to the declaring group. It does not mark other generated groups or discern's built-in Agent outputs.

The managed block sets `diff=markdown` by default only for Markdown inside discern's registered source surfaces and for active compiled Agent files. Source membership derives from the source-path registry, including configured overrides: the Map, guidance seed, authored skills and scripts trees, deferred-work ledger, and setup brief. It emits exact file patterns or scoped `**/*.md` patterns, never a repository-wide `*.md` rule. A project's Markdown outside those registered paths remains under the project's own attributes policy.

Generated merge attributes, optional Linguist metadata, and Markdown diff attributes compose per pattern in one canonical block. The clone-local shared merge driver is needed only when at least one pattern carries `merge=discern-generated`; Markdown-only attributes never trigger its installation.

`setup`, `refresh`, `upgrade`, and `doctor` all derive the block from the same config, source-path registry, and active Agent registry. Project lines outside the delimiters remain untouched. `uninstall` removes the whole discern block.

## Consequences

- A generated group changes GitHub review presentation only after an explicit per-group choice. The same choice travels with the repository.
- Registered Markdown receives heading-aware local Git hunk headers without taking over unrelated Markdown. Ordinary `.md` files were already usually detected as text; this changes the selected hunk-header and word-diff rules, not whether their contents are text.
- A fresh install now has a `.gitattributes` block even with no `[generated]` tables, because the registered Markdown policy is active by default.
- Moving a registered source path in config moves its Markdown attribute pattern on the next reconciliation. A new source-path registry member joins the policy through the same derivation.
- GitHub's generated-file treatment is presentation metadata, not provenance. The source and regeneration contract remain in `discern.toml`; agent-context artifacts still carry no in-band marker.
- Higher-precedence or later project-owned attribute rules can override an effective attribute. `doctor` currently verifies discern's canonical block, not every effective value after Git's precedence rules; that deeper audit remains separate work.

## Alternatives considered

- **Mark every generated group for Linguist automatically.** Rejected because hiding a generated reference can remove useful review while hiding a bundle can be desirable. The generator owner chooses per group.
- **Add one repository-wide `*.md diff=markdown` rule.** Rejected because discern should not establish review policy for Markdown outside its registered footprint.
- **Leave Markdown attributes entirely to each project.** Rejected because discern defines and scaffolds the Map and other registered Markdown surfaces, and can improve their diffs without reaching into unrelated paths.
- **Put `linguist_generated` on `[scopes]`.** Rejected for the same separation as generated ownership itself: scopes tune gate and review regions, while this flag describes artifacts owned by one generator.
