---
title: The quality gate
description: Fix a red Gate, understand what discern done runs, and choose the next quality tool for your task.
aliases:
  - gate
  - quality gate
  - discern done
---

# The quality gate

_Start with the current failure, then follow the gate from fast feedback to final review evidence._

If `discern done` failed, go to [When the gate fails](when-the-gate-fails.md). Each precondition or job failure includes a specific next action, the command, and its captured output.

The gate defines done. It requires the local configured trunk, non-weakened standards, current [generated artifacts](../00-orientation/glossary.md#generated-artifact), and consistent map and instructions. Its integrity check rejects broken references, metadata, and skills ([ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)). A present generated agent file whose bytes differ from its source is stale and blocks before project jobs; an absent agent file is tolerated because a project may leave generated provider files untracked.

`done` proves the committed tip of the invoking checkout: every required job, changed-scope gate, and standard runs through one producer graph. Fix and build dependencies precede checks and tests; scope gates and standard extractors start when their own prerequisites settle. Cleanliness remains mandatory, and a failed producer cannot be replaced by a skipped status. [Complete evidence](complete-evidence.md) explains the boundary shared by local and CI execution.

Every configured gate command runs from the project root through `sh -c`, with `CI=1`, `NO_COLOR=1`, and `TERM=dumb` forced so tools choose one-shot, plain output, and `FORCE_COLOR=` blanked so an inherited colour-forcing value cannot override that choice. `DISCERN_DESK_SESSION=` is blanked as well: the desk's ownership marker inherits into every descendant of a desk-owned shell, and a project's own checks may run `discern`, so a gate launched beneath the desk must produce the evidence a gate launched anywhere else produces ([ADR 0407](../_adr/0407-the-gate-strips-the-desk-marker.md)). It leads its own POSIX process group. Timeout, fail-fast, cancellation, and interruption terminate that group with `SIGTERM`, escalate to `SIGKILL`, and bound pipe draining, so a descendant cannot outlive the verdict ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)). Buffered result output retains a bounded head and tail; its temporary artifact retains the complete stream.

A scope with `preview = "<command>"` declares the read-only action an agent can run from its worktree. `impact`, `status`, Gate plans, and successful gate results carry the same typed scope-and-command record and state that discern did not run it. The action remains advice outside the gate. Changing the command once changes terminal, JSON, Markdown, and Model Context Protocol (MCP) projections together ([ADR 0346](../_adr/0346-machine-facts-are-typed-advisories.md)).

Use `discern prepare` before the final commit. It runs fix and generated jobs, then the complete refresh and checks. Green means tracked agent files are canonical; incomplete provider or skill refresh is red.

`discern done` reruns the test stage. For a red test, use its diagnostic's reproduce command; use `discern test` only for standalone runs.

Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a Proof for review ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

## Live terminal presentation

On a cursor-controlled terminal, `done`, `prepare`, `test`, and human composite gate runs share the package activity frame: lifecycle facts stay pinned; complete and partial subprocess lines feed a bounded tail. `[gate].stream` never gates this frame.

The package fits full, then compact, then append-only output. Resizes retain the same producer feed; interrupts restore the cursor. Success leaves stable facts without replaying the tail. Failure follows them with diagnostics and the full-output-artifact route.

CI, pipes, `--plain`, and terminals without cursor control remain static: `stream_output = false` groups complete per-job output; `true` streams prefixed lines. JSON, Markdown, and MCP omit human job output.

[`execute.ts`](../../../src/engine/gate/execute.ts) resolves presentation separately from capture. [`gate_tty.ts`](../../../src/engine/gate/gate_tty.ts) feeds the package; [`command.ts`](../../../src/engine/jobs/command.ts) retains raw evidence. For result contracts, see [MCP tools & results](../70-reference/mcp-and-results.md).

| Read next                                                   | What it helps you do                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [When the gate fails](when-the-gate-fails.md)               | Read a red result and take the shortest route to the fix.                                         |
| [Complete evidence](complete-evidence.md)                   | Prove the committed tip through one producer graph and reuse evidence whose inputs are unchanged. |
| [Standards](standards.md)                                   | Hold a metric floor or ceiling and respond when it fires.                                         |
| [Checkpoints](checkpoints.md)                               | Serve a judgment when a change makes it relevant, and record the conclusion.                      |
| [The Proof](the-proof.md)                                   | Read the review evidence a clean green run records for one commit.                                |
| [Proof notes](proof-notes.md)                               | Carry a landed Proof with its trunk commit and opt into fetch transport.                          |
| [Strand detection](strand-detection.md)                     | Fix tracked files a gate stage changed after the final commit.                                    |
| [Run the gate in CI](ci.md)                                 | Require the same gate on pull requests and trunk pushes.                                          |
| [Continuous improvement](improvement.md)                    | Find the highest-value practice to improve after the current change passes.                       |
| [Co-change coupling](coupling.md)                           | Check whether this change omitted a file that usually moves with it.                              |
| [Practice patterns](patterns.md)                            | Read recurring workflow evidence from the local Logbook.                                          |
| [`discern tidy`](tidy.md)                                   | Format discern-owned Markdown and TOML directly or through the format job.                        |
| [The fleet test-run cap](concurrent-test-runs.md)           | Queue concurrent test-stage runs so parallel agents share one machine.                            |
| [Practice stats](practice-stats.md)                         | Share what went well as one card of plain counts from the local logbook.                          |
| [Validation findings](validation-findings.md)               | Compare per-job verdicts within and across recorded execution conditions.                         |
| [Patterns decision evidence](patterns-decision-evidence.md) | Read the evidence required before Patterns recommends a Gate or Standard change.                  |
| [Pattern investigations](pattern-investigations.md)         | Trace related findings into bounded diagnostic paths.                                             |
| [Checkpoint recipes](checkpoint-recipes.md)                 | Adapt nine copyable triggers for common review moments.                                           |
