# ADR 0069: Setup proposes installed providers once and commits the selection

**Status**: accepted; builds on [ADR 0031](0031-typed-provider-integration.md) (the typed provider registry) and [ADR 0043](0043-registry-derived-agent-parity.md) (the registry as the enforced single source)

## Context

discern compiles agent files, materializes Skills, and writes provider integrations for the tools selected in `[project].agents`. A fresh project may have an explicit configuration, an `--agents` choice, installation evidence on the current machine, or no evidence at all. Those facts have different authority: installed software can support a proposal, but cannot identify the tool or model invoking setup.

As discern grows from three modelled agents toward six, a static default becomes a worse and worse guess: the more agents exist, the less likely a fixed pair is the right set for any given machine. The registry already knows every agent (`PROVIDERS`, a total `Record<AgentName, Provider>`); what it lacked was a way to ask "which of these is on this machine?"

## Decision

**Setup derives one provider proposal from registry-owned installation evidence, asks the owner to confirm it, and persists the resulting repository selection.**

- Each `Provider` declares its high-confidence launcher binaries and any setup-only installation markers. Detection scans those declarations in registry order, including `PATHEXT` on Windows, without shelling out to `which`.
- Explicit `[project].agents` always wins, including an explicit empty list. An invocation's `--agents` selection likewise outranks ambient evidence.
- With installation evidence, consent calls the providers "detected on this machine" and proposes committing that set. With no evidence, it proposes `DEFAULT_AGENTS`, Claude Code and Codex, while allowing another set or none.
- The confirmed set is written to `[project].agents`. Refresh, setup resumption, and ordinary runtime behavior read that committed selection without re-detecting the machine.

The explicit *no*s:

- **Detection never identifies the invoking agent or model.** Setup provenance remains the agent's self-declared identifier or `unreported`.
- **Detection is setup evidence, never a runtime fallback over an explicit selection.** A machine that later gains or loses a provider does not silently change committed files.
- **An empty selection stays empty.** No fallback turns an explicit `[]` into the default pair.

## Consequences

- **The proposal fits the available evidence without overstating it.** A Gemini installation can be proposed, while the consent relay still says that installation is not invocation identity.
- **Adding a vendor extends auto-detect with no new wiring.** Because detection iterates the registry, the next agent's `binaries` entry enrols it in detection with no edit to the setup flow — the ADR 0031/0043 payoff, applied to one more seam. A parity guard fails the build if any provider declares an empty `binaries`.
- **The result is deterministic and testable.** Detection takes an injected `EnvReader`, so a test drives it over a temp `PATH` with fake executables without touching the process env (ADR 0068).
- **Fresh proposals can differ by machine; committed projects do not.** The owner-confirmed `[project].agents` value is the single source of truth thereafter.

## Alternatives considered

- **Keep the static `DEFAULT_AGENTS` for every install.** Rejected: it is the status quo whose guess gets worse as the agent set grows; the registry already holds everything needed to do better.
- **Detect at runtime as a fallback instead of persisting at setup.** Rejected: it makes generated output depend on ambient machine state, so the same commit can produce different files. Detect for consent, confirm once, and write the selection down.
- **Shell out to `which`/`command -v` per binary.** Rejected: a direct `PATH` scan is cheaper (no subprocess), more portable (one code path, `PATHEXT`-aware on Windows), and easier to test with an injected environment.
