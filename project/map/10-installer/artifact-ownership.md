# Artifact ownership — what is tracked, what is ignored, and why

_The per-kind posture behind the managed `.gitignore` block: compiled guidance
travels with the repo; materialized and machine-local artifacts stay out of it._

Every agent-facing artifact discern produces has one of three kinds, declared in
the provider registry ([`src/lib/providers.ts`](../../../src/lib/providers.ts),
`agentArtifactPosture()`)
([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)):

| Kind                   | Examples                              | Git posture |
| ---------------------- | ------------------------------------- | ----------- |
| Compiled guidance file | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | tracked     |
| Materialized directory | `.claude/skills/`, `.agents/skills/`  | ignored     |
| Machine-local state    | `.claude/settings.local.json`         | ignored     |

The kind decides the posture, and three surfaces derive from that single source,
so they can never disagree:

- **The managed block** in `.gitignore` (between `# --- discern ---` markers)
  enumerates only the ignored kinds. There is no wildcard: a file of your own
  under a provider directory — a `.claude/commands/` slash command, say — is
  never swept up.
- **The registry widening**: a newly added provider's materialized and local
  paths join the canonical block automatically; its guidance file never does.
- **The gate's `tracked_artifacts` check** flags only a forced-in materialized
  or machine-local path. Tracked guidance files pass; so do your own files.

## Why guidance is tracked

A cloud agent reads a bare clone and cannot run `discern refresh` first.
Committing the canonical file and its one-line pointer mirrors means every
verified vendor surface — local or cloud — reads the same compiled page. The
currency check in `discern done` blocks a stale copy, which is what makes a
tracked derivative safe: it cannot silently drift from its source.

## Changing the default

Prefer the old untracked posture? Ignore the compiled files in your **own**
`.gitignore` rules, outside the managed block. The gate tolerates a missing
copy, the tracked-artifacts check reads only the managed block, and the `status`
commit hint respects a deliberate ignore — nothing nags.

## On upgrade

`discern upgrade` reconciles an older, wider block (guidance-file rules, the
`/.claude/*` wildcard) down to the enumerated form; the compiled files then show
as untracked, and `discern status` recommends the one-time commit. discern never
runs `git add` on your behalf.

## See also

- [what-discern-writes.md](what-discern-writes.md) — the whole footprint.
- The decision record, with the per-vendor verification table
  ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)).
