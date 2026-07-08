# FAQ & troubleshooting

_Common questions, and the first thing to run when something looks wrong._

## Start with `discern doctor`

Most "something is off" moments are answered by one command:

```
discern doctor
```

It checks the install end to end — the config parses, the schema is current, the
commands your gate calls resolve on `PATH`, and each configured agent's
integration is wired — and prints each verb's execution model so you can see
what would run. When you report a problem, include its machine-readable form:

```
discern doctor --json
```

That output is what the project's issue templates ask for, because it captures
the state a maintainer needs without a back-and-forth.

## `discern: command not found`

The binary is not on your `PATH`. discern is a single self-contained file; the
installer places it somewhere your shell can find it, but a fresh shell (or a
new terminal that didn't reload your profile) may not have picked it up yet.

- Confirm where it landed: `which discern` (nothing printed ⇒ it is not on
  `PATH`).
- Reload your shell, or add the install directory to `PATH` in your shell
  profile.
- If your coding agent runs discern in a subshell that doesn't inherit your
  interactive `PATH`, point the agent at the absolute path the installer
  reported.

## My agent says the MCP tools are unreachable

The `discern_*` tools reach the project through a long-running `discern mcp`
server the agent starts. Two things commonly break that link:

- **The server isn't loaded yet.** A freshly wired MCP server is usually not
  detected until the coding agent restarts. Start a fresh session (or reload the
  agent's MCP servers) after setup or after `discern refresh` first wires it.
- **The committed config is untrusted.** Several agents — Codex, Gemini, Cursor,
  the GitHub Copilot CLI — hold committed MCP and hook config inert until you
  trust the folder once. `discern doctor` names the exact trust step per agent
  (Claude Code needs none; discern pre-approves its server there). Until you
  take that step, the wiring is present but dormant.

When the MCP server is genuinely unreachable, fall back to the `discern` CLI
with `--json` in the meantime — every tool has a CLI verb behind it — and run
`discern doctor` to see which side is missing.

## Does discern work on Windows?

discern is developed and tested on macOS and Linux. On Windows, run it under
**WSL2**, where the git-worktree workflow and the POSIX shell the recipes assume
behave as they do on Linux. A native-Windows shell is not a supported target
today.

## The worktrees are taking up disk

Each isolated worktree is a full checkout, so a fleet of them adds up. They are
meant to be transient — one line of work each, landed and removed. Clean them up
with the worktree lifecycle:

- `discern graduate` lands a finished branch and removes its worktree.
- `discern worktree prune` sweeps worktrees whose work is already merged, plus
  the stale git admin entries a manual deletion leaves behind.

By default worktrees are created as a sibling of your repo
(`<repo>.worktrees/`), so they are visible and easy to inspect — not hidden
inside the checkout. Point `[worktree].root` elsewhere if you prefer.

## How do updates work?

Two separate axes, deliberately kept distinct:

- **Updating _your project_ to match the installed binary** — `discern upgrade`.
  It runs any pending config-schema migrations, reconciles the fixed
  `discern.toml` scaffold and the `.gitignore` block, and re-materializes the
  skills and compiled agent files. It never rewrites your values, guidance, or
  authored skills, and its clean-tree guard keeps it revertible.
- **Getting a newer discern _itself_** — re-run your installer (for example
  `brew upgrade discern`). discern makes no network calls and never
  auto-updates, so a new version is always something you ask for.

Either axis can leave a **stale MCP server**: an agent that started
`discern mcp` before the change keeps running the old binary's engine and
templates for the rest of its session. Restart the agent session after upgrading
so it starts a fresh server on the new binary — `discern upgrade` closes with
that reminder, and the `discern_*` tools flag the version mismatch on their own
results until you do.

## Where do I report a bug?

Open an issue on the project's GitHub repository. Pick the bug or setup-failure
template and paste the `discern doctor --json` output — that alone resolves most
reports. For a suspected security issue, follow `SECURITY.md` instead of opening
a public issue.

## See also

- [What discern writes to your repo](what-discern-writes.md) — the footprint and
  how to remove it.
- [The walkthrough](walkthrough.md) — one end-to-end session, start to finish.
- [CI and cloud agents](../20-quality-gate/ci.md) — running the gate outside
  your machine.
