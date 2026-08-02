---
title: The quality gate
description: Fix a red gate, understand what discern done runs, and choose the next quality tool for your task.
aliases:
  - gate
  - quality gate
  - discern done
---

# The quality gate

_Start with the failure in front of you, then follow the gate from fast feedback to final proof._

If `discern done` failed, go straight to [When the gate fails](when-the-gate-fails.md). It turns each precondition or job failure into a specific next action and shows you where to find the command and captured output. You can get from red to the relevant fix in one hop.

The gate is the repository's definition of done. It first checks that the branch contains the latest trunk, the branch did not weaken a standard, discern's [generated artifacts](../00-orientation/glossary.md#generated-artifact) are current, and the map and guidance hold together — dead links and anchors, stale fenced `discern` examples, unreadable metadata blocks, published pages linking into the internal trees, and citations of skills that do not exist all fail here ([ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)). It then runs the declared jobs by stage: fix serially, build in parallel, check and test with standard measurements, then gates for the scopes that changed. The build stage also reruns every declared generated-artifact group as its own `generated:<name>` job: a stale committed output, or a generator writing outside every declared path, fails the run and names the regeneration to commit ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)). A stage that changes a committed-clean tracked file also fails the run, so generated output cannot hide behind a green result ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

Use `discern prepare` while you work. It runs the fix and check stages. Build and test do not run. On an interactive terminal with buffered gate output, every configured fix and check job appears before execution. Each row moves from `pending` to `running`, then to its outcome. The success or failure tail follows the completed table. `--plain` and CI render the final table once. Streamed and piped runs keep their transcript. The success line states that build and test did not run, and a no-op names the missing fix and check jobs.

Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a receipt for review ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

For the JSON fields and agent-facing tool contract, use [MCP tools & results](../70-reference/mcp-and-results.md).

| Read next                                         | What it helps you do                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| [When the gate fails](when-the-gate-fails.md)     | Read a red result and take the shortest route to the fix.                   |
| [Standards](standards.md)                         | Hold a metric floor or ceiling and respond when it fires.                   |
| [The receipt](the-receipt.md)                     | Understand the proof a clean green run hands to the reviewer.               |
| [Receipt notes](receipt-notes.md)                 | Carry a landed receipt with its trunk commit and opt into fetch transport.  |
| [Strand detection](strand-detection.md)           | Fix tracked files a gate stage changed after the final commit.              |
| [Run the gate in CI](ci.md)                       | Require the same gate on pull requests and trunk pushes.                    |
| [Continuous improvement](improvement.md)          | Find the highest-value practice to improve after the current change passes. |
| [Co-change coupling](coupling.md)                 | Check whether this change omitted a file that usually moves with it.        |
| [Practice patterns](patterns.md)                  | Read what the logbook shows about how agents drive discern here.            |
| [`discern tidy`](tidy.md)                         | Format discern-owned Markdown and TOML directly or through the format job.  |
| [The fleet test-run cap](concurrent-test-runs.md) | Queue concurrent test-stage runs so parallel agents share one machine.      |
| [Practice stats](practice-stats.md)               | Share what went well as one card of plain counts from the local logbook.    |
