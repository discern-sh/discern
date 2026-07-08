# Working with a team

_What a collaborator who clones your repo sees — with or without discern — and
how a human works alongside agent worktrees without stepping on them._

discern installs into one repository, and its footprint travels in git like any
other file. A teammate who clones the repo gets a working project whether or not
they have discern.

## A teammate without discern

The code is just code. `discern.toml`, the `discern/` folder, and your agents'
config files are all committed, so a fresh clone builds, runs, and tests exactly
as it would if discern had never been involved — discern adds configuration and
text, never a runtime dependency.

What a plain clone is missing is only the **generated, gitignored** files, which
don't travel with the repo by design:

- the compiled agent files (`AGENTS.md` / `CLAUDE.md` / `GEMINI.md`), so a
  coding agent reads none of your guidance;
- the materialized skills (`.claude/skills/`, `.agents/skills/`);
- the `discern_*` MCP tools, which need the discern binary to run.

Their absence is deliberate: the reviewable source is your
`discern/guidance.md`, not the compiled copy, so discern doesn't track the copy.
(The [CI page](../20-quality-gate/ci.md) tells the same story for cloud-agent
environments, and how to opt into shipping the artifacts if you want them.)

## The one-minute path to full function

For a teammate who wants the whole harness, not just the code:

1. **Install the discern binary** — the same one-line install from the project's
   install page.
2. **Run `discern refresh`** — it rebuilds the agent files and materializes the
   skills from the sources already in the repo. There's no setup or consent step
   to repeat; the project is already configured, and that configuration is
   committed.
3. **Start a fresh agent session** — the MCP tools and session hooks load when
   an agent session starts, so a new session picks them up. A few agents (Codex,
   Gemini, Cursor, the Copilot CLI) also need you to trust the folder once;
   `discern doctor` names the exact step for each.

The clone now has the same gate, worktrees, and skills you do.

## Humans and agent worktrees, side by side

When an agent works, it does so in its own isolated worktree — a sibling folder
`<repo>.worktrees/<name>` on its own `agent/…` branch (see
[the worktree workflow](README.md)). You keep working in the main checkout. The
two never collide, because each worktree has its own branch, its own dev-server
port, and its own [resources](the-resources.md).

From the main checkout, `discern status` surveys the whole fleet — every
worktree in flight, its branch, and how far ahead of or behind `main` it sits —
so you see what your agents are doing without opening each folder. When a change
is ready, `discern graduate` lands its branch and removes the worktree. A
worktree is one line of work: you never adopt someone else's, and a clean one
isn't a free one to claim.

## See also

- [The worktree workflow](README.md) — the lifecycle these isolated checkouts
  follow.
- [Per-worktree resources](the-resources.md) — how each worktree gets its own
  database, port, or other external thing.
- [CI and cloud agents](../20-quality-gate/ci.md) — the gate as shared policy,
  and what ephemeral environments see.
