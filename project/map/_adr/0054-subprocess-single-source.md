# ADR 0054: One module owns process spawning — git and `sh -c` funnel through shared runners

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`; the decision and reasoning are unchanged.

> **Project Script vocabulary amendment ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** Current pointers use Project Script for the former project Recipe surface; the decision and reasoning are unchanged.

**Status**: accepted; extends [ADR 0051](0051-canonical-set-parity.md)'s drive-off-the-live-tree guard discipline to subprocess spawning, and clears the last open-coded remnants of the shell engine that preceded the single binary ([ADR 0019](0019-single-binary-ts-engine.md)).

## Context

The engine drives two kinds of external process: git, and operator-supplied shell commands (gate jobs, standard measurements, worktree setup steps). Each was spawned where it was needed — nine `new Deno.Command(…)` git sites and several `sh -c` sites — every one re-deciding the same details: how to resolve the git binary, whether to capture or inherit stdio, how to decode output, what an empty command means, and what a failed spawn returns.

Open-coding each call is how a shell script works — every `git …` and every `$(…)` is just another line — and the scatter carried three concrete costs:

- **An inconsistency that had become a latent bug.** The `GIT_BIN` override was resolved at five sites and hard-coded to `"git"` at four (the installer's tree-cleanliness check, scope classification, the fix-stage strand check, the standard baseline read). A project pointing `GIT_BIN` at a wrapper got it honored in some operations and bypassed in others.
- **Conventions defined more than once.** The empty-command `:` no-op lived in three places; the "could not spawn" code `127` in two; the "git missing → a failed run, not a throw" fallback at every git site.
- **Dead weight.** A buffered `sh -c` helper (`runShellInherit`) survived a design change with zero callers.

## Decision

`src/shared/subprocess.ts` is the single home for spawning git and shell commands. It exports `runGit` (resolves `GIT_BIN` once, captures and decodes, turns a missing git into data), `runShell` (buffered `sh -c` capture), the `shellCommand` no-op normalizer, `commandExists` (the `command -v` probe), and the shared `SPAWN_FAILED` (127) constant. Every git call site and every buffered shell call site routes through it.

**Two shell spawners stay outside, by necessity, and are named explicitly:**

- the gate's job runner (`engine/jobs/command.ts`), which needs a detached process group, tree-kill on cancellation, and live line-prefixed streaming — none expressible through a buffered `.output()`; and
- the logger-routed setup runner (`engine/worktree/shell.ts`), which reserves its parent's stdout for a machine result (the `worktree create` hook's path) by draining the child's stdout onto stderr.

Both still take the `:` no-op and `127` conventions from the shared module, so the only thing they hold privately is the spawn mechanism their job demands. Every runner requires an explicit `cwd` — the git runner (`runGit`) alongside the three project-command runners (the buffered `runShell`, the streaming gate runner, and the setup/resource runner): none can silently inherit the engine process directory. The resolved project/worktree root is therefore part of the execution contract uniformly across `sh -c` and git spawns, not ambient process state — and a caller that genuinely intends the process directory passes `Deno.cwd()` explicitly, so the choice is visible at the spawn site rather than defaulted.

**A guard makes it stick.** `tests/engine_subprocess_ssot_test.ts` walks `src/` and fails the gate on a raw git or `sh -c` spawn outside the sanctioned set. Like the other house guards it drives off the live tree, so a new file auto-enrols; the sanctioned-file list is the rule, not a member list to keep in sync.

The guard deliberately does **not** cover spawners that run a _dynamically named_ binary — the pager, a Project Script, the `with-gotchas` wrapper. Those exec an arbitrary user-chosen program, not git or the shell, so they are a different concern and out of scope by design; the guard matches the literal `"git"` / `gitBin()` / `"sh"` spawn forms only.

## Consequences

- **`GIT_BIN` is honored everywhere.** Routing every git call through one resolver fixes the inconsistency as a side effect of the consolidation.
- **Each convention has one definition.** The `:` no-op, the `127` code, the no-git fallback, output decoding, and the required `cwd` on every runner live once.
- **Dead code is gone.** `runShellInherit` and its file were removed.
- **A new spawn is a conscious act.** Adding a raw git/sh spawn fails the gate; the author either uses the shared runner or extends the sanctioned set in the test — a change visible in review, with a reason.
- **Recall is bounded, like the sibling guards.** A subprocess spawned via a variable binary is not matched; that is intentional (it is not git or the shell), and the residual is stated in the test header.
