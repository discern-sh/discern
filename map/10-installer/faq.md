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
what would run. Run it from anywhere inside the project: like every other verb,
it walks up to the root `discern.toml`, so a subdirectory reports the same
install as the root, not a false "not initialized". When you report a problem,
include its machine-readable form:

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

## `discern done` failed and I'm not sure why

Start with the failure discern hands back: for each failed job it names the
tool, a command to reproduce just that failure, and the captured output. Your
agent usually reads that and fixes it on its own. When you want to triage
yourself, [when the gate fails](../20-quality-gate/when-the-gate-fails.md) walks
the common causes stage by stage and what to paste to your agent, and
`discern doctor` rules out a missing tool or a misconfigured install.

## Does discern work on Windows?

discern is developed and tested on macOS and Linux. On Windows, run it under
**WSL2**, where the git-worktree workflow and POSIX Project Scripts behave as
they do on Linux. A native-Windows shell is not a supported target today.

## Can I use discern in a monorepo?

Yes. discern uses one install per repository: a single `discern.toml` at the git
root drives the whole tree. You don't install a separate discern per app or
package inside it.

Components inside the repo plug into that one gate through **scopes**. A scope
names a region by its paths and can carry its own `gate` command that runs only
when that region changed — so a subdirectory app is driven by its own commands,
under the one root config:

```toml
[scopes.web]
paths = ["apps/web/**"]
gate  = "npm --prefix apps/web test"
```

A change under `apps/web/` now runs that app's own gate as part of
`discern done`, while a change elsewhere skips it. The root `[capabilities]`
still cover what's shared across the repo; each scope adds what's local to one
component.

## The worktrees are taking up disk

Each isolated worktree is a full checkout, so a fleet of them adds up. They are
meant to be transient — one line of work each, landed and removed. Clean them up
with the worktree lifecycle:

- `discern accept` lands a finished branch and removes its worktree.
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
- **Getting a newer discern _itself_** — re-run the install script from the
  README. discern makes no network calls and never auto-updates, so a new
  version is always something you ask for.

Which axis a schema mismatch needs depends on its direction, and
`discern doctor` names the right one. An install OLDER than your binary migrates
forward with `discern upgrade`. An install NEWER than your binary — a teammate
upgraded the project with a newer discern than you have — is the other axis:
`discern upgrade` refuses a newer-than-binary config, so update discern itself
instead.

Either axis can leave a **stale MCP server**: an agent that started
`discern mcp` before the change keeps running the old binary's engine and
templates for the rest of its session. Restart the agent session after upgrading
so it starts a fresh server on the new binary — `discern upgrade` closes with
that reminder, and the `discern_*` tools flag the version mismatch on their own
results until you do.

## I've changed my mind — how do I get discern out?

`discern uninstall` takes discern back out and tells you what it leaves behind.
It removes the generated agent files and materialized skills, strips discern's
entries from your agents' config files (leaving your own settings intact), and
removes the `.gitignore` block. Preview it first with
`discern uninstall --dry-run`.

It keeps your content: `discern.toml` and the whole `discern/` folder stay, as
plain Markdown at paths you chose — worth keeping with or without the tool.
Removing the binary itself is a separate step: delete the file `which discern`
reports. [What discern writes](what-discern-writes.md) is the full footprint,
with removal covered end to end.

## Where do I report a bug?

Open an issue on the project's GitHub repository. Pick the bug or setup-failure
template and paste the `discern doctor --json` output — that alone resolves most
reports. For a suspected security issue, follow `SECURITY.md` instead of opening
a public issue.

## See also

- [What discern writes to your repo](what-discern-writes.md) — the footprint and
  how to remove it.
- [The walkthrough](walkthrough.md) — one end-to-end session, start to finish.
- [When the gate fails](../20-quality-gate/when-the-gate-fails.md) — reading and
  fixing a red `discern done`.
- [CI and cloud agents](../20-quality-gate/ci.md) — running the gate outside
  your machine.
