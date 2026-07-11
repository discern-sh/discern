# What just happened to your repo

_You said yes to setup. Here's every file discern added or touched, what each
one is for, and which ones are yours to edit._

Setup does its work on a separate `discern-setup` branch you review and land, so
nothing touches `main` until you say so (the
[walkthrough](../10-installer/walkthrough.md) follows that flow end to end).
When you look at the diff, everything falls into four groups.

## Yours — the `discern.toml` file and the `discern/` folder

These are plain files discern hands to you. Edit them freely; discern never
overwrites them.

- **`discern.toml`** — one config file at the root of your repo. It holds the
  commands your gate runs (format, lint, test, …) and every other setting. This
  is the file you tune as your project grows.
- **`discern/`** — one visible folder for everything discern asks you to author,
  and everything it keeps as plain content:
  - `discern/guidance.md` — your instructions to every coding agent. Edit this,
    and the agent files below are rebuilt from it.
  - `discern/docs/` — the documentation map your agents write and keep current.
  - `discern/TODO.md` — a shared list of deferred work.
  - `discern/brief.md` — the short description of your project captured during
    setup.

  Skills and recipes you write later live here too. Nothing generated is ever
  placed inside `discern/` — it is 100% yours.

## Shared — the config, the ignore block, and your agents' settings

discern edits a small, marked region of these files and leaves the rest alone.

- **The `.gitignore` block** — a single fenced `# --- discern ---`
  section listing the generated files below. Add your own ignore rules anywhere
  outside the markers; leave the inside to discern.
- **Your coding agents' config files** — for Claude Code, `.mcp.json` and
  `.claude/settings.json`; other agents have their own (`.codex/config.toml`,
  `.gemini/settings.json`, and the rest). discern adds its MCP server, its
  session hooks, and a couple of permission defaults. Your other settings in
  those files stay exactly as they were. The
  [per-agent pages](../60-agent-integrations/) name the exact file for each
  agent.

## Generated — rebuilt on demand, safe to ignore

These are built from your guidance and skills, and they're gitignored, so they
never clutter your history. You don't edit them — you edit the source, and they
rebuild.

- **The agent files** — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` (whichever agents
  you set up), each compiled from discern's built-in guidance plus your
  `discern/guidance.md`. To change what an agent reads, edit `guidance.md` and
  run `discern refresh` — not these files.
- **The materialized skills** — `.claude/skills/` and `.agents/skills/`, the
  task playbooks discern makes available to your agents.

Because these are gitignored, a fresh clone won't have them until discern
rebuilds them — see [working with a team](../30-worktrees/team-workflow.md) for
what a collaborator sees.

## Appears later — the worktrees folder

You won't see this one yet. The first time an agent starts an isolated workspace
(`discern start`), discern creates a sibling folder next to your repo named
`<your-repo>.worktrees/`. Each is a throwaway checkout for one change, on its
own branch. It sits beside your repo — not inside it — so it's easy to find and
never mixed up with your real files. Finished worktrees are removed
automatically; a stray one is cleaned up with `discern worktree prune`.

## The short version

One config file and one folder are yours. A marked block in a few shared files
is discern's to keep current. Everything generated is gitignored and rebuilt on
demand. Nothing is hidden, and none of it is permanent —
[what discern writes](../10-installer/what-discern-writes.md) is the full
footprint, and `discern uninstall` takes it all back out.

## See also

- [The walkthrough](../10-installer/walkthrough.md) — the setup session that
  produced this diff.
- [What discern writes to your repo](../10-installer/what-discern-writes.md) —
  the complete footprint and how to remove it.
- [Trust & your data](trust-and-data.md) — what runs on your machine, and what
  never does.
