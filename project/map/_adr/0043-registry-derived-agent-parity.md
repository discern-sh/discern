# ADR 0043: The provider registry is the enforced single source for every agent surface

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md)):** current pointers use `done` (formerly `finish`); the decision and reasoning are unchanged.
> - **[ADR 0042](_superseded/0042-per-agent-skills-materialization.md) — consolidated here:** per-agent skills materialization folds into this record — a `Provider.skillsDir` field directs the effective skill set into every configured agent's directory (`claude_code → .claude/skills`, and `codex`/`gemini →` the shared `.agents/skills`, deduped onto one target), gated on `features.skills` — and this record makes the provider registry the enforced single source for it, guarded by the parity test below.
> - **[ADR 0166](0166-agent-identity-is-advisory-logbook-evidence.md) — identity extension:** a broader identity catalogue now derives `AGENT_NAMES` and owns advisory logbook markers; `PROVIDERS` remains the enforced single source for every native integration surface, and this decision's parity guarantees are unchanged.

**Status**: accepted; completes [ADR 0031](0031-typed-provider-integration.md), extends the currency check of [ADR 0034](0034-agents-md-untracked-currency-check.md) to skills, and **builds on and consolidates** [ADR 0042](_superseded/0042-per-agent-skills-materialization.md).

## Context

[ADR 0031](0031-typed-provider-integration.md) made the typed provider registry (`PROVIDERS` in `src/lib/providers.ts`) the single source of truth for everything agent-specific, and a **total `Record<AgentName, Provider>`** so adding a name to `AGENT_NAMES` forces a complete entry — a compile error otherwise.

That coupling protected the **runtime engine** consumers (the guidance compiler, skills materialization, MCP wiring, hook-stripping). But a tier of **satellite consumers re-encoded a hardcoded subset** of the same agent facts, with no compile-time tie to the registry, and silently fell out of parity as the registry grew:

- The seed `.gitignore` fragment listed the agent files/dirs as **static literals**.
- `DEFAULTS.scopesNeutral` hardcoded `.claude/` and **omitted `.agents/`** — added by [ADR 0042](_superseded/0042-per-agent-skills-materialization.md) but never reflected here.
- The audit's `anyAgentFile()` hardcoded the three filenames; `plan_view` grouped `.claude/` only; `skills.ts` kept a `CLAUDE_SKILLS_REL` duplicate of the registry value; the default agent set was encoded three times.
- **Skills had no currency check.** Guidance files were guarded by `checkGuidanceCurrent` (ADR 0034: `status` advisory, `done` blocks on stale), but materialized skills dirs had no equivalent — a hand-edited, removed, or upgrade-stale skill was invisible to the gate.
- **`GEMINI.md` duplicated the full body** though Gemini CLI supports the same `@path` import as Claude Code.

The pattern was clear: the registry held the data, the satellites ignored it, and each new agent widened the drift — exactly the trajectory the project's single-source-of-truth policy forbids.

Before deciding, the three vendors' actual conventions were verified against their official docs (not assumed), which sorts the divergences into **expected** (a real mechanism difference) and **unexpected** (an unforced omission):

| Surface                     | Claude Code      | Codex                  | Gemini                  |
| --------------------------- | ---------------- | ---------------------- | ----------------------- |
| Instruction-file `@import`  | ✅ `@path`       | ❌ none (concat)       | ✅ `@path` (`.md`-only) |
| Reads `.agents/skills/`     | ❌ (#31005 open) | ✅ native              | ✅ alias (precedence)   |
| MCP config                  | `.mcp.json`      | `~/.codex/config.toml` | `.gemini/settings.json` |
| Worktree create/remove hook | yes              | ❌ none                | ❌ none                 |

## Decision

**Every cross-cutting consumer derives agent paths from the registry, and a registry-driven parity test fails the build when a new agent isn't yet handled everywhere.**

1. **Registry-derived aggregators** (`allGuidanceFilePaths`, `allSkillsDirs`, `neutralAgentScopePaths`, `agentArtifactPaths`) are the one place satellites read agent paths from. `scopesNeutral`, `anyAgentFile`, and the `plan_view` grouping now call them. The duplicates collapse: `DEFAULT_AGENTS` + `resolveConfiguredAgents` move to the shared schema module (one definition for the compiler, dispatcher, skills check, init seed, and migration fallback); `CLAUDE_SKILLS_REL` is dropped.

2. **A parity test (`tests/agent_parity_test.ts`) is the forcing function** for the surfaces that _can't_ be compile-coupled — the static seed `.gitignore` fragment, the neutral-scope seed, and each hooks provider's seed settings template. For **every** `AGENT_NAMES` entry it asserts the fragment ignores the guidance file and covers the skills dir, and the neutral scopes neutralize the generated dir; and for every provider that declares a hooks surface it asserts the seed settings template (`templates/.claude/settings.json.tmpl`) carries the registry's `worktreeEventKeys` + `sessionHookNeedle`. A new agent — or a renamed hook event — red-lights the gate until each surface learns it. The gitignore "covered" semantics are a SINGLE exported definition (`ignoreCovers`) that both this test and the upgrade-time reconciler use, so the guard and the convergence can never disagree.

3. **`.gitignore` convergence is registry-derived.** [ADR 0093](0093-upgrade-reconciles-gitignore-block.md) replaces the original additive helper with a canonical discern-owned block reconciler run on every `discern upgrade`: a future agent's artifacts get ignored on the next upgrade with no bespoke per-agent migration, and historical one-off `# discern:` sections are absorbed into one block. The frozen schema-9/10 gitignore migrations stay as historical records.

4. **Skills join guidance under one "generated artifacts are current" discipline.** `checkSkillsCurrent` is the stateless skills analog of `checkGuidanceCurrent`: re-resolve the effective set and diff against disk (bundled = byte-equal to source, authored = live symlink to `[skills].dir`), no stored hash. Same dispositions as ADR 0034 — `status` advisory; `done` blocks on `stale` only; `missing` (a not-yet-materialized dir on a fresh checkout) and `foreign` (an unmanaged drop-in, never clobbered) do not block.

5. **`GEMINI.md` becomes an `@AGENTS.md` pointer**, sharing one `atImportPointer` with Claude Code (the `@path` syntax is byte-identical and vendor-supported for both). `AGENTS.md` stays the canonical full-body file precisely because **Codex has no import directive** — the one _expected_ asymmetry, now the only one.

6. **`doctor` surfaces per-agent integration coverage**, so the expected divergences (MCP/hooks are Claude-only because Codex/Gemini use different mechanisms) are reported explicitly rather than read as a silent gap.

The expected divergences are **kept and made visible**: MCP wiring and worktree hooks remain Claude-only (Codex/Gemini expose no equivalent discern can target), and Claude keeps its own `.claude/skills/` (it doesn't read `.agents/skills/`, #31005 open). What changes is that nothing agent-specific is encoded _outside_ the registry without a test tying it back.

## Consequences

- **Divergence is a failing test, not a silent gap.** Adding a fourth agent is a `PROVIDERS` compile error (runtime) **and** a parity-test failure (static surfaces) until every satellite is taught — the architectural guarantee the SSOT policy wants.
- **Skills are guarded like guidance.** A drifted materialized skill is caught at `done` and surfaced at `status`, closing the asymmetry ADR 0034 left open.
- **One agent file holds the body.** With Gemini pointing at `AGENTS.md`, the compiled guidance lives in exactly one file; the others import it and cannot drift.
- **Existing installs self-heal forward.** The convergence step means a future agent needs no migration code to get its artifacts ignored.

## Alternatives considered

- **Generate the `.gitignore` fragment from the registry.** Rejected: the fragment carries load-bearing prose (the `.claude/*`-plus-exceptions structure, the deliberately-tracked `.mcp.json` note). A parity test over the authored fragment is lighter and equally regression-proof — adding an agent fails it just the same.
- **Store an expected hash for skills.** Rejected for the same reason ADR 0034 rejected it for guidance: a second source of truth to keep in sync. Recompile (here, re-resolve) and compare is stateless and always correct.
- **Block `done` on missing/foreign skills.** Rejected: a gitignored artifact is legitimately absent on a fresh checkout (would red-light first-run CI), and a foreign drop-in must never be presented as discern's to fix. Only `stale` blocks.
- **Leave `GEMINI.md` a full copy.** Rejected once Gemini's `@path` import was verified — the duplication was unforced, and the pointer makes all three agents uniform but for Codex's genuine lack of an import directive.
