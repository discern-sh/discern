# Architecture Decision Records — discern itself

This directory holds **discern's own** Architecture Decision Records: short
documents capturing a significant decision about the kit's design, the context
that forced it, and the reasoning behind it.

discern _ships_ the ADR discipline to the projects it scaffolds via its bundled
`discern-write-adr` skill, which creates `map/_adr/` on demand from its skeleton
at
[`templates/skills/discern-write-adr/skeleton/docs/_adr/`](../../templates/skills/discern-write-adr/skeleton/docs/_adr/).
This directory is discern applying that discipline to itself — recording the
decisions behind the engine and installer here, in the same format.

**The canonical ADR format is the one discern ships:**
[`templates/skills/discern-write-adr/skeleton/docs/_adr/README.md`](../../templates/skills/discern-write-adr/skeleton/docs/_adr/README.md),
with the copy-paste template at
[`templates/skills/discern-write-adr/skeleton/docs/_adr/0000-template.md`](../../templates/skills/discern-write-adr/skeleton/docs/_adr/0000-template.md).
Read it before drafting. In brief: number continuously (`NNNN-slug.md`, first
real ADR is `0001`); state the decision in the title; write one only when the
decision is hard to reverse, surprising without context, and a real trade-off.

Once an ADR's decision is reversed, or fully absorbed into a later one, it moves
into [`_superseded/`](_superseded/) and drops from the index below into the
[Superseded and consolidated](#superseded-and-consolidated-adrs) list at the
foot of this file. It stays on the record as history — each carries a banner
pointing to its successor — but is out of the active set so a reader of the
index sees only current architecture. **Numbers are never reused**: the sequence
only ever climbs, so the index has gaps where retired ADRs once sat.

## Index

- [0001 — Project-owned recipes](0001-project-owned-recipes.md)
- [0003 — Named metric standards](0003-named-metric-standards.md)
- [0005 — Declarative config](0005-declarative-config.md)
- [0006 — Long-slot ergonomics](0006-long-slot-ergonomics.md)
- [0007 — Adapter contract](0007-adapter-contract.md)
- [0009 — 1.0: drop backward compatibility](0009-one-point-zero-drop-backward-compat.md)
- [0011 — Adopt the worktree workflow](0011-adopt-worktree-workflow.md)
- [0014 — A versioned, reversible migration system](0014-versioned-migration-system.md)
- [0015 — `discern map` browser + terminal Markdown renderer](0015-map-browser.md)
- [0017 — Declare capabilities, derive the gate](0017-capabilities-model.md)
- [0018 — Consolidate discern vocabulary into four layers](0018-vocabulary-consolidation.md)
- [0019 — Collapse into one binary with a TypeScript-native engine](0019-single-binary-ts-engine.md)
- [0020 — Dissolve `.discern/` into a single root `discern.toml`](0020-dissolve-discern-dir.md)
- [0021 — Migrations insert a new section's documented block at its canonical position](0021-migrations-insert-documented-sections.md)
- [0022 — Rename the harness to discern](0022-rename-to-discern.md)
- [0023 — Rename and promote the workflow commands](0023-rename-workflow-commands.md)
- [0025 — Generalize the db/dev-server adapters into per-worktree resources with orphan GC](0025-worktree-resources.md)
- [0026 — One typed (Zod) config schema as the single source of truth](0026-typed-config-schema.md)
- [0027 — Plan/apply as the engine's execution model](0027-plan-apply-engine-execution.md)
- [0028 — One result envelope per verb, with normalized failure diagnostics](0028-result-envelope-and-diagnostics.md)
- [0029 — A best-practices audit that splits deterministic from subjective rules](0029-best-practices-audit.md)
- [0031 — One typed provider registry for every agent-specific integration](0031-typed-provider-integration.md)
- [0033 — A `status` verb with location-aware scope](0033-status-verb-and-location-aware-scope.md)
- [0034 — AGENTS.md is an untracked build artifact, guarded by a currency check](0034-agents-md-untracked-currency-check.md)
- [0035 — A strict, config-only template engine for the built-in guidance](0035-guidance-templating-engine.md)
- [0036 — Unify setup under one zero-config `discern setup`](0036-unify-setup.md)
- [0037 — Setup-incompleteness is an observable state, not a prose handoff](0037-setup-incompleteness-observable.md)
- [0038 — The MCP server runs on the official TypeScript SDK over stdio](0038-official-mcp-sdk.md)
- [0039 — discern ships its own docs to every install via `discern help`](0039-bundled-help-docs.md)
- [0040 — The worktree hooks parse their payload in the binary (no jq)](0040-worktree-hooks-in-the-binary.md)
- [0041 — A self-describing MCP surface built on typed result schemas](0041-self-describing-mcp-surface.md)
- [0043 — The provider registry is the enforced single source for every agent surface](0043-registry-derived-agent-parity.md)
- [0044 — Setup involves the user and proceeds; it does not gate every step](0044-setup-involve-not-gate.md)
- [0045 — The MCP server is core infrastructure, not a feature toggle](0045-mcp-is-core-infrastructure.md)
- [0047 — `done` blocks a fix stage that strands uncommitted changes](0047-fix-stage-strand-detection.md)
- [0049 — Ship the fix-the-class discipline as built-in guidance and a bundled skill](0049-bug-class-discipline-built-in.md)
- [0050 — Run the merge check first, as a fail-fast precondition](0050-merge-check-fail-fast.md)
- [0051 — Every internal canonical set is tied to its satellites by a forcing function](0051-canonical-set-parity.md)
- [0052 — Worktrees live in a configurable sibling directory, not nested `.claude/worktrees`](0052-worktree-sibling-placement.md)
- [0053 — A gate guard keeps comments in the present tense, not narrating the codebase's past](0053-comment-currency-guard.md)
- [0054 — One module owns process spawning](0054-subprocess-single-source.md)
- [0055 — `discern update`, the third verb in the worktree lifecycle (merge + re-materialize)](0055-update-verb.md)
- [0057 — Hold a rate, not a raw count, via an optional `per` denominator](0057-rate-standards.md)
- [0058 — `discern start` spawns a worktree from the main checkout, and a status guardrail points at it](0058-start-verb-spawn-worktree-from-trunk.md)
- [0059 — `[worktree.setup].ensure`, a convergent setup bucket that re-runs every pass](0059-worktree-setup-ensure.md)
- [0060 — Worktree shell commands adopt the gate's capture-on-failure output convention](0060-worktree-command-output-capture.md)
- [0062 — The MCP server tracks its own working root, retiring location-based tool visibility](0062-mcp-server-working-root.md)
- [0063 — `discern doctor` prints the execution model — facts, not judgments](0063-doctor-execution-model.md)
- [0064 — `update` reports what changed beneath the branch](0064-update-change-summary.md)
- [0065 — `discern setup` keeps its promises](0065-setup-keeps-its-promises.md)
- [0066 — `discern --help` groups commands by post-processing Cliffy's help](0066-grouped-cli-help.md)
- [0067 — Accept validates the exact tree it lands, fast-pathed by a gate receipt](0067-accept-validates-the-landed-tree.md)
- [0068 — Tests inject env/cwd seams so the suite can run `--parallel`](0068-parallel-safe-tests-env-cwd-injection.md)
- [0069 — A fresh install resolves its default agent set by PATH auto-detection](0069-agent-auto-detect-at-setup.md)
- [0070 — An agent that reads the canonical `AGENTS.md` is modelled as "reuse-canonical", emitting nothing](0070-reuse-canonical-guidance.md)
- [0071 — The settings seed/merge seam is provider-driven, not a Claude special-case](0071-provider-driven-settings-seed.md)
- [0072 — A provider's MCP wiring is a typed status, accounted by a forcing function](0072-typed-mcp-status-forcing-function.md)
- [0073 — discern co-manages Codex's auto-generated `environment.toml`, and reuses the cwd-based teardown verb for its cleanup](0073-codex-worktree-lifecycle-comanagement.md)
- [0074 — Claude Code and GitHub Copilot co-own the shared `.mcp.json`, through one stdio writer](0074-co-owned-mcp-json.md)
- [0075 — `discern setup` is a staged, consent-driven handshake](0075-setup-staged-handshake.md)
- [0076 — The engine commits discern machinery it scaffolds](0076-engine-commits-scaffolded-machinery.md)
- [0077 — The setup agent is the configuration engine — transparency over interrogation](0077-setup-agent-is-the-configuration-engine.md)
- [0078 — Setup steps are stateless machine-readable pages with derived per-step proof](0078-setup-pages-and-per-step-proof.md)
- [0079 — `improvement` is a coach, not an audit](0079-improvement-is-a-coach-not-an-audit.md)
- [0080 — The agent map has one configured root](0080-configured-agent-map-root.md)
- [0081 — `discern setup accept`, a main-checkout landing command for the finished setup](0081-setup-accept-command.md)
- [0082 — Codex project config grants the discern worktree root, not broader sandbox control](0082-codex-project-config-writable-root.md)
- [0083 — Captured diagnostic output is normalized and offloaded when truncated](0083-normalize-and-offload-diagnostic-output.md)
- [0084 — Co-change coupling detection is a non-blocking advisory, recomputed on demand](0084-co-change-coupling-advisory.md)
- [0085 — Migrations validate before schema stamping and refuse newer configs](0085-validate-migrations-before-schema-stamping.md)
- [0086 — Setup serves ready-to-relay messages and gates a fresh scaffold on a `--confirmed` attestation](0086-setup-serves-relay-messages-and-a-consent-attestation.md)
- [0087 — Prefix the bundled skills with `discern-` and expand the set to nine](0087-prefix-and-expand-bundled-skills.md)
- [0088 — The fresh setup welcome decorates only on TTY](0088-fresh-setup-welcome-decorates-only-on-tty.md)
- [0089 — Machine-local provider settings stay ignored](0089-machine-local-provider-settings-stay-ignored.md)
- [0090 — Setup proves the project runs in a worktree, and `smoke` joins the known capabilities](0090-setup-proves-worktree-viability.md)
- [0092 — `upgrade` reconciles the fixed `discern.toml` scaffold](0092-upgrade-reconciles-config-scaffold.md)
- [0093 — `upgrade` reconciles the discern `.gitignore` block](0093-upgrade-reconciles-gitignore-block.md)
- [0094 — Final lifecycle checks require clean trees](0094-final-lifecycle-checks-require-clean-trees.md)
- [0095 — Standardize the prelaunch CLI vocabulary](0095-prelaunch-cli-vocabulary.md)
- [0096 — Passing jobs keep output artifacts](0096-passing-jobs-keep-output-artifacts.md)
- [0097 — Publish generated JSON result contracts](0097-publish-json-result-contracts.md)
- [0098 — Accept refreshes the landing checkout](0098-accept-refreshes-the-landing-checkout.md)
- [0099 — Consolidate the authored surface under a visible `discern/` namespace](0099-consolidate-authored-surface-under-discern-namespace.md)
- [0100 — The documentation tree is the agent-maintained map, not the project's own docs](0100-project-map-is-the-agents-map.md)
- [0101 — Retire the `[features]` toggles](0101-retire-the-features-toggles.md)
- [0102 — One paths registry, rendered artifacts, and leakage guards](0102-paths-registry-and-rendered-artifacts.md)
- [0103 — Setup grounds itself in the repo's real state — detected default branch, git-init-first without git, a welcome everywhere](0103-setup-holds-up-on-imperfect-repos.md)
- [0104 — `discern uninstall` is the exit-honesty verb — registry-derived removal, CLI-only](0104-uninstall-is-the-exit-honesty-verb.md)
- [0105 — Interruption reaches the gate's detached job groups](0105-interruption-reaches-detached-gate-jobs.md)
- [0106 — `standards --pin` captures a measured gain and carries the gate receipt across it](0106-standards-pin-carries-the-gate-receipt.md)
- [0107 — `upgrade` reconciles the record-table doc banners](0107-config-banners-are-managed-regions.md)
- [0108 — One global timeout bounds every gate job](0108-gate-job-timeout.md)
- [0109 — `discern start` accepts an optional name, normalised to a branch-safe slug](0109-worktree-start-optional-name.md)
- [0110 — The landing model — pull from any ref, land only on the trunk](0110-the-landing-model.md)
- [0111 — The MCP surface refuses undeclared arguments, and `discern_start` takes a cross-project `path`](0111-cross-project-path-and-strict-tool-schemas.md)
- [0112 — A measurement receipt lets check → pin measure once](0112-standard-measurement-receipt.md)
- [0113 — Installing a new dependency is a consent point in setup](0113-installing-a-dependency-is-a-consent-point.md)
- [0114 — A green gate emits the receipt](0114-the-gate-emits-the-receipt.md)
- [0115 — Under a nested project root, every verb works correctly or refuses loudly](0115-nested-root-verbs-work-or-refuse.md)
- [0116 — Receipts vouch only for the pinned tree, and accept lands the validated sha](0116-receipts-vouch-only-for-the-pinned-tree.md)
- [0117 — Temp output artifacts are reaped by age, from one registry](0117-temp-output-artifacts-are-reaped-by-age.md)
- [0118 — Preset config fills never overwrite a present value](0118-preset-fills-never-overwrite.md)
- [0119 — Bare `discern` opens the operator's desk](0119-bare-discern-opens-the-operators-desk.md)
- [0120 — The launch verb canon: questions are nouns, actions are imperatives](0120-launch-verb-canon.md)
- [0125 — An explicit `[guidance] agents = []` means no agents](0125-explicit-empty-agents-means-no-agents.md)
- [0126 — Internal ADR citations never ship](0126-no-adr-citations-in-shipped-strings.md)
- [0127 — Map freshness ships file-linked facts, not verdicts](0127-map-freshness-ships-file-facts.md)
- [0128 — The ignore block enumerates ownership; compiled guidance is tracked](0128-enumerated-ownership-tracked-guidance.md)
- [0129 — Setup never offers to adopt existing docs](0129-setup-never-adopts-existing-docs.md)

## Superseded and consolidated ADRs

Kept for history under [`_superseded/`](_superseded/); each names its successor
in a banner at the top of the file. Listed here so the record is complete
without cluttering the active index above.

- [0002 — First-class side-gates](_superseded/0002-first-class-side-gates.md) —
  replaced by the capabilities/checks model (0017) and the scope `gate` key
  (0018)
- [0004 — Structured `agent finish --json`](_superseded/0004-structured-finish-json.md)
  — superseded by the result envelope (0028)
- [0008 — Declarative managed-set](_superseded/0008-declarative-managed-set.md)
  — made moot by the single binary (0019)
- [0010 — Self-host the harness](_superseded/0010-self-host-the-harness.md) —
  superseded by the single binary (0019)
- [0012 — Engine noglob (`set -f`) by default](_superseded/0012-engine-noglob-default.md)
  — retired by the single binary (0019)
- [0013 — Product vocabulary in user-facing output](_superseded/0013-product-vocabulary-in-user-output.md)
  — retired by the single binary (0019)
- [0016 — Consolidate the install surface under `.discern/`](_superseded/0016-consolidate-install-surface.md)
  — superseded by the root `discern.toml` (0020)
- [0024 — Setup is a command, not a skill](_superseded/0024-setup-command-not-skill.md)
  — consolidated into `discern setup` (0036)
- [0030 — `--json` is quiet](_superseded/0030-quiet-json-output.md) —
  consolidated into the result envelope (0028)
- [0032 — The Claude Code mirror imports AGENTS.md](_superseded/0032-claude-md-imports-agents-md.md)
  — consolidated into the currency-check ADR (0034)
- [0042 — Per-agent skills materialization](_superseded/0042-per-agent-skills-materialization.md)
  — consolidated into registry-derived parity (0043)
- [0046 — A configurable graduation destination, and removing the handoff-worktree skill](_superseded/0046-graduate-destination-and-skill-removal.md)
  — superseded by the landing model (0110); the skill removal stands
- [0048 — Rename the graduation landing-role `main` → `trunk`](_superseded/0048-graduate-trunk-role-name.md)
  — consolidated into 0046
- [0056 — Run the currency checks as fail-fast preconditions too](_superseded/0056-currency-checks-fail-fast.md)
  — consolidated into the merge-check ADR (0050)
- [0061 — Graduate enforces the fix stage's fixed point](_superseded/0061-graduate-fix-stage-fixed-point.md)
  — superseded by 0067
- [0091 — Rescue generated content before overwrite](_superseded/0091-rescue-generated-content-before-overwrite.md)
  — reverted because detecting user authorship inside ignored generated files
  produced false rescues for old generated output
