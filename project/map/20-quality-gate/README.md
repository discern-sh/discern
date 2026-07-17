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

The gate is the repository's definition of done. It first checks that the branch contains the latest trunk, the branch did not weaken a standard, and discern's generated artifacts are current. It then runs the configured work in a fixed sequence: fixers serially, build jobs in parallel, checks, tests, and standard measurements together, then gates for the scopes that changed. A stage that changes a committed-clean tracked file also fails the run, so generated output cannot hide behind a green result ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

Use `discern prepare` while you work. It runs the fix and check stages without paying for builds or tests. Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a receipt for review ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

For the JSON fields and agent-facing tool contract, use [MCP tools & results](../70-reference/mcp-and-results.md).

| Read next                                     | What it helps you do                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [When the gate fails](when-the-gate-fails.md) | Read a red result and take the shortest route to the fix.                   |
| [Standards](standards.md)                     | Hold a metric floor or ceiling and respond when it fires.                   |
| [The receipt](the-receipt.md)                 | Understand the proof a clean green run hands to the reviewer.               |
| [Strand detection](strand-detection.md)       | Fix tracked files a gate stage changed after the final commit.              |
| [Run the gate in CI](ci.md)                   | Require the same gate on pull requests and trunk pushes.                    |
| [Continuous improvement](improvement.md)      | Find the highest-value practice to improve after the current change passes. |
| [Co-change coupling](coupling.md)             | Check whether this change omitted a file that usually moves with it.        |
