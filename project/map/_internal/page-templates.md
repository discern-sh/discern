# Page-type templates

These page shapes cover the map's published tiers: overview, quickstart, guide, reference, and troubleshooting. Follow the [documenter brief](documenter-agent-brief.md) for each page's purpose and structure. Follow the [product voice skill](../../skills/discern-product-voice/SKILL.md) for register. Select the shape by the page's primary job; split a page that serves two jobs.

Each skeleton shows the full frontmatter that its page shape typically carries. Keep only keys permitted by the brief's frontmatter table. Word budgets count body prose and exclude frontmatter and code fences.

<!-- project-page-shape: overview -->

## Overview

Default budget: 200–350 words.

The section's front door states what this part of the system is, why it exists, and where to read next. End with a curated leaf table containing one line per leaf in reading order. Keep mechanism detail in the leaves.

```markdown
---
description: What this section covers, in one search-result-sized line.
---

# The <subsystem>

_One-line summary._

What this is and why it exists, in 2–3 short paragraphs a newcomer can read in 60 seconds. Name the one or two ideas worth understanding before the leaves.

| Read next      | What's in it   |
| -------------- | -------------- |
| [<leaf>](x.md) | One line each. |
```

<!-- project-page-shape: quickstart -->

## Quickstart

Default budget: 600–1,000 words.

Begin with the reader's desired outcome. State the goal and prerequisites, then provide numbered steps with each exact command and visible success result. End with the achieved outcome and one next-page link.

```markdown
---
description: Get from A to B in N minutes.
order: 10
aliases:
  - getting started
---

# <Outcome, stated as a task>

_What you'll have at the end, in one line._

Prerequisites: list the required versions, accounts, and tools before the numbered procedure.

## 1. <First action>

The command, fenced and copyable. What success looks like — the actual output moment the reader should see.

## 2. <Next action>

…

You now have <the outcome>. Next: [<the deeper page>](x.md).
```

<!-- project-page-shape: guide -->

## Guide / concept

Default budget: 500–900 words.

Explain one mechanism or workflow: what it is, how it works, when to use it, and which alternative covers a different case. The documenter brief specializes this shape for code-oriented subsystem leaves without redefining its budget. Put every file path and known trap in "Where it lives in code" and "Current state & gotchas."

```markdown
---
description: What <the thing> does and when to reach for it.
order: 20
---

# <The thing>

_One-line summary._

What it is and the problem it solves — the answer first, then the mechanism.

## How it works

Steps or short prose. Keep file paths in "Where it lives in code."

## When to use it

Give one recommendation and the alternative for cases it does not cover.

## Where it lives in code

| Concept | File |
| ------- | ---- |

## Current state & gotchas

The surprises: half-built corners, known traps, and stated limitations.
```

<!-- project-page-shape: reference -->

## Reference

Default budget: unbudgeted; keep it scannable.

Cover every key, flag, value, default, and limit in tables and definition lists. Use a neutral, scannable register. Characterful example values may retain personality. State preferences only as named defaults.

```markdown
---
title: <Short label>
description: Every <key/flag/field> of <the subject>, with defaults.
order: 30
aliases:
  - <cli spelling>
---

# <The subject> reference

_What this page enumerates, in one line._

## <Group>

| Key | Type | Default | What it does |
| --- | ---- | ------- | ------------ |
```

<!-- project-page-shape: troubleshooting -->

## Troubleshooting

Default budget: 300–700 words.

Lead with the symptom. Headings quote what the reader sees; each entry gives the cause and one recommended fix before any alternative. Use calm, neutral language.

```markdown
---
description: The failures <subject> can hit, and the fix for each.
order: 40
---

# When <the subject> fails

_Match your symptom to a heading; each gives the cause and the fix._

## `<the error text or symptom>`

What happened and why, in a sentence. Then the fix, imperative, fenced if it's a command. Escape hatch last, if one exists.
```
