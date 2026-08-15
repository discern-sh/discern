# ADR 0001: Adopt discern for development with coding agents

**Status**: accepted

## Context

<!-- setup fills this -->

<!--
  Completed by the agent that configured discern for this project. Replace
  this comment block with 2 or 3 project-specific paragraphs:

  - How the project coordinated and verified changes before discern, including
    any existing use of coding agents.
  - What about the project's current scale, intended future, or use of agents
    made a shared practice worth adopting now.
  - Which repository evidence and setup decisions support that account.

  Describe the previous approach without inventing failures or blaming people
  or agents. Give a future reader enough context to understand the choice.
-->

## Decision

This project adopts [discern](https://discern.sh), an engineering practice for software built with coding agents. The repository holds the project-specific parts of that practice: guidance, declared checks, reusable agent playbooks called Skills, and decision records.

- Project-specific guidance and significant decisions stay with the code. Future configured agents begin from the same maintained account of the project.
- Each effort receives a separate Git worktree and branch. Concurrent tasks do not share a mutable checkout. Overlapping source changes still require integration before landing.
- `discern done` runs the project's final quality check, called the Gate. `discern.toml` declares its jobs and configured quality measures, called Standards. Together they give the project a shared definition of technical completion.
- A green Gate over a clean, committed tree can produce evidence tied to that tree, called Proof. Landing remains a separate acceptance decision with its own authority check.

<!-- setup fills this -->

<!--
  Replace this comment block with a short paragraph naming the jobs this
  project's Gate runs and what those jobs establish. Use the real commands
  wired into `discern.toml`. Keep every claim within what those checks support.
-->

discern seeded this record during setup. The configuring agent completed it with this project's context, Gate, and consequences. Later decisions begin from [the template](0000-template.md).

## Consequences

- Future configured agents inherit the project's guidance and maintained documentation, called the Map. The project keeps that account current as the code changes.
- Separate worktrees prevent concurrent efforts from overwriting the same checkout. discern manages their lifecycle. Source overlap still requires integration before landing.
- The Gate adds verification time to technical completion. The project maintains its jobs and chooses what its Standards measure. A branch cannot loosen a configured Standard; changing a limit remains a project decision.
- Agent instruction files and materialized Skills come from authored sources. Contributors edit those sources and run `discern refresh`; edits to generated copies are overwritten.
- The project depends on discern for this workflow. Uninstalling discern retains the authored guidance and Map. The project must replace any removed enforcement and lifecycle behavior it still needs.

<!-- setup fills this -->

<!--
  Add 1 to 3 consequences specific to this project. Name a real benefit, cost,
  or changed habit without repeating the generic consequences above. Then
  delete this comment block.
-->
