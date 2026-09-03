---
aliases:
  - maintainer guide
  - human workflow
  - local maintainer setup
  - work with agents
---

# For humans

_The prerequisites, editor settings, and maintainer actions used alongside coding-agent work in this repository._

## Core idea: the engine belongs to the binary

discern is a self-contained Deno binary with the Engine compiled in as TypeScript under [`src/engine/`](../../../src/engine/). The Engine runs the project's final quality check (the Gate), the worktree workflow, Standards, and the instruction compiler. An installed project receives that Engine through the binary ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). This repository runs the same Engine from source with `discern done`, so the installed and source workflows share one implementation.

An install puts `discern.toml` at the root and keeps the Map, instructions, Skills, Project Scripts, ledger, and setup brief under `discern/` by default ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). [File ownership](../00-orientation/glossary.md#file-ownership) assigns those paths to project-owned, shared, or generated buckets. Project-owned files include the Map and authored files under `discern/`. Shared files include `discern.toml`, provider settings, and discern's delimited `.gitignore` block. Generated files include the tracked agent files (`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`) and the gitignored materialized-Skill directories. The full file-by-file inventory is in [install-surface.md](install-surface.md). Edit project-owned files in place. Rebuild generated files with `discern refresh` or `discern upgrade`.

## Prerequisites

- **[Deno](https://deno.com)** runs the source CLI, build, tests, and Project Scripts.
- **Git** with worktree support runs the worktree workflow, Standards, and `status` subprocesses.
- **[Vale](https://vale.sh)** runs the `prose` check over the Map during the Gate. The repository provisions its exact binary; do not manage it as a separate prerequisite.

The worktree hooks read their JavaScript Object Notation (JSON) payload in the binary, so they require no `jq` or other shell tool ([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). A [`Brewfile`](../../../Brewfile) at the repository root lists the base Homebrew dependencies for macOS maintainers. Run `brew bundle install` from the root.

Run `deno task vale:sync` after a fresh clone if you need the Gate in the main checkout. Managed worktree setup and post-landing convergence run it automatically through `[repository].ensure`. The task derives the release from [`.vale-version`](../../../.vale-version), verifies the platform checksum in [`.vale-assets.json`](../../../.vale-assets.json), and shares the content-addressed binary through the repository's Git common directory ([ADR 0337](../_adr/0337-vale-self-provisions-from-tracked-release-integrity.md)). A Homebrew `vale` binary is ignored and may be absent; `tar` supplies archive extraction on macOS, Linux, and Windows Subsystem for Linux 2 (WSL 2).

`discern doctor` verifies that Git and a Portable Operating System Interface (POSIX) `sh` resolve on `PATH`. Node is optional and used only by the Model Context Protocol (MCP) Inspector helper in [Inspecting the MCP server](#inspecting-the-mcp-server). The Gate, build, and tests do not use Node.

Stack-specific setup (installing project dependencies, running the app) lives in [getting-started.md](getting-started.md) once `discern setup` has filled it in.

## IDE setup

### JetBrains (IntelliJ / PHPStorm)

- **[Worktrees](../00-orientation/glossary.md#worktree).** Agent worktrees default to a sibling directory (`<repo>.worktrees/`) outside the project and beyond IDE indexing. If you point `[worktree].root` inside the repository, recent IDE versions detect and hide Git worktrees.
- **Colors.** The scopes are committed in [`.idea/scopes/`](../../../.idea/scopes/). Assign colors once in **Settings → Editor → File Colors**, and select _Share_ so they travel with the repository: `Tests` is blue, `Templates` is green, and `Managed and generated` is rose or orange. The last scope covers `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/`, and `.agents/skills/`; its color marks files whose authored source lives elsewhere.
- **Search exclusions.** To remove generated files from search, mark `.claude/skills/` and `.agents/skills/` as excluded. Use file colors when you want those folders visible and marked. Excluded folders ignore file colors.

### VS Code

[`.vscode/settings.json`](../../../.vscode/settings.json) already hides the worktrees and the generated/ephemeral output, and keeps the materialized skills out of search. There is no simple built-in equivalent for the color-coding.

### Any editor

Edit the agent files at their authored source. `discern refresh` compiles `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` from discern's built-in instructions plus this repository's [`project/instructions.md`](../../instructions.md), and the repository commits the results ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Edit the instruction source, run `discern refresh`, and commit the regenerated files.

## Working alongside the agents

- Run bare `discern` from the main checkout to open [the desk](../30-worktrees/the-desk.md). Its `Start a task` action creates and readies a worktree from an optional name, then opens that row immediately; `Open with agent` appears for each coding-agent CLI that is both configured in the worktree and available on `PATH`.
- Agent sessions run in linked Git worktrees. Each has its own checkout under `<repo>.worktrees/<name>/` by default; `[worktree].root` configures the location.
- To land an agent's finished branch, run [`discern accept`](../30-worktrees/lifecycle.md#land-the-reviewed-commit) from its worktree. A valid Proof for the clean `HEAD` lets acceptance reuse the earlier Gate result. Without a current Proof, acceptance runs the Gate. It then fast-forwards the trunk to the branch tip, tears the worktree down, and deletes the merged branch. The trunk is the single landing target (ADR 0110). Acceptance refuses a dirty tree and a main checkout parked off the trunk. Commit a dirty tree first. To review or build on work that is not ready to land, keep the branch and pull it into a worktree with `discern start --from <source>` or `discern update --from <source>`; the source may be a ref or an unambiguous worktree id or path.
- To discard an abandoned worktree, run `discern worktree drop <id>` from the main checkout. Without `--force`, the command refuses when it would lose commits outside the trunk or uncommitted changes.
- Run the Gate at any time with `discern done`, or its repository alias `deno task gate`. Use `discern prepare` for fixers, declared regenerations, refresh convergence, and checks, and `discern doctor` for the install health check. In this repository, the development wrapper runs each command against the current checkout's Engine.

## Previewing terminal art

Run `deno task art` from any checkout to print every registered terminal-art design in stable order. The original mark variants come first, followed by the triangle dividers, weave, spinner storyboard, progress, section rule, stepper, and activity beacon. Add `--animate` to play each design once before the command restores that same static gallery:

```sh
deno task art --animate
```

Motion is opt-in. A pipe, CI run, `TERM=dumb`, or terminal without a spare wrapping row and column receives the static gallery with no cursor controls. If the terminal becomes too small during playback, the command stops redrawing and prints the static gallery below the existing output.

[`scripts/art.ts`](../../../scripts/art.ts) is the thin task entrypoint for the maintainer helper. The implementation lives beside the art it previews in [`art/terminal/`](../../../art/terminal/), outside the discern CLI verbs, Gate jobs, templates, and compiled-binary surfaces. The variant registry in [`brand.ts`](../../../art/terminal/brand.ts) and motif registry in [`triangle.ts`](../../../art/terminal/triangle.ts) own membership. The motif registry also exports the pure frame functions for reuse. Add a new design to its owning registry with static and animated renderers. Both gallery projections then include it automatically.

For the combined browser archive, run `deno task site:art` and open the printed address at `/art/`. The development-only page renders every approved geometric motion study in fixed light and dark themes, then renders these same terminal registries as static terminal mockups. Browser-art membership lives in [`art/browser/registry.ts`](../../../art/browser/registry.ts); its typed renderer table and each study's geometry and motion stay in neighboring files.

## Inspecting the MCP server

`deno task inspect-mcp` opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) against discern's own MCP server (`discern mcp`, run from source). Use it to inspect annotations, input and output schemas, and resources while editing [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts). The default opens the browser user interface (UI). Append `--cli --method tools/list`, or `tools/call --tool-name … --tool-arg k=v`, for a one-shot terminal call. The script header in [`scripts/inspect_mcp.ts`](../../../scripts/inspect_mcp.ts) documents the full command.

The Inspector is a human debugging helper under `scripts/`, outside `templates/`. The Gate and binary omit it. Node is required only for this helper because the Inspector launches Node subprocesses (`spawnPromise("node", …)`) through `npx`. The [`Brewfile`](../../../Brewfile) therefore leaves Node as a commented optional maintainer dependency. Install Node when you need the Inspector.

## Keeping this page current

This is a project-owned page. Edit it in place when the IDE config, prerequisites, or maintainer workflow changes.
