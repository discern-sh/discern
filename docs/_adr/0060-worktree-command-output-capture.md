# ADR 0060: Worktree shell commands adopt the gate's capture-on-failure output convention

**Status**: accepted. Resolves a leak surfaced by
[ADR 0059](0059-worktree-setup-ensure.md), and aligns the worktree shell runner
with the gate's job convention (`engine/jobs/command.ts`).

## Context

discern ran project-supplied shell commands through **two** different output
conventions:

- **Gate jobs** (capabilities, `[checks.<name>]`) — `spawnJob` always pipes and
  **captures** stdout+stderr, and surfaces them **only on failure** (or streamed
  with a `── <label> │` prefix when `[gate].stream` is on). A successful gate job
  is silent.
- **Worktree shell commands** (`[worktree.setup].steps`/`ensure`, resource
  `create`/`destroy`/`ensure`) — `runShellRouted` mirrored the logger's
  `humanStream`: it **inherited** the child's stdio live on stdout, and drained
  stdout→stderr only for the `worktree:create` hook (which reserves stdout for the
  worktree path).

[ADR 0059](0059-worktree-setup-ensure.md) made `[worktree.setup].ensure`
**convergent** — it now runs at session start (the `SessionStart` hook →
`worktree:ensure`) and on `discern integrate`, not only at one-time creation. The
`SessionStart` hook's **stdout is injected into the agent as context**. So a
chatty `ensure` command — `vale sync`, which streams a download progress bar —
leaked its raw output straight into **every session's agent context**. The same
tool run as the `[checks.prose]` gate job never leaks, because the gate captures.

The root cause is the convention, not the stream: `runShellRouted` passed an
automated, agent-context-bound command's output straight through. The leak is a
symptom of the worktree runner using live-inherit where the gate uses
capture-on-failure.

## Decision

**`runShellRouted` now captures the command's combined output and surfaces it
only on failure** — the same convention as the gate's `spawnJob`:

- exit 0 → silent (the captured output is discarded; nothing reaches stdout or
  stderr);
- exit N≠0 → the captured output is written to **stderr** (the diagnostic
  channel), beside the caller's own failure narration;
- `--json` → all output discarded, success or failure (ADR 0030).

**It is uniform.** The capture applies to every `runShellRouted` path — setup
`steps`, `ensure`, and resource commands — interactive or hook, with no
TTY-conditional branch. discern thus has **one** automated-command output
convention (quiet on success, loud on failure), matching the gate, instead of
two.

A welcome consequence: the `worktree:create` hook's stdout reservation is now
**structural**. Command output never touches stdout, so the returned worktree
path is clean by construction — not by a `humanStream`-driven drain. `shell.ts`
no longer reads `log.humanStream` at all; that field reverts to its plain job,
the logger's narration channel.

## Consequences

- **The Vale leak is gone.** A successful `vale sync` at session start is silent,
  so it never enters agent context; a failed one surfaces on stderr.
- **One convention across the harness.** Automated commands — gate jobs and
  worktree commands alike — are quiet on success and loud on failure.
- **Interactive setup loses live progress.** `discern worktree`/`start` no longer
  streams a long `npm ci`/`vale sync` line-by-line; it is silent until the command
  finishes or fails. The pre-run `→ Setup step: …` / `→ Ensure step: …` narration
  still says what is running. This matches the gate, which is also silent on
  success. A future opt-in (honouring `[gate].stream`, or a `--verbose`) could
  restore live output.
- **`shell.ts` decouples from narration routing.** The command runner depends only
  on `log.json` now, not `humanStream` — a smaller surface.

## Alternatives considered

- **Fix only the `SessionStart` hook to reserve stdout** (give `worktree:ensure`
  the create hook's `humanStream:"stderr"`). Rejected — it stops the agent-context
  leak but still spams **stderr** with a progress bar at every session start, and
  leaves two output conventions in the tree. The leak is the wrong convention, not
  just the wrong stream.
- **TTY-conditional routing** — capture-on-failure when non-interactive (hooks),
  inherit-live at a terminal. Rejected — environment-dependent behaviour is harder
  to test and reason about, splits the convention in two, and the gate does not do
  it either.
- **Per-command silencing** (a quiet flag on `vale sync`). Rejected — fragile and
  per-tool; `vale sync` has no progress-bar-quiet flag, and the next chatty command
  would leak again. The routing layer is the right place to fix it once.
- **Route worktree commands through the gate's `spawnJob`** (share the
  implementation, not just the convention). Rejected for now — `spawnJob` takes no
  `cwd`/`env`, and threading them through reaches into the gate. Adopting the
  convention here is the right scope; a later unification onto one spawn primitive
  ([ADR 0054](0054-subprocess-single-source.md) already centralised process
  spawning) stays open.
