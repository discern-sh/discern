# For humans

_Almost everything in this repo is built to be driven by coding agents — the guidance, the Skills, the gate, the worktree workflow. This page is the exception: the short list of what a **human** with the repo checked out does for a reliable experience. (Agents keep this page current too.)_

## Core idea: the engine belongs to the binary

discern is **one self-contained Deno binary** with the engine (the gate, the worktree workflow, standards, the guidance compiler) compiled in as TypeScript under [`src/engine/`](../../../src/engine/). An installed project receives that engine through the binary ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). This repo self-hosts by running the same engine from source (`discern done`), leaving a single implementation with no copy drift.

An install puts `discern.toml` and `map/` at the root by default, plus the `discern/` namespace for guidance, skills, project scripts, the ledger, and the setup brief ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). [File ownership](../00-orientation/glossary.md#file-ownership) splits those paths into _project-owned_ files (the map and authored files under `discern/`), _shared_ files (`discern.toml`, provider settings, and discern's delimited `.gitignore` block), and _generated_ files (the tracked agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md` and the gitignored materialized-skills directories). The full file-by-file inventory is in [install-surface.md](install-surface.md). Edit project-owned files in place; rebuild generated files with `discern refresh` or `discern upgrade`.

## Prerequisites

- **[Deno](https://deno.com)** — runs the source CLI, build, tests, and project scripts.
- **git** with worktree support (any recent version) — the worktree workflow, standards, and `status` all shell out to it.
- **[Vale](https://vale.sh)** — the `prose` check runs it over the map during the gate.

Those are the required tools. The worktree hooks read their JSON payload in the binary, so there is no `jq` or other shell-tool dependency ([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). A [`Brewfile`](../../../Brewfile) at the repo root pins the toolchain for macOS/Homebrew users (`brew bundle install` from the root); `discern doctor` verifies that `git` and a POSIX `sh` resolve on `PATH`. **Node** is optional and used only by the MCP Inspector helper ([below](#inspecting-the-mcp-server)). The gate, build, and tests do not use it.

Stack-specific setup (installing project dependencies, running the app) lives in [getting-started.md](getting-started.md) once `discern setup` has filled it in.

## IDE setup

### JetBrains (IntelliJ / PHPStorm)

- **[Worktrees](../00-orientation/glossary.md#worktree)** — agent worktrees default to a sibling directory (`<repo>.worktrees/`) outside the project and beyond IDE indexing; no action needed. (If you point `[worktree].root` back inside the repo, recent versions detect and hide git worktrees for you.)
- **Colors** — the scopes are committed in [`.idea/scopes/`](../../../.idea/scopes/). Assign colors once in **Settings → Editor → File Colors**, ticking _Share_ so they travel with the repo: `Tests` → blue, `Templates` → green, `Managed and generated` (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` plus `.claude/skills/` and `.agents/skills/`) → rose or orange (your "don't touch" color).
- **Optional** — to remove generated files from search, mark `.claude/skills/` and `.agents/skills/` as excluded. Use file colors when you want those folders visible and marked; excluded folders ignore file colors.

### VS Code

[`.vscode/settings.json`](../../../.vscode/settings.json) already hides the worktrees and the generated/ephemeral output, and keeps the materialized skills out of search. There is no simple built-in equivalent for the color-coding.

### Any editor

Don't hand-edit the agent files: `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are compiled from discern's built-in guidance plus this repo's own [`project/guidance.md`](../../guidance.md) by `discern refresh` and committed ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Edit that source and recompile.

## Working alongside the agents

- Run bare `discern` from the main checkout to open [the desk](../30-worktrees/the-desk.md). Its `Start a task` action creates and readies a worktree from an optional name, then opens that row immediately; `Open with agent` appears for each coding-agent CLI that is both configured in the worktree and available on `PATH`.
- Agent sessions run in linked git worktrees — by default a sibling of the repo, `<repo>.worktrees/<name>/` (configurable via `[worktree].root`), each with its own checkout.
- To land an agent's finished branch, run [`discern accept`](../30-worktrees/lifecycle.md#land-the-reviewed-commit) from its worktree. It honors the clean HEAD's gate receipt, or runs the gate when no current receipt exists, then fast-forwards your trunk to the branch tip, tears the worktree down, and deletes the merged branch — the trunk is the single landing target (ADR 0110). It refuses a dirty tree (commit first) and a main checkout parked off the trunk. To review or build on work that isn't ready to land, leave it as a branch and pull it into a worktree with `discern start --from <ref>` / `discern update --from <ref>` instead.
- To discard an abandoned worktree, run `discern worktree drop <id>` from the main checkout — it refuses without `--force` when commits not on the trunk or uncommitted changes would be lost.
- Drive the gate yourself any time: `discern done` (the full gate, also `deno task gate`), `discern prepare` (fast: fixers + checks), and `discern doctor` (health check). In this repo the dev wrapper runs them against the current checkout's own engine.

## Inspecting the MCP server

`deno task inspect-mcp` opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) against discern's own MCP server (`discern mcp`, run from source). Use it to inspect annotations, input/output schemas, and resources while editing [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts). The default opens the browser UI; append `--cli --method tools/list` (or `tools/call --tool-name … --tool-arg k=v`) for a one-shot terminal call. Full usage is in the script header, [`scripts/inspect_mcp.ts`](../../../scripts/inspect_mcp.ts).

It is a **human-only debugging convenience** — not part of the gate, and not bundled into the binary (it lives in `scripts/`, outside `templates/`). It is the repo's one tool that needs **Node** on `PATH`: the Inspector is a Node application that launches Node subprocesses (`spawnPromise("node", …)`), so it runs via `npx` and cannot run under Deno alone. Node is therefore an optional maintainer dependency — commented in the [`Brewfile`](../../../Brewfile); install it only if you want the Inspector.

## Keeping this page current

This is one of your files — edit it in place. When the IDE config, the prerequisites, or the human workflow change, update it here (an agent can too).
