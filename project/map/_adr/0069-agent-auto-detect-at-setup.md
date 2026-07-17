# ADR 0069: A fresh install resolves its default agent set by PATH auto-detection

**Status**: accepted; builds on [ADR 0031](0031-typed-provider-integration.md) (the typed provider registry) and [ADR 0043](0043-registry-derived-agent-parity.md) (the registry as the enforced single source)

## Context

discern compiles agent-instruction files and materializes skills for the agents named in `[guidance].agents`. When the user runs `discern setup` without naming any (the zero-config path — no `--agents`, no `--config` agents), discern had one answer: the hardcoded `DEFAULT_AGENTS = ["claude_code", "codex"]`. That is a reasonable guess, but it is only a guess — it ignores what the user actually has installed. A Gemini user got no `GEMINI.md`; a user without Codex got an `AGENTS.md` for a tool they don't run.

As discern grows from three modelled agents toward six, a static default becomes a worse and worse guess: the more agents exist, the less likely a fixed pair is the right set for any given machine. The registry already knows every agent (`PROVIDERS`, a total `Record<AgentName, Provider>`); what it lacked was a way to ask "which of these is on this machine?"

## Decision

**A fresh install resolves its default `[guidance].agents` by detecting which known agents have a binary on `PATH`, and persists the result to `discern.toml`.**

- `Provider` gains `binaries: readonly string[]` — the CLI executable name(s) the agent ships as. Semantics are **match-any**: a provider is "present" when ANY of its binaries resolves (a vendor that ships under several names lists them all). `claude_code → ["claude"]`, `codex → ["codex"]`, `gemini → ["gemini"]`.
- `detectAgentsOnPath(env)` (in `src/lib/detect_agents.ts`, the feature layer — _which agents exist_ is agent-specific, not the stack-neutral engine's concern) scans `PATH` directly for each provider's binaries, in `AGENT_NAMES` order. It is a portable filesystem scan, not a shell-out to `which`, so it has no subprocess cost and works the same cross-OS (honouring `PATHEXT` on Windows).
- `resolveDefaultAgents(env)` returns the detected set, or `DEFAULT_AGENTS` when **none** is detected — so the result is never an empty agent set.
- `discern setup` calls it **once**, for a fresh install, only when the user named no agents, and writes the answer into the generated config. Detection is registry-driven, so a future vendor with a `binaries` list auto-enrols.

The explicit *no*s:

- **Detection is a setup-time default, never a runtime fallback.** `resolveConfiguredAgents` stays a pure reader of committed config — the agent set a project compiles against is fixed in `discern.toml`, not re-derived from whatever happens to be on `PATH` when the gate runs. A machine that later loses an agent binary does not silently change what the project generates.
- **`DEFAULT_AGENTS` and the runtime fallback are unchanged.** They stay `["claude_code", "codex"]`; Gemini is not promoted. Auto-detect handles the init default; the static constant is only the no-detection floor.
- **A `--force` re-run does not re-detect.** The config is write-once, so an existing `[guidance].agents` is left as the user's; re-detecting would be inert.

## Consequences

- **The default install fits the machine.** A Gemini user gets `GEMINI.md`; a user without Codex doesn't get an `AGENTS.md` they won't read. The guess becomes an observation.
- **Adding a vendor extends auto-detect with no new wiring.** Because detection iterates the registry, the next agent's `binaries` entry enrols it in detection with no edit to the setup flow — the ADR 0031/0043 payoff, applied to one more seam. A parity guard fails the build if any provider declares an empty `binaries`.
- **The result is deterministic and testable.** Detection takes an injected `EnvReader`, so a test drives it over a temp `PATH` with fake executables without touching the process env (ADR 0068).
- **Setup output now depends on the machine.** Two machines with different agents installed produce different `[guidance].agents` — intended (that is the point), but it means `discern setup` is no longer a pure function of its flags. The persisted config remains the single source of truth thereafter.

## Alternatives considered

- **Keep the static `DEFAULT_AGENTS` for every install.** Rejected: it is the status quo whose guess gets worse as the agent set grows; the registry already holds everything needed to do better.
- **Detect at runtime as a fallback instead of persisting at setup.** Rejected: it makes the compiled output depend on the ambient `PATH` at gate time, so the same commit could generate different files on different machines — exactly the drift the committed-config single-source-of-truth model forbids. Detect once, write it down.
- **Shell out to `which`/`command -v` per binary.** Rejected: a direct `PATH` scan is cheaper (no subprocess), more portable (one code path, `PATHEXT`-aware on Windows), and easier to test with an injected environment.
