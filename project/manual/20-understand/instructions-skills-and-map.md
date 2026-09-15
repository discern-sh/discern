---
id: explanation-instructions-skills-and-map
title: "Instructions, skills, and the map"
description: "See how a correction, a useful method, and a project decision become knowledge future coding-agent sessions can use."
order: 70
publish: true
kind: explanation
aliases:
  - "explanation-instructions-skills-and-map"
  - "What a skill is"
  - "skill"
  - "playbook"
  - "skill discovery"
  - "map"
---

# Instructions, skills, and the map

You correct an agent's approach on Tuesday, and Thursday's session makes the same choice again. The lesson is still in a conversation, but the new session has no reason to find it.

discern gives useful project knowledge a lasting home. **Instructions** carry working rules, **skills** carry methods for particular tasks, and the **map** explains the project. Your agents write and maintain these ordinary files alongside the code, so what one task teaches can help the next.

## Follow a lesson into the next session

Imagine an app where people save things they want to read. You try it on a train and find that opening a saved list requires an internet connection. You explain that people should be able to read their lists offline.

Your agent fixes the behavior and adds appropriate checks. You also ask:

> Record that saved lists should remain readable without an internet connection, and explain why in the project guide. Future agents need to understand this when changing the app.

The next session can now discover both the rule and its reason. It does not need your account of the train journey. The project carries the useful knowledge, while the checks cover the behavior they can verify.

Different parts of that knowledge do different jobs. Keeping those jobs clear helps the next agent find the rules and decisions relevant to its task.

## Instructions: what every session must know

A standing rule such as “keep saved lists readable offline” belongs in the shared project instructions. The default source is `discern/instructions.md`.

Your agent edits that source and runs `discern refresh`. discern combines the project rules with its built-in operating instructions and supplies the result through each configured coding tool's instruction files. Some tools read the full file and others follow a pointer. The source stays the same.

The gate checks that generated files agree with their sources. A mismatch means the agent needs to refresh those copies. A running session may still have loaded an older version, so a fresh session confirms that the updated instructions are being read.

Instructions are present throughout a session. Keep the standing rule short and put the fuller explanation in the project guide, where the instruction can link to it. This gives each task the important starting conditions without making every task read all the background.

## Skills: procedures that load at need

Suppose you have developed a useful way to review a new screen: try it with no saved items, with several items, while loading, and when something fails. For each state, check whether someone knows what happened and what to do next.

That is a recurring method with judgment involved. A **skill** can carry it for later screen reviews. Its short description tells the agent when it applies; the full procedure is read when needed.

discern bundles skills for tasks such as curing a recurring bug, dividing substantial work, and recording a lesson. Your project can add its own. Refresh supplies the selected set to each configured coding tool, and an authored skill with a bundled skill's name overrides that bundled method. [Create and manage skills](../10-guides/create-and-manage-skills.md) shows useful requests and customization.

### Make an operational procedure self-contained

A future agent needs to know what the method expects, which choices to make, what to return, and when to stop for missing information. A screen-review skill might ask for the intended audience and a way to open each state, then require the agent to show the resulting messages and identify unresolved questions.

Writing “review it the way we did last time” would send the next session back to the missing conversation. A self-contained method lets you give a shorter task request without losing the useful detail.

## The map: what the agents understand

The **map** is the maintained project guide. For the saved-lists feature, it can explain where lists are stored, which parts of the app use them, and why offline reading matters. It links to the code that owns the details rather than copying information the code already expresses.

You can read it too. Ask:

> Show me the map's account of saved lists. Does it still describe how the app works after this change?

That gives you something to correct before a misunderstanding appears in another implementation. Agents are expected to keep the map current as they change the project. [Maintain the project map](../10-guides/maintain-project-map.md) shows how to review an explanation and where new material belongs.

The checks cover its mechanics: links, heading references, command examples, and metadata. File-linked freshness information can also identify pages whose sources changed. Those checks help locate work to review; a page can pass them and still contain an incorrect explanation. Reading the code and judging the explanation remain part of the agent's work.

## Keep the reason for a significant decision

Some choices need more than a standing rule. Suppose you decide people should be able to keep a list without creating an account, accepting limits on sharing it between devices. The alternatives and tradeoff matter to future work.

An **Architecture Decision Record**, or **ADR**, preserves that account: what you decided, why, and what follows from it. The map and relevant instructions can link to the record. A later agent can understand the choice before proposing to reverse it.

The bundled `discern-write-adr` skill helps record decisions that are significant or difficult to reverse. Ordinary implementation details do not all need their own decision record.

## Choose the home that does the job

You can ask “capture this lesson” without knowing the file structure. The `discern-teach-the-project` skill helps your agent choose the smallest useful home:

| What you want to preserve                                                | Where it belongs                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| A standing rule: saved lists remain readable offline                     | Project instructions, with a link to fuller context when needed.       |
| A method: review a screen in its meaningful states                       | A skill the agent can use for that kind of task.                       |
| Context: how saved lists fit into the app                                | The map, linked to the relevant code.                                  |
| A significant choice: why accounts are optional                          | An ADR that records the reasoning and tradeoff.                        |
| A measured improvement: less data to download when opening the app       | A [standard](standards.md) that holds a chosen limit.                  |
| A judgment: whether a changed screen makes the offline limitations clear | A [checkpoint](checkpoints.md) asked when the relevant change happens. |
| A fixed, repeatable action: prepare a local preview with sample items    | A project script the agent can run.                                    |

These homes can link to one another without repeating the same explanation. If a rule or method already exists, revise it there. The aim is for the next reader to find one current answer.

## Whose writing is which

Your project's existing README and documentation remain project-authored material. discern's map lives at the location configured for it; setup does not adopt an unrelated documentation folder.

This manual explains discern itself and is available offline through `discern docs`. Your project's map explains your project. [discern's own published map](https://discern.sh/map) is an example of the latter: the account its agents maintain while developing discern.

What persists is what you and your agents record. Private conversation history does not become shared project knowledge on its own. [Write project instructions](../10-guides/write-project-instructions.md) and [Create and manage skills](../10-guides/create-and-manage-skills.md) show how to turn the next useful lesson into something another session can use.
