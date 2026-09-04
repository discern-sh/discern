# ADR 0322: Setup is one bounded operational journey

> **Amendment (2026-09-04).** The journey now consumes provider-registry evidence and security disclosures, requires Git for authoring and completion, exposes persisted `proven | unproven` completion state, and gives every setup result exactly one runnable `next_action`. Setup also states the one-install-per-Git-repository boundary. The typed commit-message registry in [ADR 0203](0203-discern-co-authors-only-commits-it-composes.md) owns every engine-authored setup commit.

**Status**: accepted. Extends the staged handshake in [ADR 0075](0075-setup-staged-handshake.md), the stateless page contract in [ADR 0078](0078-setup-pages-and-per-step-proof.md), the served-message boundary in [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md), the structural worktree proof in [ADR 0090](0090-setup-proves-worktree-viability.md), and the final Proof transaction in [ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md).

## Context

Two clean-room setup runs both reached a green result but produced materially different project knowledge, command wiring, and follow-up behavior. One expanded the Map and TODO ledger beyond durable boundaries, rewrote an existing aggregate command, selected a noisy structured reporter, and continued mutating after Proof. The other preserved the aggregate but under-documented the primary subsystem and omitted recommended diagnostics and follow-up. Both were reasonable readings of surfaces that distributed operational facts across prose, structured data, hints, and seeded pages.

The journey also contradicted itself at phase boundaries. Orientation preceded the subsystem inventory it needed. A manual `discern start` exercise appeared to test the setup branch even though the command defaults to trunk, while `setup done` already owned the correct current-HEAD structural probe. First-time MCP registration asked for a restart during unfinished setup. Completion asked for a restart before the setup branch had landed and offered improvement work before activation. Human relays counted Map and ledger output by hand.

The operational defect class is any setup fact that exists in one delivery lane, outside a closed registry, or as agent arithmetic. A second class applies to the first-use experience: a concept can be mechanically present while omitting the owner outcome and reason, and a genuine owner decision can omit its recommendation, option consequences, concrete action, or agent wait boundary. Token-presence tests do not detect that semantic loss.

## Decision

**Setup is one operational journey whose parsed page, final Proof, landing state, and provider registry determine every presentation.**

### Sequential pages and dependency order

`SETUP_PAGE_REGISTRY` owns the numbered page set, numeric presentation order, and exact next commands. Pages run from `0` through `9` without gaps or reversals. Project and subsystem evidence precedes Map planning, Gate and smoke behavior precede final documentation synthesis, and final synthesis precedes the clean commit and Proof transaction. The parser rejects an authored heading or continuation that departs from that sequence.

Every page's co-located TOML spine carries its phase, stable target, inputs, ordered actions, authority boundaries, canonical owner-moment ids, prohibited actions, completion check, stop conditions, recovery, and exact continuation. The parser resolves each owner moment into complete prose and a compact typed projection. Human, Markdown, JSON, and MCP presentations consume the same result. Full semantic sentences appear once, while integrations receive the moment kind, recommendation, options, and wait state.

`SETUP_READINESS_CATEGORIES` owns the distinct worktree resource classes, including untracked file databases, tracked binary databases, local services, hosted or shared services, environment, dependencies, ports, and owner-gated cost or data resources. Reporter selection is a pure policy over recognition, capture, exit-status preservation, failure value, and green-path volume. Documentation scope always includes one substantive primary-subsystem page and adds another only for a durable boundary that reduces future reading. TODO entries require a concrete unresolved decision or defect with evidence.

The normal setup path creates no manual probe worktree. `setup done` owns the single structural probe from the committed marker-bearing `HEAD`, applies setup machinery, and tears it down. Seeded `discern start` descriptions say that the command creates a worktree and returns its path; the agent re-roots with its native tool or works there explicitly.

### Semantic human moments

`SETUP_HUMAN_MOMENTS` owns each fixed first-use explanation, progress handoff, owner decision, and completion handoff. Every member states the phase and trigger, purpose, outcome for the owner, reason, current action, authority, reversibility, recovery, and agent behavior. A decision additionally requires one recommendation, multiple options with consequences and separate owner/agent actions, one recommended option, an agent wait boundary, and a protected relay. Schema validation is independent of ids, and tests reject an unrelated future decision that omits any role.

The welcome, consent, setup-started relay, setup pages, completion, landing, and activation surfaces bind to the registry. Dynamic facts such as provider names, paths, Proof, and project context still derive from their live authorities. They do not become hand-authored registry copies.

### Recommended model choice and advisory provenance

The welcome explains that the setup model studies the repository and authors the Gate, worktree policy, Map, and instructions future sessions inherit. discern recommends the strongest suitable reasoning model. The consent confirmation offers neutral owner actions: use the coding tool's model selector, open a fresh project session, and restart setup, or continue with the current model. The current agent waits and stops when the owner switches. No option label lets the agent assert its own capability.

Provider and model facts travel separately. Before the owner chooses, the executing agent reports its current self-declared identifier or `unreported`. `setup begin` records the same fact only when this session continues. A placeholder is never reported or stored, and provenance remains advisory.

First-time provider registration is phase-aware. While `[meta].bootstrapped` is false, refresh tells the agent to continue the same setup session. It does not ask for a restart. Normal first-registration wording remains available outside unfinished setup.

### Provider facts, repository boundary, and runnable routes

Setup projects provider names, written paths, generated Skill directories, trust steps, and permission consequences from the provider registry. Explicit `[project].agents`, including `[]`, wins. Otherwise installed-on-this-machine evidence supports a proposal; with no evidence, setup proposes Claude Code and Codex. Detection never claims to identify the invoking tool or model, and confirmation turns the choice into committed repository configuration.

One Git repository has one root `discern.toml` and one discern installation. A monorepo uses that root install's Scopes and custom jobs; a nested independent Git repository is a separate project. `setup begin` and `setup done` require Git, and non-Git verification reports readiness false. Its sole next action is `git init`; the following instructions then name `discern setup verify`.

Every setup result carries one top-level `next_action` containing exactly one runnable command. Serialization rejects compounds, pipelines, substitutions, and multi-command strings. The selected command is grounded in live state: current-branch resumption uses the setup entry, another branch first checks out the recorded setup branch, non-Git setup initializes Git, incomplete authoring returns to `setup begin`, and proven completion routes to review or acceptance. Explanatory follow-up may describe what comes after that command without smuggling a second action into the field.

The skeleton uses one `{{trunk}}` token for repository branch prose. Its internal source directories are named `map`, while `[map].dir` remains the only installed destination authority.

### Proof, landing, activation, then optional improvement

After the final setup authoring commit, `setup done` produces canonical Proof and derives one completion inventory from the configured Map directory, TODO ledger, instruction sources, and job assurance. The primary-subsystem README exposes exact `Start here`, `Boundary`, and `Non-obvious invariant` sections. The completion check requires them, and the result uses them with the design-principle headings to explain what future sessions inherit. Counts and lists remain supporting evidence; relay text never counts agent output.

An unlanded completion leads with Proof, the current branch, the absent integration-branch state, and landing choices. It carries no restart or improvement action. `setup accept` lands only valid Proof, then serves the provider-derived fresh-session step, exact activation check, local recovery, and CLI fallback. Only after each applicable activation check succeeds may a surface offer `discern improvement --json`, explicitly as optional ongoing owner review.

No tracked mutation follows successful final Proof inside setup completion. A review choice may leave the proved setup branch unchanged; landing still requires applicable authority.

### Bounded progressive disclosure

`setup begin` emits the preamble and first page; `setup step <n>` emits one page. Default page, begin, and completion results have declared useful-context ceilings guarded on human and structured surfaces. Default structured doctor returns actionable checks without the per-verb execution model. `discern doctor --verbose --json` and `discern_doctor` with `verbose: true` opt into that complete model. Default results name the verbose route rather than silently dropping it.

## Consequences

- A future page, human moment, readiness class, provider, or reporter example enrolls in registry-driven guards before it can ship.
- Setup preserves useful existing project commands and describes the project's aggregate check by its real coverage. Registering a command with the Gate does not authorize changing the command itself.
- Factual architecture, ownership, command, and test claims are rechecked after smoke and final edits. An unverifiable claim becomes a concrete open ledger item rather than confident prose.
- Completion copy can no longer tell a human to restart into a branch where setup is absent, and an optional improvement review cannot invalidate setup Proof.
- Default orientation calls remain bounded; complete diagnostic detail stays available through an explicit form.
- The setup template carries typed operational structure and semantic owner-moment references. Complete prose remains bounded because typed routing state is a derived compact projection.

## Alternatives considered

- **Preserve the old page numbers as compatibility handles.** Rejected because discern is pre-release and no external setup session depends on those numbers. Aliases or a versioned order would retain a confusing journey and create a second page contract.
- **Keep the operational spine only in JSON.** Rejected because many agents read human or Markdown output, and clean-room runs showed that one lane can be compressed or ignored. Both lanes must retain the load-bearing facts.
- **Review first-use nuance only as copy.** Rejected because a later rewrite can preserve nouns while dropping outcome, reason, consequences, and action. An id-independent schema and future-sibling fixture guard the semantic roles.
- **Keep a manual `discern start` probe for teaching.** Rejected because it defaults to trunk, duplicates the machine-owned current-HEAD probe, and creates needless setup and teardown effects.
- **Restart immediately after MCP registration.** Rejected because it interrupts unfinished setup and loads integration before the setup branch is available on trunk.
- **Let the agent summarize and count its own work.** Rejected because relay compression already dropped consent facts and miscounted Map and ledger output. Authorities produce the inventory mechanically.
- **Hide authority or recovery fields to meet a size target.** Rejected. The page is split or the repeated prose is reduced; stop, recovery, and authority remain visible.
