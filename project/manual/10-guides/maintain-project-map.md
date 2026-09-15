---
id: guide-maintain-project-map
title: Maintain the project map
description: Keep the project's explanation useful as features grow, with evidence, clear boundaries, and links to the right working knowledge.
order: 85
publish: true
kind: guide
aliases:
  - guide-maintain-project-map
  - map maintenance
---

# Maintain the project map

A new agent should be able to find where a feature belongs and what a change must preserve. The map gives them that starting point. It also gives you a readable account of what your agents understand, so you can correct a mistaken assumption before it becomes code.

Once discern is set up, your agent maintains the map alongside the project. You can ask for a focused review:

> Check the map's explanation of saved lists against the current code and tests. Update what is wrong, and show me the constraint a future change must preserve.

## Start with the affected explanation

Your agent searches the map in the language of the task, reads the relevant region's README, and follows its links to the implementation, tests, configuration, and decisions. Existing project documentation can remain the authority; the map links to it and explains why it matters.

The agent checks the claims that the change could affect. A page that is still accurate needs no cosmetic edit. If the evidence is missing or conflicts with an agreed requirement, the agent reports the gap instead of writing a confident claim. You decide unresolved product intent; the project’s work ledger holds concrete unfinished work.

## Explain the contract a reader needs

A useful page connects behavior, boundaries, and constraints. A short implementation summary can make that connection clear. Naming every method usually does not.

For example, “parse reads the file, validate checks it, write saves it” gives a reader little help. “Validation completes before the saved file is replaced, so failed validation preserves the previous usable copy” explains something a future change must preserve. The page links to the implementation and the failure tests so the reader can check that account.

Requirements and observed behavior can differ. “Saved lists must work offline” records agreed intent. The agent checks the implementation before claiming that offline reading works today. An ADR can preserve the reason for the requirement; a test can cover its behavior.

## Grow a useful hierarchy

Setup provides a complete starting map, sized to what the project actually contains. The root explains the project and routes readers to orientation, real subsystem responsibilities, development guidance, and decisions. Short topics can share a region README. Numbered folder names are an optional reading order.

When a feature grows, the agent first updates the nearest relevant section. A distinct reader task can earn a child page. A new responsibility with a lasting boundary can earn its own region and README. This keeps ordinary feature additions near the systems they affect.

For a project with no implementation yet, a substantive root can be enough. As real responsibilities emerge, the agent groups their explanations into regions. Empty folders and pages waiting for someone to finish them do not help the next task.

## Connect the working knowledge

The map explains how the project's parts fit together and links to the authorities needed for a change. Instructions carry standing rules; skills carry repeatable methods; checks verify behavior; checkpoints ask for judgment; ADRs preserve significant reasoning; the work ledger records open work.

A subsystem page might connect a data boundary to its tests, the approved decision behind it, and a recovery procedure. It need not copy those sources. The questions worth preserving depend on the project: data handling, failure recovery, compatibility, or release dependencies may matter without needing a separate page for each.

For a large documentation effort, the agent can use the existing delegation workflow with ordinary task briefs. Projects can keep their own editorial instructions or skills when they need a particular house style.

## Review the result

The finished change gives a new reader a useful explanation, evidence links, and a route from the map root to the affected pages. The agent checks factual claims as well as navigation. discern's mechanical checks and freshness signals help locate problems; they cannot establish that an explanation is true.

You can ask the agent to walk through the page as a new contributor. If it leaves a reader unable to locate the relevant code or understand a consequential constraint, the explanation still needs work. [Instructions, skills, and the map](../20-understand/instructions-skills-and-map.md) explains how the different kinds of project knowledge support the next session.
