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

This project adopts [discern](https://discern.sh), an engineering practice for software built with coding agents. The repository holds the project-specific parts of that practice: instructions, declared checks, reusable agent playbooks called skills, and records of decisions like this one. They stay with the code, where every future session can use them.

- Project-specific instructions and significant decisions stay with the code. Future configured agents begin from the same maintained account of the project.
- Each effort receives its own Git worktree and branch, so concurrent tasks never share a checkout. Overlapping source changes still require integration before landing.
- `discern done` runs the project's final quality check, the gate. `discern.toml` declares its jobs and configured quality measures, called standards. Together they give the project a shared definition of technical completion.
- A green gate over a clean, committed tree can produce evidence tied to that tree, called Proof. Landing remains a separate acceptance decision with its own authority check.

<!-- setup fills this -->

<!--
  Replace this comment block with a short paragraph naming the jobs this
  project's gate runs and what those jobs establish. Use the real commands
  wired into `discern.toml`. Keep every claim within what those checks support.
-->

discern seeded this record when the project adopted the practice, and the agent configuring the project completed its project-specific sections. Later decisions begin from [the template](0000-template.md).

## Consequences

- A future contributor or agent can read how the project works, and why, from the repository itself: the instructions, the maintained documentation called the map, and these records. The project keeps that account current as the code changes.
- Separate worktrees prevent concurrent efforts from overwriting the same checkout. discern manages their lifecycle. Source overlap still requires integration before landing.
- The Gate adds verification time to technical completion. The project maintains its jobs and chooses what its standards measure. A branch cannot loosen a configured standard; changing a limit remains a project decision.
- Agent instruction files and materialized skills come from authored sources. Contributors edit those sources and run `discern refresh`; edits to generated copies are overwritten.
- The project depends on discern for this workflow. Uninstalling discern retains the authored instructions and map. The project must replace any removed enforcement and lifecycle behavior it still needs.

<!-- setup fills this -->

<!--
  Add 1 to 3 consequences specific to this project. Name a real benefit, cost,
  or changed habit without repeating the generic consequences above. Then
  delete this comment block.
-->
