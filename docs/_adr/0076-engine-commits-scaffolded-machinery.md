# ADR 0076: The engine commits the harness machinery it scaffolds

**Status**: accepted

## Context

`discern setup begin` scaffolds discern's own wiring into the project: the
`discern.toml`, the appended `.gitignore` fragment, and — per configured agent —
the MCP-server and session-hook files (`.mcp.json`, `.claude/settings.json`,
`.codex/config.toml`, `.gemini/settings.json`, …). On a fresh install it does
this on a dedicated, throwaway `discern-setup` branch created off a clean tree
([ADR 0065](0065-setup-keeps-its-promises.md)), then hands the coding agent a
brief to author the rest (capabilities, guidance, docs). Historically the engine
_wrote_ those machinery files but left **committing** them to the agent —
consistent with the setup interaction model, where the agent narrates its work
and makes a per-stage atomic commit
([ADR 0044](0044-setup-involve-not-gate.md)).

That split breaks in a real cold run. A coding agent's safety classifier refuses
to commit `.mcp.json` / `.claude/settings.json`: pre-approving an MCP server
(and committing pre-approved hooks) is a permission-widening change agents are
correctly trained to be cautious about. So the agent punts to the human or
strands the files, and `discern setup done` ends on a dirty tree with discern's
own essential wiring uncommitted — the opposite of the seamless, promise-keeping
setup [ADR 0036](0036-unify-setup.md) and
[ADR 0065](0065-setup-keeps-its-promises.md) set out to deliver.

The root cause is that discern relied on the **agent** to commit discern's
**own** output. There was already a precedent for the engine owning such a
commit: `setup done` auto-commits the `[meta].bootstrapped` marker it writes
(best-effort, fail-open, only its own file). The pressure was to extend that
ownership backward to `begin`.

## Decision

The engine commits the harness machinery it scaffolds. After `begin` scaffolds
and records provenance, and before it prints the brief, it commits **exactly**
the machinery — the config, the `.gitignore` fragment, the per-agent MCP + hooks
files, and any app-managed worktree-lifecycle config an agent declares (Codex's
`environment.toml`) — as one `discern: scaffold harness` commit on the
`discern-setup` branch. The committed set is derived from the scaffold outcome
(the written seed paths ∪ the MCP-wired paths ∪ the worktree-app-wired paths),
minus the authored-content seeds — the union of every category discern itself
scaffolds, so a category that ships later (the way worktree-app wiring joined
MCP wiring) only has to flow into that outcome once to be covered here.

The explicit **no**s:

- It commits **only** discern's machinery — never `git add -A`. The
  authored-content seeds the agent fills (`guidance.md`, the `docs/` skeletons,
  `TODO.md`, and the optional `brief.md`) are deliberately left uncommitted as
  the agent's to write and commit. The generated agent files
  (`AGENTS.md`/`CLAUDE.md`/`GEMINI.md`) are gitignored and never force-added.
- It runs **only** when `begin` created the isolated `discern-setup` branch — a
  fresh install in a clean git repo. When setup proceeds in place (no branch:
  `--allow-dirty`, a `--force` re-run, or outside a git repo), the engine
  commits nothing and the agent commits as before.
- It is **best-effort and fail-open**: a commit failure (e.g. commit signing)
  never fails `begin`; the agent can still commit by hand. The outcome surfaces
  as `machinery_committed` in the JSON envelope and a line in the human handoff,
  mirroring how `done` reports `marker_committed`.

This is a deliberate carve-out from "the agent makes the commits"
([ADR 0044](0044-setup-involve-not-gate.md)): discern commits its **own**
wiring, which the agent's classifier won't; the agent commits the content it
authors.

## Consequences

- A coding agent driving a cold setup — especially a cautious auto-mode one —
  never has to commit a permission-widening config file, because discern's own
  wiring is already committed when the brief is handed over. Setup no longer
  ends on a dirty tree of discern's essentials.
- The machinery lands in one reviewable, revertible commit, isolated on the
  throwaway `discern-setup` branch and separate from the agent's
  authored-content commits — clean history, easy rollback.
- One consistent rule now spans the setup lifecycle: the engine commits its own
  output (`begin`'s machinery, `done`'s marker); the agent commits what it
  authors. The two helpers share a shape (best-effort, fail-open, only-its-own
  files).
- discern now writes to the user's git history during `begin`. The cost is
  bounded: it is one commit, on a branch built for exactly this, gated on the
  clean-tree precondition that branch already requires, and trivially reverted.
- "Machinery" versus "authored content" is now a contract. A new scaffolded
  machinery file is committed automatically once it flows through the scaffold
  outcome; a new **authored** seed must be added to the exclusion set or it
  would be swept into the commit. A guard test pins the committed set to exactly
  the machinery and asserts the authored seeds stay uncommitted, so the contract
  can't drift silently.

## Alternatives considered

- **Leave the commit to the agent (the status quo).** Fails precisely for the
  cautious classifiers that most need setup to "just work" — the
  permission-widening commit is the one they refuse.
- **Instruct the agent harder, in the brief, to commit the MCP files.** A brief
  can't reliably override a safety classifier, and shouldn't try: the caution is
  correct in general. The fix is to not ask the agent to make that commit at
  all.
- **Tell the user to commit it manually.** Reintroduces the manual step
  zero-config setup exists to remove, and a dirty-tree handoff is exactly what
  [ADR 0065](0065-setup-keeps-its-promises.md) set out to end.
- **Commit everything (`git add -A`) at `begin`.** Would sweep the agent's
  authored canvas (`guidance.md`, the docs tree, `TODO.md`) into discern's
  commit, conflating discern's wiring with the user's content and pre-empting
  the agent's own atomic commits. Rejected: discern commits only what discern
  owns.
