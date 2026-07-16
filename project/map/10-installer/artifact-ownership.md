---
title: Files & ownership
description: Every file discern writes or shares, who owns each, its git posture, and how uninstall takes it all back out.
order: 30
redirect_from:
  - /docs/installer/what-discern-writes
aliases:
  - files
  - ownership
  - footprint
  - gitignore
  - uninstall
---

# Files & ownership

_Every file discern creates or merges into, who owns each, its git posture,
and the one command that removes the wiring._

discern writes one committed root file, one visible namespace, the agent files
each vendor requires, and a short list of shims. A test fails the moment any
verb writes anywhere else
([`paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts)).
Everything it writes falls into one of three ownership kinds, and the kind
decides what `discern upgrade` may touch and how git treats the file.

## Yours: the `discern/` namespace

Plain Markdown at paths you chose or accepted
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
discern never writes a generated artifact inside the namespace, and `upgrade`
never rewrites these files.

| Path                  | What it is                                             |
| --------------------- | ------------------------------------------------------ |
| `discern/guidance.md` | Your discern guidance, compiled into the agent files.  |
| `map/`                | The documentation map discern scaffolds and maintains. |
| `discern/skills/`     | Any skills you author.                                 |
| `discern/scripts/`    | Any executable project scripts you add.                |
| `discern/TODO.md`     | The deferred-work ledger agents read and keep.         |
| `discern/brief.md`    | The project brief captured at setup.                   |

Each path is configurable (`[map].dir` can name any directory), and the map
is discern's own tree: setup never points it at documentation you curate
yourself ([ADR 0131](../_adr/0131-setup-never-adopts-existing-docs.md)).

## Co-managed: tracked files discern shares with you

discern owns a delimited region of each and leaves the rest alone.

- **`discern.toml`** — the one root file, your configuration. discern restores
  missing fixed sections and keys and replaces clean ruled banners from the
  current template ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md));
  it never touches values you set or comments outside those delimiters.
- **The `.gitignore` block** — one `# --- discern ---` block listing the
  ignored artifact kinds below. Your own rules outside the block are untouched.
- **The per-agent integration files** — for each coding agent you configure,
  discern merges its MCP server, session hooks, and a couple of permission
  defaults into that agent's own config files (`.mcp.json`,
  `.claude/settings.json`, `.codex/config.toml`, and the rest). It writes only
  its own entries. The [per-agent pages](../60-agent-integrations/) list the
  exact files.

## The binary's: generated, rebuilt on demand

Produced from bundled sources plus your guidance on `discern refresh`; always
safe to overwrite, because the reviewable source is your file, not the output.
Each generated artifact has a declared kind in the provider registry
([`src/lib/providers.ts`](../../../src/lib/providers.ts),
`agentArtifactPosture()`), and the kind decides the git posture
([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)):

| Kind                   | Examples                              | Git posture |
| ---------------------- | ------------------------------------- | ----------- |
| Compiled guidance file | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | tracked     |
| Materialized directory | `.claude/skills/`, `.agents/skills/`  | ignored     |
| Machine-local state    | `.claude/settings.local.json`         | ignored     |

Three surfaces derive from that single source, so they can never disagree: the
managed `.gitignore` block enumerates only the ignored kinds (no wildcard — a
file of your own under a provider directory is never swept up); a newly added
provider's paths join the block automatically; and the gate's
`tracked_artifacts` check flags only a forced-in ignored artifact.

**Why guidance files are tracked.** A cloud agent reads a bare clone and can't
run `discern refresh` first; committing the compiled files means every vendor
surface reads the same page, and the currency check in `discern done` blocks a
stale copy ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)) —
which is what makes a tracked derivative safe. The materialized skills stay
ignored and rebuild wherever the binary runs; the
[CI and cloud-agent notes](../20-quality-gate/ci.md) cover what a clone without
the binary sees.

**Prefer the old untracked posture?** Ignore the compiled files in your own
`.gitignore` rules, outside the managed block. The gate tolerates a missing
copy and nothing nags. On `discern upgrade`, an older, wider block reconciles
down to the enumerated form
([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md)); the compiled
files then show as untracked and `discern status` recommends the one-time
commit. discern never runs `git add` on your behalf.

## What runs on your machine

discern's trust model is the same class as a `Makefile` or an npm `scripts`
block: it runs the commands you configure. The gate runs exactly the commands
in your `discern.toml`; a scope gate or a standard runs the command you wrote
for it; a project script is your own executable. Read-only verbs (`status`,
`doctor`, the docs browsers) never run any of them. discern makes zero network
calls and ships no telemetry; getting a newer discern is a deliberate act
(re-running your installer), never an automatic update.

## Removing it all

`discern uninstall` removes the generated agent files and materialized skills,
strips discern's entries from the co-managed files, and removes the
`.gitignore` block ([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)).
Preview with `discern uninstall --dry-run`.

It keeps your content: `discern.toml` and the whole `discern/` namespace stay —
plain files, valuable without the tool. If it can't resolve its bundled
templates, it leaves the template-seeded entries in a co-managed settings file
rather than guess, and names each such file so you can finish by hand. It
refuses while a worktree is in flight, and it is a CLI verb by design: pulling
discern out is a decision you make, not one an agent reaches for mid-session.
The binary itself is one file on your `PATH`, removed by hand — the file
`which discern` reports.

## Where it lives in code

| Concept                            | File                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Artifact kinds and postures        | [`src/lib/providers.ts`](../../../src/lib/providers.ts) (`agentArtifactPosture`) |
| The write-surface guard            | [`tests/paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts) |
| The managed `.gitignore` block     | [`src/lib/agent_gitignore.ts`](../../../src/lib/agent_gitignore.ts)              |
| Uninstall                          | [`src/commands/uninstall.ts`](../../../src/commands/uninstall.ts)                |

## See also

- [The install surface](../80-development/install-surface.md) — the exhaustive,
  by-disposition engineering inventory this page distills.
- [Agent integrations](../60-agent-integrations/) — the exact file table per
  coding agent.
- [Trust & your data](../00-orientation/trust-and-data.md) — the network,
  telemetry, and execution story on one screen.
