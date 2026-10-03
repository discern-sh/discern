---
title: Desk tips
description: A deterministic teaching line per Desk session, including what it shows, how it is chosen, and where its record lands.
order: 110
aliases:
  - desk tips
  - tip line
---

# Desk tips

_Each desk session carries one quiet teaching tip beside its commands._

The desk selects one tip when a session opens and keeps it stable until exit ([ADR 0234](../_adr/0234-tips-are-the-desks-human-advisory-channel.md), [ADR 0420](../_adr/0420-the-desk-is-an-inbox-with-a-following-inspector-and-modal-layers.md#amendment-the-commands-row-leads-the-inbox)). Once the first survey lands, its brief shows in the home panel beside the Commands row the desk opens on. It follows the Help section, before Go to, and stays there for the session. A tip an upgrade brought says which release it is new in. That place keeps the tip on the first screen at 80 by 24 with a full fleet, which a [home test](../../../tests/engine_desk_home_test.ts) holds. The brief keeps its lines together, so where the panel runs out of room first, as with no tasks in a terminal that draws the panel's divider instead of its color, the tip moves whole below the fold rather than stopping mid-sentence. The panel wraps the brief whole at every width, and the message line stays free for what happens. **Tip of the session** in the command palette's Help section opens its full text.

The desk records a tip as shown when it selects it, before anything paints. Below 80 columns the panel is a strip until Space zooms it. With details hidden, the panel shows only until there is a task. In those layouts the desk can record a tip, an upgrade's **New in** tip included, that the owner never read. **Tip of the session** still opens it for the rest of the session. Narrow fitting and redraws do not select or record another tip.

## How the tip is chosen

Selection is deterministic: identical state shows the identical tip, and nothing is random. The desk evaluates the registry against the fleet survey it already ran and picks the first match in this order:

1. Tips new since the seen-state's baseline version, in authored order. These carry a "New in \<version\>" prefix; a fresh install starts at the current version.
2. Unseen tips whose context currently applies. A relevance predicate reads the survey — "no standards configured", "a branch is behind the trunk" — and makes a tip timely.
3. Unseen tips in authored order. The authored order is the curriculum.
4. The tip shown longest ago. No tip repeats until the applicable pool exhausts.

A tip whose predicate does not hold is not applicable, rotation included.

## Where the state and the record live

Seen-state lives at `<git-common-dir>/discern/desk/tips.json`, beside the logbook. Every linked worktree shares the rotation, nothing lands in a commit, and a missing or damaged file resets to fresh instead of blocking the session. Each shown tip's id is also recorded on the desk session's logbook event, so a later reader can measure whether the teaching was acted on.

## What a tip may say

Tips educate about capability; alarms about state belong to the task's visible status and `discern status`. Every action remains available without its tip. A tip that names a desk control quotes its registered label from the [desk vocabulary](../../../src/shared/desk_vocabulary.ts), so a relabel reaches the tips; the [label guard](../../../tests/engine_desk_label_guard_test.ts) refuses a typed copy and any quoted name that is not a control. A tip names a key through `deskKey`, so it reads as the footer on the same screen does (`^K`, `↑↓`, `Esc`), with the footer's ASCII form; the [register guard](../../../tests/tip_register_guard_test.ts) refuses a typed key name and a brief longer than its budget, and a [tips test](../../../tests/engine_desk_tips_test.ts) holds each key to the design system's formatting and to a key the inbox binds. The register addresses a beginner: command names stay in code spans, and each concept receives a plain-language introduction. The curriculum opener teaches the inbox: groups by next decision, `↵` for the next step, `.` for every action, and `^K` for any command. The desk lessons after the basics teach the actions menu with its unavailable reasons, the palette's search, Space to zoom the details, **Parked branches** with **Resume…** (only while a branch is kept without a checkout), and the opt-in mouse.

## Where it lives in code

[`src/shared/tips.ts`](../../../src/shared/tips.ts) is the ordered registry; [`tips.ts`](../../../src/engine/desk/tips.ts) owns selection, [`tip_state.ts`](../../../src/engine/desk/tip_state.ts) owns storage, and [`home_view.ts`](../../../src/engine/desk/home_view.ts) places the tip in the home panel. [Registry tests](../../../tests/engine_desk_tips_test.ts), [session tests](../../../tests/engine_desk_runtime_test.ts) and [home tests](../../../tests/engine_desk_home_test.ts) cover the boundary.

## Current state and gotchas

- The registry ships the complete curriculum. Its generated internal inventory shows every rendered line and every feature or verb kept out of the rotation.
- Shown ids are recorded from day one, ahead of any reader that consumes them.
- The generated tip inventory is an internal audit page, regenerated by `deno task codegen`.
