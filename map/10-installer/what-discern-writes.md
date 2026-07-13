# What discern writes to your repo — and how to remove it

_The whole footprint, in one place: every file discern creates or merges into,
what runs on your machine, and the one command that takes it all back out._

discern's footprint is small and checkable on purpose. It writes one committed
root file, one visible namespace, the agent files each vendor requires, and a
short list of enumerated shims — and a test fails the moment any verb writes
anywhere else (design principle 13, enforced by
[`paths_write_surface_test.ts`](../../tests/paths_write_surface_test.ts)). This
page is the human-readable form of that contract. The
[install surface](../80-development/install-surface.md) is its exhaustive
engineering counterpart, and the
[per-agent integration pages](../60-agent-integrations/) carry the file table
for each coding agent.

## The three kinds of file

Everything discern writes falls into one of three buckets, and the bucket
decides what happens on `discern upgrade` and who owns the file.

### Yours — the `discern/` namespace

Visible, configurable paths hold everything discern asks you to author and
everything it maintains as plain content
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
These are ordinary Markdown files at paths you chose or accepted; discern never
writes a generated artifact inside the namespace, and `upgrade` never rewrites
them.

| Path                  | What it is                                             |
| --------------------- | ------------------------------------------------------ |
| `discern/guidance.md` | Your discern guidance, compiled into the agent files.  |
| `map/`                | The documentation map discern scaffolds and maintains. |
| `discern/skills/`     | Any skills you author.                                 |
| `discern/scripts/`    | Any executable project scripts you add.                |
| `discern/TODO.md`     | The deferred-work ledger agents read and keep.         |
| `discern/brief.md`    | The project brief captured at setup.                   |

Each path is configurable — `[map].dir` can name any directory you prefer — and
the default is the location shown. The map is discern's own tree: setup never
points it at documentation you curate yourself.

### Co-managed — the config, the ignore block, and the agent wiring

These are tracked files discern shares with you. It owns a delimited region and
leaves the rest alone.

- **`discern.toml`** — the one root file, your configuration. discern owns a
  fixed scaffold of documented sections and keys (restored if missing on
  `upgrade`) and never touches the values you set.
- **The `.gitignore` block** — one delimited `# --- discern ---` block listing
  discern's generated artifacts. Your own ignore rules outside the block are
  untouched.
- **The per-agent integration files** — for each coding agent you configure,
  discern merges its MCP server, its session hooks, and a couple of permission
  defaults into that agent's own committed config files (`.mcp.json`,
  `.claude/settings.json`, `.codex/config.toml`, `.gemini/settings.json`, and
  the rest). It writes only its own entries; your other settings in those files
  stay as they are. The [per-agent pages](../60-agent-integrations/) list the
  exact file per agent.

### The binary's — generated, rebuilt on demand

These are produced from bundled sources on `discern refresh` and are always safe
to overwrite; the reviewable source is your guidance file, not the compiled
output, and the gate's currency check catches a drifted copy
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

- **The compiled agent files** — `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
  (whichever agents you configured), compiled from the built-in guidance plus
  your `discern/guidance.md`. Committed by default
  ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)), so an
  ephemeral environment that clones your repo without the binary still reads
  them.
- **The materialized skills** — `.claude/skills/` and the cross-tool
  `.agents/skills/`, republished from the bundled and authored skill sources.
  Ignored via the managed `.gitignore` block, so they stay out of your history
  and rebuild wherever the binary runs — see
  [the CI and cloud-agent notes](../20-quality-gate/ci.md) for what a clone
  without the binary sees.

## What runs on your machine

discern's trust model is the same class as a `Makefile` or an npm `scripts`
block: **it runs the commands you configure.** The gate (`discern done`) runs
exactly the `format` / `build` / `lint` / `test` commands in your
`discern.toml`; a Scope gate or a Standard runs the command you wrote for it; a
project script is your own executable, run explicitly with `discern script`.
discern adds no commands of its own beyond its built-in git and file operations,
and it reads your config to decide what to run — so the code it executes is code
you can read in one file.

It makes **zero network calls** and ships **no telemetry**: nothing is phoned
home, measured, or uploaded. The binary is a local CLI; getting a newer discern
is a deliberate act (re-running your installer), never an automatic update.

## How to remove it all

`discern uninstall` takes discern back out and tells you what stayed
([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)). It removes the
generated agent files and materialized skills, strips discern's entries from the
co-managed agent files (leaving your own settings untouched), and removes the
`.gitignore` block. Preview it first with `discern uninstall --dry-run`.

If it cannot resolve discern's bundled `templates/` tree, it can't identify the
template-seeded permission and scalar entries in a co-managed settings file, so
it leaves them rather than guess. It says so plainly instead of leaving them
silently: the result and the human view name each such file and why, so you can
finish the strip by hand.

It **keeps your content**: `discern.toml` and the whole `discern/` namespace
stay — plain files at paths you chose, valuable without the tool. Everything the
namespace holds is ordinary Markdown you can read, move, or keep. Removing the
binary itself is a separate step (uninstall names it): discern is one file on
your `PATH`, deleted by hand — the file `which discern` reports.

Uninstall is a CLI verb, deliberately not something a coding agent can invoke
mid-session — pulling out discern is a decision you make, not one an agent
reaches for. It refuses while a worktree is still in flight, so it never removes
the wiring from under work in progress.

## See also

- [The install surface](../80-development/install-surface.md) — the exhaustive,
  by-disposition inventory this page distills.
- [Agent integrations](../60-agent-integrations/) — the exact file table per
  coding agent.
- [design principles](../00-orientation/design-principles.md) — sovereign
  inside, deferential outside (7); a provable footprint (13); exit honesty (12).
