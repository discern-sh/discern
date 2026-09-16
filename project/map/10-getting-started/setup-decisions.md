---
title: Setup decisions
description: Understand why setup recommends a strong model, which choices remain yours, and what the agent should handle without interrupting you.
order: 30
aliases:
  - setup choices
  - setup model
  - setup consent
---

# The decisions setup asks you to make

_Setup turns one repository study into a dependable way for future coding sessions to work. The agent handles the technical authoring; this page explains the choices that still belong to you._

## Choose the model for the repository study

discern recommends the strongest suitable reasoning model because setup creates the final quality check (the gate), separate-task rules, maintained project guide (the map), and instructions later sessions inherit. A stronger model is more likely to find hidden boundaries and preserve existing workflows.

The agent reports its current provider/model identifier, or `unreported`, as advisory context. To switch, select another model, open a fresh project session, and repeat the setup request. The current agent stops without writing. To continue here, say so plainly.

## Confirm what the project is called

Before writing the guide or instructions, setup proposes the strongest name supported by the README or project metadata; a checkout directory is a fallback. Confirm or correct it. When you have no preference, **“use your recommendation”** records your choice of the proposal.

## Know which choices remain yours

The agent handles routine, reversible branch work. It waits for missing product intent, cost, credentials, new dependencies, broader access, destructive effects, shared or durable data, future-work policies, exceptions, and landing.

Each applicable decision begins with its practical outcome, then gives a recommendation, every option's consequence, your authority, the reversal boundary, and recovery. For a safe reversible technical choice, **“use your recommendation”** records your direction. Consequential choices never use that route. An absent trigger produces no question or wait.

## Efforts land in order

Each task is checked against its own commit and lands in turn. When the shared branch moves after a task's checks pass, that task updates and proves itself again before landing; nothing is ever checked in another task's working copy.

## Inspection stays inside the project

A project file can point to another checkout, database, or machine-local path. Setup reports the source, destination, and apparent role without opening it. The agent asks before a specific outside inspection; declining leaves the destination unread.

## Give the map a useful starting shape

Setup writes a project overview and groups context into orientation, actual subsystem responsibilities, development practices, and decisions. Short topics can share a region README; separate pages serve distinct reading tasks. Numeric prefixes are optional reading order. The [map design decision](../_adr/0404-maps-explain-the-project-and-connect-its-practice.md) explains the boundary between these shipped conventions and discern’s own map.

A page can summarize implementation to explain a contract or relationship. It must help a reader make a correct change, with links to evidence, rather than catalog methods and files. Agreed requirements remain distinct from observed behavior and open questions.

Setup completes every selected page and links it from the root or its region. Structural completion checks reject empty explanations and unreachable current pages. The agent checks factual claims against evidence; these checks do not prove semantic accuracy. Setup keeps dedicated design-principles and gate-gotchas pages. Principles state agreed project rules, their reasons, and the choices they guide; a project can commit to them before implementation exists. The gotchas page starts with stack-independent recovery advice and gains project-specific lessons as failures expose missing context.

## Review what later sessions will inherit

Before landing, the handoff explains where later agents start, other areas with distinct responsibilities, one important rule, active checks, and open work. The Proof that the finished change passed the project's checks (Proof) belongs to the exact commit and grants no landing authority. You may land, leave for review, or decline.

After landing, open a fresh provider session, inspect its registered tools, and invoke the exact local action shown. A missing action routes to local recovery or `discern doctor`.

Return to the [quickstart](quickstart.md) for the shortest setup path, or follow the [walkthrough](walkthrough.md) for the branch and verification sequence.
