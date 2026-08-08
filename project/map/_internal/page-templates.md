# Page-type templates

These page shapes cover the map's published tiers: overview, quickstart, guide, reference, and troubleshooting. The [documenter brief](documenter-agent-brief.md) assigns each page's job and owns these structures; the [product voice skill](../../skills/discern-product-voice/SKILL.md) owns how the prose sounds inside them. Pick the shape by the page's primary job. A page serving two jobs becomes two pages.

Every skeleton below shows the full frontmatter a page of that shape typically carries; drop keys the page doesn't need (the brief's frontmatter table has the rules). Word budgets count body prose; frontmatter and code fences are free.

## Overview (section `README.md`) — 200–350 words

The section's front door: what this part of the system is, why it exists, and where to read next. Ends with the curated leaf table — one line per leaf, in reading order. No mechanism detail; that belongs to the leaves.

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

## Quickstart — 600–1,000 words

Task-shaped: begin with the reader's desired outcome. State the goal and prerequisites first, then numbered steps, each with the exact command and the visible success result. End at the outcome plus one "where next" line.

```markdown
---
description: Get from A to B in N minutes.
order: 10
aliases:
  - getting started
---

# <Outcome, stated as a task>

_What you'll have at the end, in one line._

Prerequisites: the versions, accounts, or tools needed — before step 1.

## 1. <First action>

The command, fenced and copyable. What success looks like — the actual output moment the reader should see.

## 2. <Next action>

…

You now have <the outcome>. Next: [<the deeper page>](x.md).
```

## Guide / concept — 500–900 words

Explains one mechanism or workflow: what it is, how it works, when to use it, and when to choose an alternative. Subsystem leaves specialise this shape for code (the brief's per-doc template, 400–800 hard ceiling). "Where it lives in code" and "Current state & gotchas" carry every file path and known trap.

```markdown
---
description: What <the thing> does and when to reach for it.
order: 20
---

# <The thing>

_One-line summary._

What it is and the problem it solves — the answer first, then the mechanism.

## How it works

Steps or short prose. Keep file paths in the table below.

## When to use it (and when not)

One recommendation, plus the escape hatch.

## Where it lives in code

| Concept | File |
| ------- | ---- |

## Current state & gotchas

The surprises: half-built corners, known traps, and stated limitations.
```

## Reference — unbudgeted, scannable

Cover every key, flag, value, default, and limit in tables and definition lists. Use zero personality except in characterful example values. Conviction survives only as named defaults.

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

## Troubleshooting — 300–700 words

Symptom-first: headings quote what the reader is looking at, entries give the cause and one recommended fix before any alternative. Calm register, zero personality — the reader is having a bad moment.

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
