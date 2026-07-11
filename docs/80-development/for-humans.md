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
running its own engine from source (`discern done`), so there is **no** second
copy to keep in sync and nothing that can drift.

What an install lays down is **one root file, `discern.toml`, plus one visible
folder, `discern/`** — enforced by test
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
Files split into **two buckets**: _your_ committed files (`discern.toml`, the
namespace content — guidance, skills, recipes, the map, the ledger, the brief,
each config-pointable elsewhere — plus the merged settings/gitignore), and _the
binary's_ gitignored, re-published artifacts (the materialised skills dirs and
the compiled agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` — ADR 0034). The
full file-by-file map is in [install-surface.md](install-surface.md), and the
[dispositions](../00-orientation/glossary.md#file-dispositions) are defined in
the glossary. Edit your files in place; the binary's artifacts are produced from
source in this repo and overwritten on `upgrade`.

## Prerequisites

- **[Deno](https://deno.com)** — the only toolchain this repo needs
  (`deno task`, the gate from source).
- **git** with worktree support (any recent version) — the worktree workflow,
  ratchets, and `status` all shell out to it.

That is the whole list: the worktree hooks read their JSON payload in the binary
itself, so there is no `jq` (or other shell-tool) dependency
([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). A
[`Brewfile`](../../Brewfile) at the repo root pins the toolchain for
macOS/Homebrew users (`brew bundle install` from the root); `discern doctor`
verifies that `git` and a POSIX `sh` resolve on `PATH`. The one _optional_ extra
is **Node**, needed only for the MCP Inspector helper
([below](#inspecting-the-mcp-server)) — never for the gate, build, or tests.

Stack-specific setup (installing project dependencies, running the app) lives in
[getting-started.md](getting-started.md) once `discern setup` has filled it in.

## IDE setup

### JetBrains (IntelliJ / PHPStorm)

- **Worktrees** — agent worktrees default to a sibling directory
  (`<repo>.worktrees/`) outside the project, so the IDE never indexes them; no
  action needed. (If you point `[worktree].root` back inside the repo, recent
  versions detect and hide git worktrees for you.)
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
discern's built-in guidance plus this repo's own
[`guidance.md`](../../guidance.md) (a config-pointed, non-default location) by
`discern refresh`. Edit your guidance source and recompile.

## Working alongside the agents

- Agent sessions run in linked git worktrees — by default a sibling of the repo,
  `<repo>.worktrees/<name>/` (configurable via `[worktree].root`), each with its
  own checkout.
- To land an agent's finished branch, run
  [`discern accept`](../30-worktrees/README.md) from its worktree. It re-runs
  the gate, fast-forwards your trunk to the branch tip, tears the worktree down,
  and deletes the merged branch — the trunk is the single landing target (ADR
  0110). It refuses a dirty tree (commit first) and a main checkout parked off
  the trunk. To review or build on work that isn't ready to land, leave it as a
  branch and pull it into a worktree with `discern start --from <ref>` /
  `discern update --from <ref>` instead.
- To discard an abandoned worktree, run `discern worktree drop <id>` from the
  main checkout — it refuses without `--force` when commits not on the trunk or
  uncommitted changes would be lost.
- Drive the gate yourself any time: `discern done` (the full gate, also
  `deno task gate`), `discern prepare` (fast: fixers + checks), and
  `discern doctor` (health check). In this repo the dev wrapper runs them
  against the current checkout's own engine.

## Inspecting the MCP server

`deno task inspect-mcp` opens the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) against
discern's own MCP server (`discern mcp`, run from source), for eyeballing the
tool surface — annotations, input/output schemas, resources — while editing
[`src/engine/mcp/server.ts`](../../src/engine/mcp/server.ts). The default opens
the browser UI; append `--cli --method tools/list` (or
`tools/call --tool-name … --tool-arg k=v`) for a one-shot terminal call. Full
usage is in the script header,
[`scripts/inspect_mcp.ts`](../../scripts/inspect_mcp.ts).

It is a **human-only debugging convenience** — not part of the gate, and not
bundled into the binary (it lives in `scripts/`, outside `templates/`). It is
the repo's one tool that needs **Node** on `PATH`: the Inspector is a Node
application that launches Node subprocesses (`spawnPromise("node", …)`), so it
runs via `npx` and cannot run under Deno alone. Node is therefore an optional
maintainer dependency — commented in the [`Brewfile`](../../Brewfile); install
it only if you want the Inspector.

## Keeping this page current

This is one of your files — edit it in place. When the IDE config, the
prerequisites, or the human workflow change, update it here (an agent can too).
