# For humans

_Almost everything in this repo is built to be driven by coding agents — the
guidelines, the skills, the gate, the worktree workflow. This page is the
exception: the short list of what a **human** with the repo checked out does for
a reliable experience. (Agents keep this page current too.)_

## The one idea to hold onto: the engine is the binary's, not on disk

discern is **one self-contained Deno binary** with the engine (the gate, the
worktree workflow, ratchets, the guideline compiler) compiled in as TypeScript
under [`src/engine/`](../../src/engine/). A project never has a committed copy
of the engine — it lives in the binary
([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). This repo self-hosts by
running its own engine from source (`deno task dev finish`), so there is **no**
second copy to keep in sync and nothing that can drift.

What an install does lay down is anchored by **one root file, `discern.toml`**
([ADR 0020](../_adr/0020-dissolve-discern-dir.md)). Files split into **two
buckets**: _your_ committed files (`discern.toml`, the `brief.md` seed, and the
content you author at config-pointed paths — `guidance.md`, `./skills/`,
`./recipes/` — plus the merged settings/gitignore), and _the binary's_
gitignored, re-published artifacts (the materialised `.claude/skills/` and the
compiled agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, all gitignored — ADR
0034). The full file-by-file map is in [install-surface.md](install-surface.md),
and the [dispositions](../00-orientation/glossary.md#file-dispositions) are
defined in the glossary. Edit your files in place; the binary's artifacts are
produced from source in this repo and overwritten on `upgrade`.

## Prerequisites

- **[Deno](https://deno.com)** — the only toolchain this repo needs
  (`deno task`, the gate from source).
- **git** with worktree support (any recent version).
- **jq** — used by the worktree hooks in `.claude/settings.json`, so an agent
  session that creates or removes a worktree needs it on `PATH`.

Stack-specific setup (installing project dependencies, running the app) lives in
[getting-started.md](getting-started.md) once `discern setup` has filled it in.

## IDE setup

### JetBrains (IntelliJ / PHPStorm)

- **Worktrees** — recent versions detect git worktrees and hide
  `.claude/worktrees/` for you; no action needed.
- **Colours** — the scopes are committed in
  [`.idea/scopes/`](../../.idea/scopes/). Assign colours once in **Settings →
  Editor → File Colors**, ticking _Share_ so they travel with the repo: `Tests`
  → blue, `Templates` → green, `Generated`
  (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` + `.claude/skills/`) → rose or orange
  (your "don't touch" colour).
- **Optional** — to drop the binary's re-published artifacts out of search
  entirely, right-click `.claude/skills/` → _Mark Directory as → Excluded_. This
  is an alternative to the rose colour, not an addition: excluded folders ignore
  file colours.

### VS Code

[`.vscode/settings.json`](../../.vscode/settings.json) already hides the
worktrees and the generated/ephemeral output, and keeps the materialised skills
out of search. There is no simple built-in equivalent for the colour-coding.

### Any editor

Don't hand-edit the generated agent files: `AGENTS.md`, `CLAUDE.md`, and
`GEMINI.md` (all gitignored build artifacts — ADR 0034) are compiled from
discern's built-in guidance plus your [`guidance.md`](../../guidance.md) by
`discern refresh`. Edit your guidance source and recompile — in this repo, with
`deno task dev refresh`.

## Working alongside the agents

- Agent sessions run in linked git worktrees under `.claude/worktrees/<name>/`,
  each with its own checkout.
- To take over an agent's branch and continue in the main checkout, run the
  [`handoff-worktree`](../../templates/skills/handoff-worktree/SKILL.md) skill.
  It runs `discern graduate`, which commits the work, tears the worktree down,
  and checks the branch out in the main repo.
- Drive the gate yourself any time. In this repo (self-hosting from source):
  `deno task dev finish` (the full gate, also `deno task gate`),
  `deno task dev prepare` (fast: fixers + checks), and `deno task dev doctor`
  (health check). In a project with the binary on `PATH`, these are
  `discern finish` / `discern prepare` / `discern doctor`.

## Keeping this page current

This is one of your files — edit it in place. When the IDE config, the
prerequisites, or the human workflow change, update it here (an agent can too).
