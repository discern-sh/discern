---
title: The quality gate
description: Fix a red Gate, understand what discern done runs, and choose the next quality tool for your task.
aliases:
  - gate
  - quality gate
  - discern done
---

# The quality gate

_Start with the current failure, then follow the Gate from fast feedback to final review evidence._

If `discern done` failed, go to [When the Gate fails](when-the-gate-fails.md). Each precondition or job failure includes a specific next action, the command, and its captured output.

The repository's final quality check (the Gate) defines done. It checks that the branch contains the latest trunk, Standards did not weaken, [generated artifacts](../00-orientation/glossary.md#generated-artifact) are current, and the Map and guidance agree. Dead links, stale `discern` examples, unreadable metadata, internal-tree links from published pages, and missing Skills fail the integrity check ([ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)). The Gate then runs fix serially, build in parallel, check and test with Standard measurements, and gates for changed scopes. Build also runs every declared `generated:<name>` job. Drift or output outside the declared paths fails and names what to regenerate ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)). A stage that changes a tracked file that was clean at the starting commit also fails ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

Use `discern prepare` while you work, and once more before your final commit, so the mutating stages have nothing left to rewrite. It runs the fix jobs, regenerates every declared `generated:<name>` job, then runs the checks. Its terminal table tracks those jobs from `pending` through `running` to their outcomes. `--plain` and CI make it static. Streams and pipes keep their transcript. A successful result names the omitted build jobs and tests, including an empty fix or check configuration.

Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a Proof for review ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

For the JSON fields and agent-facing tool contract, use [MCP tools & results](../70-reference/mcp-and-results.md).

| Read next                                                   | What it helps you do                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [When the gate fails](when-the-gate-fails.md)               | Read a red result and take the shortest route to the fix.                        |
| [Standards](standards.md)                                   | Hold a metric floor or ceiling and respond when it fires.                        |
| [The Proof](the-proof.md)                                   | Read the review evidence a clean green run records for one commit.               |
| [Proof notes](proof-notes.md)                               | Carry a landed Proof with its trunk commit and opt into fetch transport.         |
| [Strand detection](strand-detection.md)                     | Fix tracked files a gate stage changed after the final commit.                   |
| [Run the gate in CI](ci.md)                                 | Require the same gate on pull requests and trunk pushes.                         |
| [Continuous improvement](improvement.md)                    | Find the highest-value practice to improve after the current change passes.      |
| [Co-change coupling](coupling.md)                           | Check whether this change omitted a file that usually moves with it.             |
| [Practice patterns](patterns.md)                            | Read recurring workflow evidence from the local Logbook.                         |
| [`discern tidy`](tidy.md)                                   | Format discern-owned Markdown and TOML directly or through the format job.       |
| [The fleet test-run cap](concurrent-test-runs.md)           | Queue concurrent test-stage runs so parallel agents share one machine.           |
| [Practice stats](practice-stats.md)                         | Share what went well as one card of plain counts from the local logbook.         |
| [Validation findings](validation-findings.md)               | Compare per-job verdicts within and across recorded execution conditions.        |
| [Patterns decision evidence](patterns-decision-evidence.md) | Read the evidence required before Patterns recommends a Gate or Standard change. |
| [Pattern investigations](pattern-investigations.md)         | Trace related findings into bounded diagnostic paths.                            |
