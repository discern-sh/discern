# Architecture Decision Records — discern itself

This directory holds **discern's own** Architecture Decision Records: short
documents capturing a significant decision about the kit's design, the context
that forced it, and the reasoning behind it.

discern _ships_ the ADR discipline to the projects it scaffolds via its bundled
`write-adr` skill, which creates `docs/_adr/` on demand from its skeleton at
[`templates/skills/write-adr/skeleton/docs/_adr/`](../../templates/skills/write-adr/skeleton/docs/_adr/).
This directory is discern applying that discipline to itself — recording the
decisions behind the engine and installer here, in the same format.

**The canonical ADR format is the one discern ships:**
[`templates/skills/write-adr/skeleton/docs/_adr/README.md`](../../templates/skills/write-adr/skeleton/docs/_adr/README.md),
with the copy-paste template at
[`templates/skills/write-adr/skeleton/docs/_adr/0000-template.md`](../../templates/skills/write-adr/skeleton/docs/_adr/0000-template.md).
Read it before drafting. In brief: number continuously (`NNNN-slug.md`, first
real ADR is `0001`); state the decision in the title; write one only when the
decision is hard to reverse, surprising without context, and a real trade-off.

## Index

- [0001 — Project-owned recipes](0001-project-owned-recipes.md)
- [0002 — First-class side-gates](0002-first-class-side-gates.md)
- [0003 — Named metric ratchets](0003-named-metric-ratchets.md)
- [0004 — Structured `finish --json`](0004-structured-finish-json.md)
- [0005 — Declarative config](0005-declarative-config.md)
- [0006 — Long-slot ergonomics](0006-long-slot-ergonomics.md)
- [0007 — Adapter contract](0007-adapter-contract.md)
- [0008 — Declarative managed-set](0008-declarative-managed-set.md)
- [0009 — 1.0: drop backward compatibility](0009-one-point-zero-drop-backward-compat.md)
- [0010 — Self-host the harness](0010-self-host-the-harness.md)
- [0011 — Adopt the worktree workflow](0011-adopt-worktree-workflow.md)
- [0012 — Engine noglob (`set -f`) by default](0012-engine-noglob-default.md)
- [0013 — Product vocabulary in user-facing output](0013-product-vocabulary-in-user-output.md)
- [0014 — A versioned, reversible migration system](0014-versioned-migration-system.md)
- [0015 — `discern docs` browser + terminal Markdown renderer](0015-docs-browser.md)
- [0016 — Consolidate the install surface under `.discern/`](0016-consolidate-install-surface.md)
- [0017 — Declare capabilities, derive the gate](0017-capabilities-model.md)
- [0018 — Consolidate the harness vocabulary into four layers](0018-vocabulary-consolidation.md)
- [0019 — Collapse into one binary with a TypeScript-native engine](0019-single-binary-ts-engine.md)
- [0020 — Dissolve `.discern/` into a single root `discern.toml`](0020-dissolve-discern-dir.md)
- [0021 — Migrations insert a new section's documented block at its canonical position](0021-migrations-insert-documented-sections.md)
- [0022 — Rename the harness to discern](0022-rename-to-discern.md)
- [0023 — Rename and promote the workflow commands](0023-rename-workflow-commands.md)
- [0024 — Bootstrap is a command, not a skill](0024-bootstrap-as-command.md)
- [0025 — Generalize the db/dev-server adapters into per-worktree resources with orphan GC](0025-worktree-resources.md)
- [0026 — One typed (Zod) config schema as the single source of truth](0026-typed-config-schema.md)
- [0027 — Plan/apply as the engine's execution model](0027-plan-apply-engine-execution.md)
- [0028 — One result envelope per verb, with normalized failure diagnostics](0028-result-envelope-and-diagnostics.md)
- [0029 — A best-practices audit that splits deterministic from subjective rules](0029-best-practices-audit.md)
- [0030 — `--json` is quiet: the envelope is the entire machine output](0030-quiet-json-output.md)
- [0031 — One typed provider registry for every agent-specific integration](0031-typed-provider-integration.md)
- [0032 — The Claude Code mirror imports AGENTS.md instead of duplicating it](0032-claude-md-imports-agents-md.md)
- [0033 — A `status` verb with location-aware scope](0033-status-verb-and-location-aware-scope.md)
- [0034 — AGENTS.md is an untracked build artifact, guarded by a currency check](0034-agents-md-untracked-currency-check.md)
- [0035 — A strict, config-only template engine for the built-in guidance](0035-guidance-templating-engine.md)
- [0036 — Unify init + bootstrap into one zero-config `discern setup`](0036-unify-setup.md)
- [0037 — Setup-incompleteness is an observable state, not a prose handoff](0037-setup-incompleteness-observable.md)
- [0038 — The MCP server runs on the official TypeScript SDK over stdio](0038-official-mcp-sdk.md)
- [0039 — discern ships its own docs to every install via `discern help`](0039-bundled-help-docs.md)
- [0040 — The worktree hooks parse their payload in the binary (no jq)](0040-worktree-hooks-in-the-binary.md)
- [0041 — A self-describing MCP surface built on typed result schemas](0041-self-describing-mcp-surface.md)
- [0042 — Per-agent skills materialization](0042-per-agent-skills-materialization.md)
- [0043 — The provider registry is the enforced single source for every agent surface](0043-registry-derived-agent-parity.md)
- [0044 — Setup involves the user and proceeds; it does not gate every step](0044-setup-involve-not-gate.md)
- [0045 — The MCP server is core infrastructure, not a feature toggle](0045-mcp-is-core-infrastructure.md)
- [0046 — A configurable graduation destination, and removing the handoff-worktree skill](0046-graduate-destination-and-skill-removal.md)
- [0047 — Finish blocks a fix stage that strands uncommitted changes](0047-fix-stage-strand-detection.md)
- [0048 — Rename the graduation landing-role `main` → `trunk`](0048-graduate-trunk-role-name.md)
- [0049 — Ship the fix-the-class discipline as built-in guidance and a bundled skill](0049-bug-class-discipline-built-in.md)
- [0050 — Run the merge check first, as a fail-fast precondition](0050-merge-check-fail-fast.md)
- [0051 — Every internal canonical set is tied to its satellites by a forcing function](0051-canonical-set-parity.md)
- [0052 — Worktrees live in a configurable sibling directory, not nested `.claude/worktrees`](0052-worktree-sibling-placement.md)
- [0053 — A gate guard keeps comments in the present tense, not narrating the codebase's past](0053-comment-currency-guard.md)
- [0054 — One module owns process spawning](0054-subprocess-single-source.md)
- [0055 — `discern integrate`, the third verb in the worktree lifecycle (merge + re-materialize)](0055-integrate-verb.md)
- [0056 — Run the generated-artifact currency checks as fail-fast preconditions too](0056-currency-checks-fail-fast.md)
- [0057 — Ratchet a rate, not a raw count, via an optional `per` denominator](0057-rate-ratchets.md)
- [0058 — `discern start` spawns a worktree from the main checkout, and a status guardrail points at it](0058-start-verb-spawn-worktree-from-trunk.md)
- [0059 — `[worktree.setup].ensure`, a convergent setup bucket that re-runs every pass](0059-worktree-setup-ensure.md)
- [0060 — Worktree shell commands adopt the gate's capture-on-failure output convention](0060-worktree-command-output-capture.md)
- [0061 — Graduate enforces the fix stage's fixed point before landing](0061-graduate-fix-stage-fixed-point.md)
- [0062 — The MCP server tracks its own working root, retiring location-based tool visibility](0062-mcp-server-working-root.md)
- [0063 — `discern doctor` prints the execution model — facts, not judgments](0063-doctor-execution-model.md)
- [0064 — `integrate` reports what changed beneath the branch](0064-integrate-change-summary.md)
- [0065 — `discern --help` groups commands by post-processing Cliffy's help](0065-grouped-cli-help.md)
