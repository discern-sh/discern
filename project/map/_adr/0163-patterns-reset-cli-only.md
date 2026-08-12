# ADR 0163: The patterns family houses its reset as a CLI-only imperative subcommand

**Status**: accepted; the no-confirmation clause is superseded by [ADR 0272](0272-logbook-lifecycle-actions-require-terminal-confirmation.md). The CLI-only subcommand placement remains in force.

## Context

[ADR 0160](0160-local-logbook-advisory-readers.md) decided the logbook and promised its owner-facing escape hatch: "a reset action deletes the accumulated history" — the deletion leg of the trust promise. [ADR 0120](0120-launch-verb-canon.md) fixed the naming rule the action must live under: questions are nouns, actions are imperatives. `patterns` is the question (the first reader, per 0160). The reset is an action, and shipping it forces two surface decisions the earlier records left open: how the imperative is spelled into the family, and which surfaces expose it.

The candidates for the spelling: a `--reset` flag on the `patterns` verb, or an imperative subcommand. The candidates for exposure: CLI only, or an MCP tool beside `discern_patterns`.

Three prior decisions bear on it. [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) kept supervisory destructive actions (the desk's, `worktree drop`) off the agent-facing MCP surface. [ADR 0027](0027-plan-apply-engine-execution.md) requires every effectful verb to compute a pure plan with a `--dry-run` rendering. The trust page's deletion promise is one command, no ceremony.

## Decision

**`discern patterns reset` — an imperative subcommand, plan/apply with `--dry-run`, on the CLI only.**

- **A subcommand, not a flag.** `patterns` is a read-only question and its MCP tool advertises read-only annotations; a `--reset` flag would make one spelling both the question and a destructive act, and the MCP input schema would either carry a flag the tool refuses or the two surfaces would diverge. The subcommand keeps the family in the canon's shape — the noun asks, the imperative acts — the same way `skills` houses `eject` and `worktree` houses `drop`.
- **CLI only.** Deleting the recorded history is the owner's local act: an agent has no task that needs it, and an agent that _wants_ it is exactly the case 0160 warned about (a reader policed by its own history learns to erase the history). The MCP surface therefore exposes the question and not the eraser, on ADR 0119's precedent. The `discern_patterns` description names the CLI spelling so an owner who asks their agent about resetting is routed to the right place.
- **One command, no confirmation prompt.** The trust page promises one-command deletion; a prompt would break it for scripts and add ceremony the `--dry-run` preview already covers better.
- **Plan/apply, data-shaped.** The plan is the file list (names and sizes) computed read-only; `--dry-run` renders it and touches nothing; the executor is a single directory removal that lives in the store module, the logbook subsystem's one sanctioned write site. Removal covers the logbook directory alone — month files and the epoch sidecar — never its siblings under the git admin area.

## Consequences

- The family reads as the canon wants: `discern patterns` asks, `discern patterns reset` acts. Trailing-s folding and the retired-spelling guard need no new entries.
- An agent connected over MCP cannot delete the corpus its own behaviour is measured in, structurally. An owner who wants an agent to do it can still say so — the agent runs the CLI — but the default surface does not offer it.
- The recorder legitimately restarts the logbook on the next verb run (the reset's own completion event may be the first line of the fresh history). Emptiness after a reset is therefore momentary by design; `[project].logbook = false` is the off switch, and the reset's output says so.
- The result contract registers `patterns reset` as a CLI-only entry (no MCP tool), and the faithfulness suite covers its preview, apply, and nothing-recorded modes.

## Alternatives considered

- **`--reset` as a flag on `patterns`** — one verb spelling both observation and destruction; the MCP tool's read-only annotations would be false or the surfaces asymmetric. Rejected.
- **A separate top-level verb (`discern reset`)** — claims a general word for one subsystem's eraser and detaches the action from the family that owns the data. Rejected.
- **An MCP tool for the reset** — fails ADR 0119's precedent and hands the measured party the eraser. Rejected.
- **A confirmation prompt on apply** — breaks the one-command deletion promise and every scripted use; `--dry-run` is the deliberate-preview path. Rejected.
