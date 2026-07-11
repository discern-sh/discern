# The desk — the human's interactive surface

_Bare `discern`, post-setup in a terminal, opens an interactive picker over the
worktree fleet._

Agents drive discern through the MCP tools and `--json`; the human operating a
fleet of agent worktrees has a different job — deciding about work, not doing
it: accept a finished handoff and land it, discard abandoned work, bring the
trunk into a stale branch, or go look at something. The **desk** is that
decision surface
([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md)): running
`discern` with no verb (or the named form, `discern desk`) from the main
checkout lists every effort in decision order and offers, per selection, exactly
the actions legal for its state.

## What it shows

One row per linked worktree, grouped and sorted for decision-making
([`model.ts`](../../src/engine/desk/model.ts) — pure and table-tested):

- **Ready to land** — clean, ahead of the trunk, and holding an honored
  gate-pass receipt. These float to the top: the desk doubles as the inbox where
  finished handoffs wait.
- **In flight** — everything an agent is presumably still working on.
- **Needs attention** — broken checkouts (a crashed `start`), unreadable states,
  and stale rows: idle past the same threshold `status` uses while still
  carrying work.

The header carries the main checkout's own state and any unlanded branches with
no worktree — otherwise-invisible abandoned work.

## What it can do

Per row: **accept** (plan shown first, then confirm), **integrate**, **inspect**
(commits, uncommitted changes, and diffstat versus the trunk), **jump in** (a
`$SHELL` spawned inside the worktree; exit to return), and **drop**. Every
action first echoes the CLI command it is about to run — the desk teaches the
verb vocabulary rather than replacing it — and every mutation runs the same
lifecycle core the CLI verb runs, so a core's refusal (and its next-step
message) renders exactly as it would on the command line. Dropping a worktree
that still holds work demands the branch name typed back before `--force` is
applied.

## When it does not open

The gate is TTY-ness alone (`canPrompt`: stdin **and** stdout are terminals),
with deliberately no agent/vendor environment sniffing:

- **Piped, CI, or `--json`** — bare `discern` prints the same help as before the
  desk existed; `discern desk` refuses with a structured `interactive_only`
  envelope pointing at `status --json`.
- **Pre-setup** — bare `discern` keeps showing the setup welcome; `desk` is
  setup-gated like `accept` and `docs`.
- **From inside a worktree** — the desk points at the main checkout instead: its
  actions (drop, accept) operate from there.

The non-interactive refusals are pinned by
[`tests/engine_desk_test.ts`](../../tests/engine_desk_test.ts); the
classification and legality tables by
[`tests/engine_desk_model_test.ts`](../../tests/engine_desk_model_test.ts). Like
`worktree drop`, the desk has **no MCP tool**: it wields supervisory actions
over other efforts' worktrees, which the fleet-ownership rule forbids an agent.
