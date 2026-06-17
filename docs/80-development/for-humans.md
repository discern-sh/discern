# For humans

_Almost everything in this repo is built to be driven by coding agents — the
guidelines, the skills, the gate, the worktree workflow. This page is the
exception: the short list of what a **human** with the repo checked out does for
a reliable experience. (Agents keep this page current too.)_

## The one idea to hold onto: the harness exists twice

icculus self-hosts, so the harness is present in two places:

- [`templates/`](../../templates/) — the **source of truth** you edit, and
- the **root install** that actually runs (`bin/agent`, `.icculus/engine/`,
  `.ai/skills/`) — managed copies kept byte-identical to `templates/` by the
  `selfcheck` gate.

Change a managed file at its `templates/` source and run `deno task selfsync`;
never edit the root copy, because the gate overwrites it. The full file-by-file
map is in [install-surface.md](install-surface.md), and the four file
[dispositions](../00-orientation/glossary.md#file-dispositions) are defined in
the glossary.

## Prerequisites

- **[Deno](https://deno.com)** — the only toolchain the harness itself needs
  (`deno task`, the gate, `bin/agent`).
- **git** with worktree support (any recent version).
- **jq** — used by the worktree hooks in `.claude/settings.json`, so an agent
  session that creates or removes a worktree needs it on `PATH`.
- A **POSIX shell** — the engine is portable `sh`; macOS and Linux have one out
  of the box.

Stack-specific setup (installing project dependencies, running the app) lives in
[getting-started.md](getting-started.md) once `/bootstrap` has filled it in.

## IDE setup

### JetBrains (IntelliJ / PHPStorm)

- **Worktrees** — recent versions detect git worktrees and hide
  `.claude/worktrees/` for you; no action needed.
- **Colours** — the scopes are committed in
  [`.idea/scopes/`](../../.idea/scopes/). Assign colours once in **Settings →
  Editor → File Colors**, ticking _Share_ so they travel with the repo: `Tests`
  → blue, `Templates` → green, `Managed and generated` → rose or orange (your
  "don't touch" colour).
- **Optional** — to drop the managed mirror out of search entirely, right-click
  `bin/`, `.icculus/engine/`, and `.ai/skills/` → _Mark Directory as →
  Excluded_. This is an alternative to the rose colour, not an addition:
  excluded folders ignore file colours.

### VS Code

[`.vscode/settings.json`](../../.vscode/settings.json) already hides the
worktrees and the generated/ephemeral output, and keeps the managed mirror out
of search. There is no simple built-in equivalent for the colour-coding.

### Any editor

Don't hand-edit generated files: `CLAUDE.md` and `AGENTS.md` are compiled from
[`.ai/guidelines/`](../../.ai/guidelines/) by the `guidelines` recipe. Edit the
guidelines source and recompile with `./bin/agent guidelines`.

## Working alongside the agents

- Agent sessions run in linked git worktrees under `.claude/worktrees/<name>/`,
  each with its own checkout.
- To take over an agent's branch and continue in the main checkout, run the
  [`handoff-worktree`](../../.ai/skills/handoff-worktree/SKILL.md) skill. It
  runs `agent worktree:exit`, which commits the work, tears the worktree down,
  and checks the branch out in the main repo.
- Drive the gate yourself any time: `./bin/agent finish` (the full gate),
  `./bin/agent tidy` (fast: fixers + checks), and `./bin/agent doctor` (health
  check).

## Keeping this page current

This is a seed doc — edit it in place. When the IDE config, the prerequisites,
or the human workflow change, update it here (an agent can too).
