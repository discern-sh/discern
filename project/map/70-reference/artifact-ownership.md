---
title: Files & ownership
description: Every file discern writes or shares, who owns each, whether git tracks it, and how uninstall removes it.
order: 40
publish: true
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

_Every file discern creates or merges into, who owns each, whether git tracks or ignores it, and the command that removes the wiring._

discern writes one committed root file, one visible namespace, the agent files each vendor requires, and a short list of shims. A test fails if any verb writes anywhere else ([`paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts)). Everything it writes has an ownership kind, and the kind decides what `discern upgrade` may touch and how git treats the file.

## Yours: the `discern/` namespace

Plain Markdown at paths you chose or accepted ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). discern writes no generated artifacts inside the namespace, and `upgrade` leaves these files unchanged.

| Path                  | What it is                                             |
| --------------------- | ------------------------------------------------------ |
| `discern/guidance.md` | Your discern guidance, compiled into the agent files.  |
| `map/`                | The documentation map discern scaffolds and maintains. |
| `discern/skills/`     | Any skills you author.                                 |
| `discern/scripts/`    | Any executable project scripts you add.                |
| `discern/TODO.md`     | The deferred-work ledger agents read and keep.         |
| `discern/brief.md`    | The project brief captured at setup.                   |

Each path is configurable (`[map].dir` can name any directory), and the map is discern's own tree: setup creates it instead of adopting documentation you curate yourself ([ADR 0131](../_adr/0131-setup-never-adopts-existing-docs.md)).

## Co-managed: tracked files discern shares with you

discern owns a delimited region of each and leaves the rest alone.

- **`discern.toml`** — the root file, your configuration. discern restores missing fixed sections and keys and replaces clean ruled banners from the current template ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)); it preserves values you set and comments outside those delimiters.
- **The `.gitignore` block** — one `# --- discern ---` block listing the ignored artifact kinds below. Your own rules outside the block are untouched.
- **The per-agent integration files** — for each coding agent you configure, discern merges its MCP server, session hooks, and a couple of permission defaults into that agent's own config files (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, and the rest). It writes only its own entries. The [per-agent pages](../60-agent-integrations/) list the exact files.

## The binary's: generated and rebuilt by refresh

Produced from bundled sources plus your guidance on `discern refresh` and safe to overwrite because the reviewable source is your file. Each generated artifact has a declared kind in the provider registry ([`src/lib/providers.ts`](../../../src/lib/providers.ts), `agentArtifactPosture()`), and the kind decides how git treats it ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)):

| Kind                   | Examples                              | In git  |
| ---------------------- | ------------------------------------- | ------- |
| Compiled agent file    | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | tracked |
| Materialized directory | `.claude/skills/`, `.agents/skills/`  | ignored |
| Machine-local state    | `.claude/settings.local.json`         | ignored |

Everything downstream reads that registry, so nothing can disagree with it: the managed `.gitignore` block enumerates only the ignored kinds and uses no wildcard, which leaves your other files under a provider directory alone. A newly added provider's paths join the block automatically, and the gate's `tracked_artifacts` check flags only a forced-in ignored artifact.

**Why compiled agent files are tracked.** A cloud agent reads a bare clone and can't run `discern refresh` first; committing the compiled agent files means every vendor's agent file reads the same page. The currency check in `discern done` blocks a stale copy ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)), so the tracked copies can't drift from their sources. The materialized skills stay ignored and rebuild wherever the binary runs; the [CI and cloud-agent notes](../20-quality-gate/ci.md) cover what a clone without the binary sees.

**Prefer the compiled files untracked?** Ignore them in your own `.gitignore` rules, outside the managed block. The gate tolerates a missing copy and nothing nags. On `discern upgrade`, an older, wider block reconciles down to the enumerated form ([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md)); the compiled files then show as untracked and `discern status` recommends the one-time commit. discern leaves staging to you.

## Machine-local state inside `.git`

Everything else discern records lives under the git admin area — outside the project tree, never in a commit, never needing a gitignore entry, and gone with the repository:

| Path under `.git`         | What it is                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `discern/resources/`      | The per-worktree resource ledger orphan GC reads.                                                            |
| `discern/logbook/`        | The [logbook](../00-orientation/trust-and-data.md): one metadata-only line per verb run, plus its epoch state. |
| gate receipt + sentinels  | The recorded `done` outcome, the worktree ready sentinel, and the ignored-file baseline.                      |

The write-surface test covers these too: a verb that wrote this state anywhere new would fail the gate.

## What runs on your machine

discern's trust model is the same class as a `Makefile` or an npm `scripts` block: it runs the commands you configure. The gate runs the commands in your `discern.toml`, and no others; a scope gate or a standard runs the command you wrote for it; a project script is your own executable. Read-only verbs (`status`, `doctor`, the docs browsers) run none of them. discern makes zero network calls and ships no telemetry. A newer discern binary arrives when you re-run the installer.

## Removing it all

`discern uninstall` removes the compiled agent files and materialized skills, strips discern's entries from the co-managed files, and removes the `.gitignore` block ([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)). Preview with `discern uninstall --dry-run`.

It keeps your content: `discern.toml` and the `discern/` namespace stay. If it can't resolve its bundled templates, it leaves the template-seeded entries in a co-managed settings file rather than guess, and names each such file so you can finish by hand. It refuses while a worktree is in flight, and it is a CLI-only verb (no MCP tool exposes it), so an agent can't uninstall discern mid-session; that decision needs a person at the terminal. The binary itself is one file on your `PATH`, removed by hand — the file `which discern` reports.

## Where it lives in code

| Concept                        | File                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Artifact kinds                 | [`src/lib/providers.ts`](../../../src/lib/providers.ts) (`agentArtifactPosture`)  |
| The write-surface guard        | [`tests/paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts) |
| The managed `.gitignore` block | [`src/lib/agent_gitignore.ts`](../../../src/lib/agent_gitignore.ts)               |
| Uninstall                      | [`src/commands/uninstall.ts`](../../../src/commands/uninstall.ts)                 |

## See also

- [The install surface](../80-development/install-surface.md) — the exhaustive, by-disposition engineering inventory this page distills.
- [Agent integrations](../60-agent-integrations/) — the exact file table per coding agent.
- [Trust & your data](../00-orientation/trust-and-data.md) — the network, telemetry, and execution contract on one screen.
