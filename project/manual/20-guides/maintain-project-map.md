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

Keep a current explanation of how your project works, written by your agents and readable by you. A new agent starts from it to find where a change belongs and what the change must keep working. You can read what your agents believe, and correct a wrong assumption before it turns into code.

The **map** is that explanation: a folder of Markdown pages, `discern/map/` by default, that your agent keeps current with each change.

## Ask for a review

Say people keep saved lists in your app, and several changes to saving have landed since anyone reread the map's page on them. Ask:

> "Check what the map says about saved lists against the current code and tests. Fix what's wrong, and show me what a future change must keep working."

## How your agent keeps a page current

**It finds the right page.** The agent searches the map in the words of the task, such as `discern map --search "saved lists"`, then follows the page's links to the code, tests, and decisions behind it.

**It brings each claim up to date.** A page describes the project as it is now, so the agent replaces what's out of date and removes stories of fixed bugs and finished changes.

**It reports gaps instead of guessing.** If the code doesn't show how something works, or conflicts with what you agreed, the agent tells you, because what the product should do is your decision. Concrete unfinished work goes in the work ledger, `discern/TODO.md` by default.

## Explain what a change must keep working

A useful page tells the next reader what a change must preserve. "Save reads the list, validate checks it, write stores it" gives a reader little to work with. "A saved list replaces the old copy only after it passes validation, so a failed save keeps the last good version" tells a future change what it must not break. The page links to the tests for a failed save, so readers can check it.

Keep what the project should do apart from what it does today. "Saved lists must open offline" records an agreed goal, so the agent reads the code before claiming that offline reading works now.

## Let the map grow with the project

Setup starts the map with a root page that points readers to each section, a design-principles page for the rules you choose, and a gate-gotchas page for failures whose own output doesn't explain them. discern points agents to that page when such a failure happens.

As a feature grows, the agent first updates the nearest section. A distinct reader task can earn its own page, and a lasting responsibility can earn a folder with a README.

A page links to what the project records elsewhere, such as its docs, instructions, skills, tests, and decision records, instead of copying it, so each fact keeps one home. [Pick the right home](../10-understand/instructions-skills-and-map.md#pick-the-right-home) shows which kind of lesson goes where.

## Keep some pages out of view, or export the map

A few folder names change how discern treats a map page:

| Folder      | What it holds                        | How discern treats it                               |
| ----------- | ------------------------------------ | --------------------------------------------------- |
| `_internal` | Pages agents need but readers don't. | Searchable, and checked like any current page.      |
| `_adr`      | Decision records, kept as history.   | Opened by name, and skipped by current-page checks. |
| `_private`  | Drafts and notes.                    | Left out of search, and opened only when named.     |

These folders don't control access: anyone with the repository can read them. To share the map, `discern map --export public` joins its published pages into one file, and `--export all` includes everything.

## Review map pages for drift when code changes

When a later commit changes a file that a page links to, `discern map` asks your agent to review the page. If three commits have changed the saving code since the saved-lists page last changed, it reports:

```text
Review `saved-lists`: 3 later commits to linked sources.
```

Only links to specific, committed files count, so a page without them shows its freshness as unknown.

The built-in map **checkpoints**, review questions your agent answers when a change touches certain files, help too:

- **Map focus** holds back the **gate**, your project's own commands such as its tests, on a new page or a large rewrite, until the agent answers whether the page helps a future reader decide correctly and sits in the right section.
- **Map drift** suggests a review, without blocking, when files a page links to change.

The gate also checks the map's links, heading anchors, and command examples. No check can tell whether an explanation is true, so the agent still reads the code.

## When it's done

- A new reader can get from the root page to the affected page.
- The page says what a change must keep working, and links to the code and tests.
- The agent checked each claim against the code.
- The change passed the gate and landed.

To test a page, ask your agent to read it as a new contributor would. If that reader can't find the code or a constraint that matters, the page needs more work. You can [pre-approve changes that only touch the map](finish-and-land-a-change.md#pre-approve-routine-work), so they land without asking you.
