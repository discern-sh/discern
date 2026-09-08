---
id: guide-create-and-manage-skills
title: "Create and manage skills"
description: "Discover useful requests for discern's bundled skills, then create or adapt a reusable method for your own project."
order: 90
publish: true
kind: guide
aliases:
  - "Skills"
  - "guide-create-and-manage-skills"
  - "Author a project skill"
  - "create a skill"
  - "authored skills"
  - "project skills"
  - "Customize or exclude a skill"
  - "eject skill"
  - "override skill"
  - "exclude skill"
  - "Teach the project"
  - "remember this"
  - "capture a lesson"
  - "project memory"
---

# Create and manage skills

Some tasks benefit from a method you would not want to explain from scratch each time: investigate a recurring bug, divide a large idea into tasks, or preserve a lesson for the next agent. A **skill** gives your coding agent a focused playbook for that work.

discern comes with skills you can use immediately after setup. Start with a request in ordinary language. Your agent can find the relevant skill, read its procedure, and apply it to your project. You can later add your own methods or adapt the bundled ones.

## Try a bundled skill

The requests below show what each bundled skill helps accomplish. You can name the skill explicitly, or describe the task and let your agent select it.

| Ask your agent                                                                                  | The method and what comes back                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Help me divide this feature into tasks that several agents can work on.”                       | `discern-delegate-work` prepares complete briefs, identifies dependencies, and offers independent review. See [Delegate work](delegate-work.md).                          |
| “Wait for the saved-items task to land, then build search on top of it.”                        | `discern-await-the-fleet` waits for the named work in another effort, then brings it into the dependent task. See [Wait for another task](wait-for-another-task.md).      |
| “This bug keeps returning. Find the cause and check for it everywhere it can occur.”            | `discern-cure-a-bug` investigates the cause, fixes the affected cases, and leaves a practical check against recurrence.                                                   |
| “Clean up the unused and duplicated code without changing how the app works.”                   | `discern-clear-the-decks` verifies each removal, makes small changes, and establishes a measure to keep the clutter from growing back.                                    |
| “We reduced how much people download to open the app. Help us keep that improvement.”           | `discern-set-the-standard` chooses a useful measurement and sets a limit the gate can hold. See [Set and raise standards](set-and-raise-standards.md).                    |
| “When a form changes, make sure someone considers whether its questions are clear.”             | `discern-place-a-checkpoint` turns that concern into a focused review question for relevant changes. See [Place and answer checkpoints](place-and-answer-checkpoints.md). |
| “Update our project guide to explain how saved lists work.”                                     | `discern-document-subsystem` checks the code and refreshes the relevant section of the configured project guide.                                                          |
| “Remember what we learned here so the next session can use it.”                                 | `discern-teach-the-project` finds the right existing home for the lesson or creates the smallest useful one. See [Teach a durable lesson](#teach-a-durable-lesson).       |
| “Record why we chose to let people use saved lists without signing in.”                         | `discern-write-adr` records a significant decision, its reasons, and the alternatives in an Architecture Decision Record (ADR).                                           |
| “These three parts of the app repeat the same list of choices. Give that information one home.” | `discern-write-it-once` finds one source for a shared fact and connects the places that depend on it, with checks to keep them aligned.                                   |

These are methods, not extra models or automatic permission to act. Your agent still needs to understand the project, honor the task's scope, and verify its changes.

Ask “which skills are available in this project?” to see the known skills, including the project's additions and customizations. Your agent uses `discern skills list`, which also marks excluded skills. A skill can be known to discern without being supplied to the coding tool; the current session may also need its integration refreshed.

## Starting state for a new skill

Create a skill when your project has a recurring method that involves judgment. For example, reviewing the wording of a new screen requires understanding its purpose, checking different states, and deciding whether the instructions help.

A rule every session needs belongs in [project instructions](write-project-instructions.md). A fixed command sequence is better expressed as a project script. Your agent should first check whether an existing skill already covers the work, so the project has one method to maintain.

## Author a project skill

### 1. Describe when to use it and what to return

Give your agent a request such as:

> Create a skill for reviewing the words people see in our app. Use it when we add or change labels, instructions, errors, or confirmation messages. It should check the wording in context and bring back the revised copy with any questions we need to decide.

The description should name situations you encounter. The expected result should be something you can review, rather than an open-ended instruction to improve everything.

### 2. Review the playbook

Your agent creates one directory under the configured skill source, `discern/skills/` by default. It contains a `SKILL.md` with a name, a description used for discovery, and the procedure.

Read that procedure as a method you are choosing for future work. It should explain what the agent needs before starting, the judgments to make, how to verify the result, and what to do when information is missing. For a wording review, that might mean trying the screen's success and failure states before proposing new text.

The agent can use its skill-authoring tools when available. The [configuration reference](../30-reference/config-reference.md) holds directory settings; the authored `SKILL.md` remains the source you and your agents maintain.

### 3. Refresh and try a real request

The agent previews and applies `discern refresh`, then checks `discern skills list`. The new skill should appear once, with the intended authored source. Generated skill folders are maintained by discern; edits belong in the source directory.

Try a representative request in a fresh configured coding-agent session opened in the worktree containing the new skill. For example:

> Review the messages on our new saved-items screen using the wording-review skill.

The agent should read the playbook and return what it promises. Also try an ordinary request that should lead it to discover the skill without being named. If discovery is unreliable, the agent can clarify the description. If it loads for unrelated work, narrow the situations it names.

### 4. Verify and keep the result

Your agent prepares and commits the authored skill, runs the full gate, and brings it back for review. A successful trial matters alongside those checks: a valid file can still describe an unhelpful procedure. [Finish and land a change](finish-and-land-a-change.md) covers making it part of the shared project.

## Customize a bundled skill

When a bundled method needs a lasting project-specific change, ask your agent to adapt it. The agent uses `discern skills eject` with that skill's exact name to copy it into your authored directory, then edits the copy and refreshes.

A project-authored skill with the same name overrides the bundled version. This leaves one effective method, while putting responsibility for its customized wording in your project. Try the changed procedure before landing it. A preference for just one task can stay in that task's request.

## Exclude an unused skill

You can ask your agent to remove a skill from the project's available set. It records the exact name in `[skills].exclude`, refreshes the integration, and verifies that `discern skills list` marks it as excluded. Your authored files remain available; the skill is no longer supplied through discern's materialized set.

An unknown name produces a warning, so the agent should resolve that warning before treating the exclusion as successful. If a session already loaded that skill, start a fresh session to test the change.

## Teach a durable lesson

You do not need to decide the right file before asking the project to remember something:

> Capture the lesson from this task so future agents can use it. Update an existing source if it already belongs somewhere, and tell me where you recorded it.

The teach-the-project skill distinguishes a standing rule, a reusable method, project context, a review question, a fixed command, and a significant decision. It puts the lesson where the next relevant session can find it. [Instructions, skills, and the map](../20-understand/instructions-skills-and-map.md) shows those choices through an example.

If the agent notices a possible lesson itself, it offers to capture it at a natural pause. You can decide that the lesson is useful beyond this task or leave it in the conversation.

## Completion

A useful skill is available in the configured coding tools and works on a representative request. A changed skill also has a verified, committed source, ready for your landing decision. When a lesson was captured, the report should name what was recorded, where it lives, and how the agent checked it.
