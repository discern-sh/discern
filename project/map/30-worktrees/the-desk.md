# The desk — the human's interactive surface

_Bare `discern`, post-setup in a terminal, opens an interactive picker over the worktree fleet._

Agents drive discern through the MCP tools and `--json`; the human operating a fleet of agent worktrees has a different job — deciding about work, not doing it: accept a finished handoff and land it, discard abandoned work, bring the trunk into a stale branch, or go look at something. The **desk** is that decision surface ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md)): running `discern` with no verb (or the named form, `discern desk`) from the main checkout lists every effort in decision order and offers, per selection, exactly the actions legal for its state.

## What it shows

One row per linked worktree, grouped and sorted for decision-making ([`model.ts`](../../../src/engine/desk/model.ts) — pure and table-tested):

- **Ready to land** — clean, ahead of the trunk, and holding an honored gate receipt. These float to the top: the desk doubles as the inbox where finished handoffs wait.
- **In flight** — everything an agent is presumably still working on.
- **Needs attention** — broken checkouts (a crashed `start`), unreadable states, and stale rows: idle past the same threshold `status` uses while still carrying work.

The header carries the main checkout's own state and any unlanded branches with no worktree — otherwise-invisible abandoned work.

## What it can do

Per row: **accept** (plan shown first, then confirm), **update**, **inspect** (commits, uncommitted changes, and diffstat versus the trunk), **jump in** (a `$SHELL` spawned inside the worktree; exit to return), **run script**, and **drop**. **Run Script** appears only when the selected checkout's own `[scripts].dir` contains an executable Project Script. Its script picker uses the same sorted discovery and optional `# desc:` descriptions as `discern script`; the selected script inherits the terminal, runs with the worktree root as its working directory and `DISCERN_ROOT`, then returns to a freshly surveyed desk.

Every action first echoes the CLI command it is about to run — the desk teaches the verb vocabulary rather than replacing it — and uses the same lifecycle or Project Script core as the CLI surface. A core's refusal (and its next-step message) therefore renders exactly as it would on the command line. Dropping a worktree that still holds work demands the branch name typed back before `--force` is applied.

## When it does not open

The shared interaction gate (`canPrompt`) requires terminal stdin and stdout, and also declines under global `--plain` or an enabled `CI` environment. It does not sniff agent or vendor markers:

- **Piped, CI, `--plain`, or `--json`** — bare `discern` prints static help; `discern desk` refuses with a structured `interactive_only` envelope pointing at `status --json`.
- **Pre-setup** — bare `discern` keeps showing the setup welcome; `desk` is setup-gated like `accept` and `docs`.
- **From inside a worktree** — the desk points at the main checkout instead: its actions (drop, accept) operate from there.

The non-interactive refusals are pinned by [`tests/engine_desk_test.ts`](../../../tests/engine_desk_test.ts), while the pseudo-TTY matrix in [`tests/engine_non_interactive_test.ts`](../../../tests/engine_non_interactive_test.ts) proves CI, `--plain`, and closed stdin terminate every prompt-capable verb. The classification and legality tables are pinned by [`tests/engine_desk_model_test.ts`](../../../tests/engine_desk_model_test.ts). The scripted runtime suite additionally pins conditional, worktree-local Project Script discovery and dispatch; the Project Script suite proves the shared core executes with an explicitly selected checkout as its working directory. Like `worktree drop`, the desk has **no MCP tool**: it wields supervisory actions over other efforts' worktrees, which the fleet-ownership rule forbids an agent.
