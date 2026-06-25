# ADR 0042: Per-agent skills materialization

**Status**: accepted; extends [ADR 0031](0031-typed-provider-integration.md)

## Context

discern materializes its effective skill set (bundled built-ins ⊕ authored
skills) into a provider directory so the coding agent can discover it. From the
start that directory was **hardcoded to Claude Code's `.claude/skills/`**, in
`src/lib/skills.ts`, gated only on `features.skills`.

That was correct when Claude Code was the only agent with a skills mechanism. It
is no longer. **Codex and Gemini both ship Agent Skills, in the identical
`SKILL.md` folder format**, differing only in directory:

- Claude Code discovers project skills in **`.claude/skills/`** — and **not**
  the cross-tool `.agents/skills/` (an open, much-upvoted request,
  [anthropics/claude-code#31005](https://github.com/anthropics/claude-code/issues/31005),
  unresolved as of 2026 — verified empirically, not assumed).
- [Codex scans **`.agents/skills/`**](https://developers.openai.com/codex/skills)
  in every directory up to the repo root — its only repo-level path (not
  `.codex/skills/`).
- [Gemini reads **`.gemini/skills/`** or the **`.agents/skills/`**
  alias](https://geminicli.com/docs/cli/skills/), with the alias taking
  precedence — the interoperable, cross-tool path.

So `.agents/skills/` is a **converging cross-tool standard**: Codex's only repo
path and Gemini's preferred alias.

The consequence was a real defect, on the **default** configuration. discern's
default agent set is `["claude_code", "codex"]` (`src/lib/config.ts`), yet
skills went only to `.claude/skills/` — so a Codex user's skills were
materialized into a directory Codex never reads. Worse, the fix was already
designed for: [ADR 0031](0031-typed-provider-integration.md) built the typed
provider registry to be the single source of everything agent-specific and
**explicitly named "a per-agent skills dir" as the intended extension point** —
but skills were the one agent-specific behaviour still living outside it.

## Decision

**The skills directory is a field on the provider registry, and skills
materialize into every configured agent's directory.**

- `Provider` gains `skillsDir` (project-relative).
  `claude_code → .claude/skills`, `codex → .agents/skills`,
  `gemini → .agents/skills`. Gemini is pointed at the shared `.agents/skills/`
  alias (which it prefers) so that **Codex + Gemini dedupe onto one
  materialization target**.
- `skillsDirsForAgents(agents)` returns the deduplicated dirs for the configured
  set. A default install (`claude_code` + `codex`) materializes into two dirs:
  `.claude/skills/` and the shared `.agents/skills/`. A Codex+Gemini project
  materializes into one. Claude Code always gets its own, because it does not
  read the shared dir.
- `materializeSkills` reconciles the same effective set into each dir. The
  per-dir core keeps its own materialized-manifest (ADR-less, introduced
  alongside this work), so orphan self-healing and the never-clobber-a-drop-in
  contract hold **per directory**.
- The generated `.agents/skills/` joins `.claude/skills/` as an untracked build
  artifact: the seed `.gitignore` fragment gains the rule, and a schema-9→10
  migration backfills it for existing installs.
- The agent-agnosticism guard (`tests/agent_agnostic_test.ts`) is extended so
  the stack-neutral engine may not construct `.agents/skills` either — the new
  path is the feature layer's (the provider registry's) to own, never the
  engine's.

Skills stay gated on `features.skills`; the agent set determines _where_, the
feature flag whether _at all_.

## Consequences

- **Codex and Gemini users get usable skills.** The default install now places
  skills where every configured agent actually looks, not just Claude Code.
- **The registry is the single source for skills too.** Adding the next agent is
  one `skillsDir` entry, not a new conditional in `skills.ts` — the ADR 0031
  payoff, realized for the behaviour ADR 0031 had foreseen.
- **`.agents/skills/` deduplication keeps the footprint minimal.** Because the
  two non-Claude agents share the cross-tool dir, discern writes at most two
  skills directories regardless of how many agents are configured.
- **Existing installs are handled.** The migration adds the gitignore rule so
  the newly-materialized `.agents/skills/` does not surface as untracked churn.
- **Claude Code's separate dir is a standing fact, not an oversight.** If
  claude-code#31005 ships `.agents/skills/` support, `claude_code`'s `skillsDir`
  can collapse onto the shared dir and the three would need only one target — a
  one-line registry change, guarded by the same tests.

## Alternatives considered

- **Gate skills materialization on Claude Code being configured.** The first
  instinct, and wrong: it would have _denied_ Codex and Gemini their skills
  entirely, on the false premise that skills are Claude-only. Rejected once the
  cross-tool support was confirmed.
- **One shared `.agents/skills/` for all three agents.** The cleanest shape —
  but Claude Code does not read `.agents/skills/` (#31005), so it would silently
  lose its skills. Rejected on the verified fact; revisit if Claude adds
  support.
- **Write a distinct dir per agent (`.claude/skills`, `.codex/skills`,
  `.gemini/skills`).** Redundant and partly wrong: Codex's repo path is
  `.agents/skills/` (not `.codex/skills/`), and Gemini reads `.agents/skills/`
  as its preferred alias — so the shared dir both matches the ecosystem and
  dedupes the two. Rejected for the cross-tool `.agents/skills/`.
