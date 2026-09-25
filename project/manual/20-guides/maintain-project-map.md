---
id: guide-maintain-project-map
title: Maintain the project map
description: Keep a current, readable account of how your project works, so each new agent starts from it and you can correct a wrong assumption early.
order: 85
publish: true
kind: guide
aliases:
  - guide-maintain-project-map
  - maintain-project-map
  - map maintenance
---

# Maintain the project map

Keep a current explanation of how your project works, written by your agents and readable by you. A new agent starts from it to find where a change belongs and what the change must keep working, and you can read what your agents believe about the project and correct a wrong assumption before it turns into code.

The **map** is that explanation: a folder of Markdown pages in your project, `discern/map/` by default. Your agent keeps it current as part of each change, and you can ask for a review at any time.

## Ask for a review

Say people keep saved lists in your app, and several changes to saving have landed since anyone reread the map's page about them. Ask:

> "Check what the map says about saved lists against the current code and tests. Fix what's wrong, and show me what a future change must keep working."

## How your agent keeps a page current

**It finds the right page.** The agent searches the map in the words of the task, for example with `discern map --search "saved lists"`. It reads the section's README, then follows the page's links to the code, tests, configuration, and decisions behind it. If your project already has documentation that owns a subject, the map links to it and explains why it matters.

**It brings each claim up to date.** A page describes the project as it is now, so the agent replaces descriptions that are out of date and removes stories about bugs that are fixed or changes that are finished. A page that's still true needs no edit.

**It reports gaps instead of guessing.** If the code doesn't show how something works, or it conflicts with what you agreed, the agent tells you instead of writing a confident claim, because what the product should do is your decision. Concrete unfinished work goes in the work ledger, `discern/TODO.md` by default.

## Explain what a change must keep working

A useful page tells the next reader what a change must preserve, which a list of every function rarely does.

"Save reads the list, validate checks it, write stores it" gives a reader little to work with. Compare "A saved list replaces the old copy only after it passes validation, so a failed save keeps the last good version." That tells a future change what it must not break, and the page links to the code and to the tests for a failed save, so a reader can check the claim.

Keep what the project should do apart from what it does today. "Saved lists must open offline" records an agreed goal, so the agent reads the code before claiming that offline reading works now. An **ADR**, an Architecture Decision Record, keeps the reason for a significant choice, and a test covers the behavior.

## Let the map grow with the project

When setup creates the map, it writes a set of starting pages, and the setup agent trims or combines them to fit your project. The root page explains the project and points readers to the right sections. Setup also writes:

- a design-principles page, for the rules you choose and why they matter;
- a gate-gotchas page, for recovery advice about failures whose own output doesn't explain them, which discern points agents to when such a failure happens.

As a feature grows, the agent first updates the nearest section. A distinct reader task can earn its own page, and a new responsibility with a lasting boundary can earn its own folder with a README. Short topics can share one README. Numbers in folder names are optional and only set a reading order.

## Link the map to the rest of what the project knows

The map explains how the parts fit together and links to the places that own each kind of knowledge:

| Kind of knowledge               | Where it lives                                        |
| ------------------------------- | ----------------------------------------------------- |
| Rules every session follows     | [Project instructions](write-project-instructions.md) |
| Methods for particular tasks    | [Skills](create-and-manage-skills.md)                 |
| Behavior that can be tested     | Tests and lint rules                                  |
| Questions that need judgment    | [Checkpoints](place-and-answer-checkpoints.md)        |
| Reasons for significant choices | ADRs                                                  |
| Open work                       | The work ledger                                       |

A page links to these instead of copying them, so each fact has one home to keep current. For a large documentation effort, your agent can split the work, as [Delegate work](delegate-work.md) shows. If your project needs a house style, keep it in your instructions or a skill.

## Keep some pages out of view, or export the map

Map pages are ordinary Markdown. Frontmatter, the settings block at the top of a page, is optional. A few folder names change how discern treats a page:

| Folder      | What it holds                                        | How discern treats it                               |
| ----------- | ---------------------------------------------------- | --------------------------------------------------- |
| `_internal` | Supporting pages that agents need but readers don't. | Searchable, and checked like any current page.      |
| `_adr`      | Decision records, kept as history.                   | Opened by name, and skipped by current-page checks. |
| `_private`  | Drafts and notes.                                    | Left out of search. Opened only when named.         |

Other folder names that start with an underscore get no special treatment. None of these folders controls access: anyone with the repository can read them.

To share the map, `discern map --export public` writes the pages marked for publication into one file. `--export all` includes everything, even `_internal` and `_private`. Your map doesn't need the frontmatter that discern's own manual uses.

## Review map pages for drift when code changes

Each page links to the files it explains, and when a later commit changes one of those files, `discern map` asks your agent to review that page. If three commits have changed the saving code since the saved-lists page last changed, it reports:

```text
Review `saved-lists`: 3 later commits to linked sources.
```

discern counts commits since the page itself last changed, so editing a different page doesn't clear the prompt. Only links to specific, committed files count, and a page without such links shows its freshness as unknown.

discern's built-in map checkpoints help too. A **checkpoint** is a review question your agent answers on certain changes:

- **Map focus** holds back the **gate**, your project's own commands such as its tests, on a new page or a large rewrite, until the agent answers whether the page helps a future reader decide correctly and sits in the right section.
- **Map drift** suggests a review when files that a page links to change, asking whether those pages still describe the project as it is now. When no page links to the changed files, it still fires on a change of five or more files.

The gate also checks every link, heading anchor, and command example in the map on every run. These checks point to pages worth reviewing, but none of them can tell whether an explanation is true, so the agent still reads the code.

## When it's done

- A new reader can get from the map's root page to the affected page.
- The page says what a change must keep working, and links to the code and tests.
- The agent checked each claim against the code.
- The change passed the gate and landed.

You can pre-approve changes that only touch the map, so they land without asking you. [Finish and land a change](finish-and-land-a-change.md#pre-approve-routine-work) explains how.

To test a page, ask your agent to walk through it as a new contributor would. If that reader still can't find the code or understand a constraint that matters, the page needs more work. [Instructions, skills, and the map](../10-understand/instructions-skills-and-map.md) explains how the map fits with the rest.
