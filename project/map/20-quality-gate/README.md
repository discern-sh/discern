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

The Gate defines done. It requires latest trunk, non-weakened Standards, current [generated artifacts](../00-orientation/glossary.md#generated-artifact), and consistent Map and guidance. Its integrity check rejects broken references, metadata, and Skills ([ADR 0202](../_adr/0202-the-gate-ships-the-map-integrity-preflight.md)). It runs fix serially; build, check, test, Standards, and changed-scope gates follow. Undeclared generated output fails ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)), as does changing a tracked file that began clean ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

Use `discern prepare` before the final commit. It runs fix, every `generated:<name>` job, and check, then names omitted jobs.

Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a Proof for review ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md)).

## Live terminal presentation

On a live-capable terminal, `done`, `prepare`, `test`, and human composite Gate runs always use one activity frame. Stable job-start and job-result facts stay pinned while complete subprocess lines enter a bounded tail and partial lines update in place. `[gate].stream` does not decide whether this frame appears.

The package-owned frame uses this fitting order:

1. Full live frame with its configured tail when the complete frame fits.
2. Compact live frame with fewer tail rows when only that geometry fits.
3. Append-only rendering when cursor-controlled painting is no longer safe.

The same producer feed continues through every degradation; a resize never switches an admitted live run to the project's static transcript policy. Interrupts restore the cursor and leave the stable activity facts in terminal history.

On success, completion leaves the stable summary without replaying the transient tail as a complete output wall. On failure, the captured diagnostic excerpt, full-output-artifact route, remedy, and result tail appear below the restored frame.

Static surfaces keep the configured transcript contract. CI, pipes, `--plain`, and terminals without cursor control use grouped per-job output when `[gate].stream = false` and immediate line-prefixed output when it is `true`. JSON, Markdown, and Model Context Protocol calls bypass human job output and return only their result projection.

For JSON fields, the Markdown presentation, and the MCP tool contract, use [MCP tools & results](../70-reference/mcp-and-results.md).

[`execute.ts`](../../../src/engine/gate/execute.ts) resolves the shared output and capture policy. [`gate_tty.ts`](../../../src/engine/gate/gate_tty.ts) maps Gate lifecycle and child-output facts into the package producer; the package owns painting, fitting, and degradation. [`command.ts`](../../../src/engine/jobs/command.ts) preserves raw capture while feeding presentation-only decoded text, and [`terminal.ts`](../../../src/lib/terminal.ts) observes the process.

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
