# ADR 0322: Setup is one bounded operational journey

**Status**: accepted. Extends the staged handshake in [ADR 0075](0075-setup-staged-handshake.md), the stateless page contract in [ADR 0078](0078-setup-pages-and-per-step-proof.md), the served-message boundary in [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md), the structural worktree proof in [ADR 0090](0090-setup-proves-worktree-viability.md), and the final Proof transaction in [ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md).

## Context

Two clean-room setup runs both reached a green result but produced materially different project knowledge, command wiring, and follow-up behavior. One expanded the Map and TODO ledger beyond durable boundaries, rewrote an existing aggregate command, selected a noisy structured reporter, and continued mutating after Proof. The other preserved the aggregate but under-documented the primary subsystem and omitted recommended diagnostics and follow-up. Both were reasonable readings of surfaces that distributed operational facts across prose, structured data, hints, and seeded pages.

The journey also contradicted itself at phase boundaries. Orientation preceded the subsystem inventory it needed. A manual `discern start` exercise appeared to test the setup branch even though the command defaults to trunk, while `setup done` already owned the correct current-HEAD structural probe. First-time MCP registration asked for a restart during unfinished setup. Completion asked for a restart before the setup branch had landed and offered improvement work before activation. Human relays counted Map and ledger output by hand.

The defect class is any setup fact that exists in one delivery lane, outside a closed registry, or as agent arithmetic. Such a fact can disappear under context pressure while another surface remains green.

## Decision

**Setup is one versioned operational journey whose parsed page, final Proof, landing state, and provider registry determine every presentation.**

### Stable pages, reordered dependencies

`SETUP_PAGE_REGISTRY` owns stable numeric page identifiers, presentation order, and exact next commands. The v2 order is `0, 1, 2, 3, 4, 5, 7, 8, 6, 9`: project and subsystem evidence precedes Map planning, Gate and smoke behavior precede final documentation synthesis, and final synthesis precedes the clean commit and Proof transaction. Existing setup sessions keep their numeric resume handles; moving whole registered pages changes presentation without renumbering state.

Every page's co-located TOML spine carries its phase, stable target, inputs, ordered actions, authority boundaries, genuine owner decisions, prohibited actions, completion check, stop conditions, recovery, exact continuation, and any bounded relay. Human, Markdown, JSON, and MCP presentations project those fields from the parsed authority. Prose remains the second load-bearing lane, but it no longer hides facts omitted from the renderer.

`SETUP_READINESS_CATEGORIES` owns the distinct worktree resource classes, including untracked file databases, tracked binary databases, local services, hosted or shared services, environment, dependencies, ports, and owner-gated cost or data resources. Reporter selection is a pure policy over recognition, capture, exit-status preservation, failure value, and green-path volume. Documentation scope always includes one substantive primary-subsystem page and adds another only for a durable boundary that reduces future reading. TODO entries require a concrete unresolved decision or defect with evidence.

The normal setup path creates no manual probe worktree. `setup done` owns the single structural probe from the committed marker-bearing `HEAD`, applies setup machinery, and tears it down. Seeded `discern start` descriptions say that the command creates a worktree and returns its path; the agent re-roots with its native tool or works there explicitly.

### Neutral consent and advisory provenance

The consent relay gives every must-survive fact its own list item and every decision its own numbered confirmation. The relay frame protects both collections word for word. Model selection stays a neutral owner question; provider and model facts travel separately. `setup begin` records an exact self-declared identifier or the literal `unreported`, never a placeholder, and treats both as advisory rather than verified capability.

First-time provider registration is phase-aware. While `[meta].bootstrapped` is false, refresh tells the agent to continue the same setup session. It does not ask for a restart. Normal first-registration wording remains available outside unfinished setup.

### Proof, landing, activation, then optional improvement

After the final setup authoring commit, `setup done` produces canonical Proof and derives one completion inventory from the configured Map directory, TODO ledger, and job assurance. The result carries the exact counts and lists; relay text never counts agent output.

An unlanded completion leads with Proof, the current branch, the absent integration-branch state, and landing choices. It carries no restart or improvement action. `setup accept` lands only valid Proof, then serves the provider-derived fresh-session step, exact activation check, local recovery, and CLI fallback. Only after each applicable activation check succeeds may a surface offer `discern improvement --json`, explicitly as optional ongoing owner review.

No tracked mutation follows successful final Proof inside setup completion. A review choice may leave the proved setup branch unchanged; landing still requires applicable authority.

### Bounded progressive disclosure

`setup begin` emits the preamble and first page; `setup step <n>` emits one page. Default page, begin, and completion results have declared useful-context ceilings guarded on human and structured surfaces. Default structured doctor returns actionable checks without the per-verb execution model. `discern doctor --verbose --json` and `discern_doctor` with `verbose: true` opt into that complete model. Default results name the verbose route rather than silently dropping it.

## Consequences

- A future page, readiness class, provider, or reporter example enrolls in registry-driven guards before it can ship.
- Setup preserves useful existing project commands and describes the project's aggregate check by its real coverage. Registering a command with the Gate does not authorize changing the command itself.
- Factual architecture, ownership, command, and test claims are rechecked after smoke and final edits. An unverifiable claim becomes a concrete open ledger item rather than confident prose.
- Completion copy can no longer tell a human to restart into a branch where setup is absent, and an optional improvement review cannot invalidate setup Proof.
- Default orientation calls remain bounded; complete diagnostic detail stays available through an explicit form.
- The setup template carries more typed operational structure. The page registry, schema, and semantic guards are the cost paid to stop surface-specific omissions.

## Alternatives considered

- **Renumber the pages into presentation order.** Rejected because numeric ids are resume handles for in-progress setup. A versioned order registry changes dependencies without stranding those sessions.
- **Keep the operational spine only in JSON.** Rejected because many agents read human or Markdown output, and clean-room runs showed that one lane can be compressed or ignored. Both lanes must retain the load-bearing facts.
- **Keep a manual `discern start` probe for teaching.** Rejected because it defaults to trunk, duplicates the machine-owned current-HEAD probe, and creates needless setup and teardown effects.
- **Restart immediately after MCP registration.** Rejected because it interrupts unfinished setup and loads integration before the setup branch is available on trunk.
- **Let the agent summarize and count its own work.** Rejected because relay compression already dropped consent facts and miscounted Map and ledger output. Authorities produce the inventory mechanically.
- **Hide authority or recovery fields to meet a size target.** Rejected. The page is split or the repeated prose is reduced; stop, recovery, and authority remain visible.
