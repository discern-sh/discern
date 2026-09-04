---
id: guide-improve-the-practice
title: "Improve the practice"
description: "Inspect local evidence, coupling, and improvement findings, then make one bounded practice change."
order: 140
publish: true
kind: guide
aliases:
  - "guide-improve-the-practice"
  - "The continuous-improvement coach"
  - "improvement coach"
  - "practice health"
  - "audit"
  - "Coupling"
  - "cochange"
  - "change partners"
---

# Improve the practice

Use this guide when the project has no immediate workflow failure, but you want the next improvement to come from observed evidence rather than a generic checklist. discern can rank a next action across its installed practice, show recurring local patterns, and identify files that often change together. These are advisory surfaces; the person decides what work is worth doing.

The outcome is one bounded change with a named reason, owner, verification, and destination. A score or finding alone does not alter the gate.

## Starting state

- Run read-only review against the trunk when you want the state shared by future tasks. Use a task worktree when investigating an in-flight change.
- The Logbook is enabled when you expect `discern patterns` to use recent local activity. Its records stay local and contain metadata only.
- The person can decide whether a recommendation belongs in the current backlog and whether it changes project policy.

## 1. Ask for the highest-value next action

**Person or coding agent:** Run:

```sh
discern improvement --markdown
```

The result combines deterministic checks with open review questions across the gate, setup, instructions, map, worktrees, standards, checkpoints, and skills. Read `data.next_action`, its evidence, and any decision it assigns to the person.

Use a category only when you have already bounded the review:

```sh
discern improvement --category standards --markdown
```

Do not chase the numeric health score by changing unrelated work. The score summarizes the current audit; the evidence and recommended action explain what would improve the practice.

## 2. Add local history when it can answer the question

**Coding agent:** Run `discern patterns` when the recommendation concerns repeated behavior, gate fit, funnel flow, or standard movement.

```sh
discern patterns --markdown
```

Each finding should state observed counts and a next investigation. Below its evidence threshold, the result reports insufficient evidence. Treat that as an unknown. It supplies no evidence about whether the pattern is absent.

The person may decline collection by setting `[project].logbook = false`. Existing records remain until an owner confirms their reset or archive; the [logbook reference](../30-reference/logbook.md) owns those operations.

## 3. Check related files while a change is open

`discern coupling` reads Git history and never blocks. With no arguments, it reports habitual partners missing from the current change:

```sh
discern coupling
```

For one file or a pair:

```sh
discern coupling path/to/file
discern coupling path/to/file path/to/partner
```

**Coding agent:** Inspect the cited history and decide whether the partner belongs in this change. A historical relationship is evidence to review. Edit a related file only when the task requires it. Record why a named partner was included or left unchanged when the choice is material to review.

## 4. Route the finding to one change type

**Person and coding agent:** Choose the smallest project surface that addresses the evidence:

| Finding                                               | Appropriate change                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A declared check is missing, slow, or misleading      | Adjust the owning gate job or scope and exercise its failure path.                                  |
| A deterministic number should never regress           | Add or tune a standard through [Set and raise standards](set-and-raise-standards.md).               |
| A narrow change needs a recurring judgment            | Place or tune a checkpoint through [Place and answer checkpoints](place-and-answer-checkpoints.md). |
| Agents repeat a multi-step method poorly              | Create or improve a skill.                                                                          |
| Every session needs one standing rule                 | Update the authored project instructions.                                                           |
| Durable project context is false or missing           | Update the owning map page.                                                                         |
| The observation is weak or the cost exceeds the value | Record no project change; keep or gather the stated evidence.                                       |

Policy changes remain the person's decision. An advisory cannot authorize a new blocker, weaken a standard, or move the trunk.

## 5. Implement and verify one bounded improvement

**Coding agent:** Start or continue one owned worktree for the selected action. State the current evidence, expected improvement, and a way to observe it after the change.

Exercise the relevant path: a failing and passing detector for a standard or gate job, a representative trigger for a checkpoint, a real request for a skill, or a fresh session for instructions. Run `discern prepare`, commit, and run the full gate.

After landing, rerun the original advisory from the trunk. The old finding should be resolved, narrowed, or replaced by a clear next action. A changed score without that behavioral result is insufficient.

## Completion

The review is complete when one finding has traceable evidence and an owner decision. The improvement is complete when one project authority changed, its real path was exercised, the full gate passed, and the original observation shows the intended result after landing.

Read [Evidence and improvement](../20-understand/evidence-and-improvement.md) for the model and [MCP tools and results](../30-reference/mcp-and-results.md) for structured fields. If the review exposes an operational failure, use [Troubleshooting](../40-troubleshooting/README.md).
