# ADR 0128: The ignore block enumerates ownership; compiled guidance is tracked

**Status**: accepted; supersedes the _tracking default_ and the _ignore-block shape_ of [ADR 0034](0034-agents-md-untracked-currency-check.md) (whose currency check and tracked-artifacts guard survive unchanged, re-scoped here); builds on the deterministic compile from [ADR 0035](0035-guidance-templating-engine.md) and the gitignore convergence from [ADR 0093](0093-upgrade-reconciles-gitignore-block.md).

## Context

The pre-launch adversarial design review converged on two defects in the same two files, both verified against the repo and against vendor documentation:

1. **The shipped ignore block over-claimed.** `templates/.gitignore.fragment` ignored `/.claude/*`, negating only `settings.json`. Committing `.claude/commands/` is the documented, universal Claude Code team practice — so after discern installed, a user's new slash command silently never reached git, and if they forced it in, the gate's `tracked_artifacts` check told them to un-track their own file. That contradicted the trust story ("it writes only its own entries; your other settings stay") for exactly the wave-1 power user.

2. **The compiled guidance was invisible to cloud agents.** All compiled agent files were gitignored (ADR 0034), and a cloud agent cannot run `discern refresh` before reading. Verified against vendor docs, July 2026:

   | Agent surface                                            | Reads from a bare clone                                                                |
   | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
   | Claude Code (CLI, claude.ai/code, Actions)               | `CLAUDE.md` only; `@AGENTS.md` import works on all three; no native AGENTS.md fallback |
   | Gemini CLI                                               | `GEMINI.md` only (its `@` Memory Import expands `@AGENTS.md`)                          |
   | Codex, Copilot coding agent, Cursor, Google cloud agents | `AGENTS.md` directly                                                                   |

   So "every agent, same page" was false on a bare checkout — for discern's primary audience first, since the pointer files the cloud surfaces need were exactly the ones ignored.

3. **ADR 0034's escape hatch was mechanically impossible.** It claimed tracking was "a per-project `.gitignore` choice", but the detector derived its rules from the _shipped_ fragment — not the project's `.gitignore` — and `upgrade` reconciled user edits back out of the managed block. A project that committed `AGENTS.md` failed every gate run, forever.

## Decision

**1. The managed block enumerates exactly what discern owns.** The fragment lists only what discern materializes or keeps machine-local: `/.claude/skills/`, `/.claude/settings.local.json`, `/.agents/skills/`. The guidance files leave the block; the `/.claude/*` wildcard and its negation go entirely (`settings.json` is co-managed and simply stays trackable). A user file under a provider directory can never again be swept up.

**2. The distinction lives in the provider registry, per artifact kind.** `Provider` gains `localState`, and `agentArtifactPosture()` returns the three kinds — guidance files (tracked), materialized directories (ignored), machine-local state (ignored). The fragment's canonical block, its registry widening, and the gate's `tracked_artifacts` check all derive from that one source, so a future provider auto-enrols each path with the right posture. The reconciler still absorbs the guidance-file rules earlier versions shipped, so an upgraded install's compiled files become trackable again — curing the class, not the instance.

**3. The canonical file _and every pointer mirror_ are tracked by default.** The vendor table above is why the mirrors track too: `AGENTS.md` alone leaves cloud Claude and Gemini CLI blind. Pointers are static one-liners (`@AGENTS.md`), so tracking them adds zero diff churn. Fresh `setup` simply no longer ignores them — the flow's scaffolding commit captures them, and the consent relay discloses it in one line. Existing installs: `upgrade`'s managed-region reconcile narrows the block, leaving the files visible-but-untracked; `status` then recommends the one-time commit rather than force-adding on the user's behalf (status, not doctor: nothing is misconfigured, and the hint self-clears). A project that prefers the old posture ignores the files in its _own_ rules — now actually possible, because the detector reads only the canonical block and the untracked-guidance hint respects a deliberate ignore. This repo dogfoods the flip: its own `AGENTS.md` and both mirrors are committed.

**4. The drift guard is unchanged.** The stateless currency check (ADR 0034) is what makes tracking safe: `done` still blocks a stale compiled file and tolerates a missing one, so the tracked copies cannot silently diverge from their sources, and a project keeping them untracked still passes CI from a fresh clone.

**5. Ordering is framing, not configuration.** Users may bristle at the built-in guidance compiling before their own. The compiled file now opens by stating its two sources and that the project's guidance comes second _because it is the more specific authority and wins on conflict_.

## Consequences

- A Claude Code power user following their vendor's own docs never loses a file to discern's ignore rules, and the gate never orders them to un-track their own work.
- A cloud agent reading a bare clone gets the same compiled guidance a local session does, on every verified vendor surface.
- Guidance changes now show twice in review — the source diff and the recompiled output. The preamble and the currency check keep the compiled copy honest; the source remains the unit to review.
- One reconcile nuance is accepted: rules byte-identical to legacy discern-written ignores (e.g. a bare `/AGENTS.md` outside the block) are absorbed on upgrade, so a project opting back out should use its own ignore forms or re-add the rule after the one-time reconcile; the detector and the hint both respect the result.

## Alternatives considered

- **Track `AGENTS.md` only, keep the pointers ignored** (the review's original proposal). Rejected: the July 2026 vendor verification shows cloud Claude reads only `CLAUDE.md` and Gemini CLI only `GEMINI.md` — the mirrors are the cloud story for two vendors, and they cost nothing to track.
- **Keep everything ignored** (ADR 0034's default). Rejected: it privileges drift-hygiene over the primary audience actually receiving the guidance, and the currency check already neutralizes the drift argument.
- **A `discern.toml` ordering knob** for whose guidance compiles first. Rejected: the concern is authority, which the preamble states outright; a bool is additive to retrofit later if real users demand it, while removing one would be breaking.
- **A setup question about tracking.** Rejected: an opinionated default with a one-line disclosure keeps consent without adding a decision point novices cannot evaluate.
- **Force-adding the files on upgrade.** Rejected: `upgrade` edits files, never the git index; a recommendation the user applies is reversible and honest.
