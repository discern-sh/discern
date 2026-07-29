---
title: Format discern-owned surfaces
description: Run discern tidy directly or from the format job to keep the map, guidance, TODO, and root config canonical.
order: 100
aliases:
  - discern tidy
  - tidy
  - markdown formatter
  - toml formatter
  - format discern files
---

# `discern tidy`: format discern-owned surfaces

_One offline formatter for the files whose conventions discern defines._

Fresh installations put bare `discern tidy` in the [format job](../00-orientation/glossary.md#gate-job). The project declares that formatter in its jobs table, so the gate runs it as an ordinary fix-stage command. A project can remove the command to opt out. The gate resolves `discern` in a job command to the engine running that gate, so this self-invocation works even where the surrounding environment has no discern on `PATH`.

## What it formats

| Type     | Included                                                                                                  | Left alone                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Markdown | Every `.md` file under `[map].dir`, the `[project].todo` file, and files matched by `[guidance].sources`. | The project brief, authored skills, generated agent files, and Markdown outside those configured sources. |
| TOML     | The root `discern.toml`.                                                                                  | Every other TOML file, including files owned by the project's stack or a coding-agent provider.           |

Markdown prose is stored unwrapped, with two-space indentation, spaces rather than tabs, and LF line endings. Fenced code stays byte-for-byte unchanged, though a fenced box-drawing diagram must stay column-aligned: a misaligned glyph fails the run under `diagrams_misaligned` with its file, line, and column, and a fence tagged `freeform` is exempt. TOML preserves comments and is stored depth-indented — headers one two-space step per dotted level, entries one step deeper, comments level with what they document — so the config reads as its hierarchy; nesting still comes from the dotted names. The plugins and their formatter host are pinned and embedded in the binary, so formatting makes no network call and needs no project runtime.

## Run it directly

| Command                  | Effect                                               |
| ------------------------ | ---------------------------------------------------- |
| `discern tidy`           | Format both Markdown and TOML targets.               |
| `discern tidy md`        | Format only the configured Markdown targets.         |
| `discern tidy toml`      | Format only the root config.                         |
| `discern tidy --dry-run` | List every file that would change and write nothing. |

The planner reads and formats every target before the first write; a file that cannot be parsed fails the run, leaving all files unchanged. A missing configured path is a successful no-op, and a run rewrites only changed files — a second run is a no-op.

## Keep a project formatter first

`discern tidy` does not format source code or detect a project's stack. When the project already has a formatter, run that command first and keep discern's formatter last:

```toml
[jobs]
  format = ["<the project's formatter>", "discern tidy"]
```

This order lets the project tool own its files, with `discern tidy` taking the final word on discern-owned surfaces; `discern prepare` and `discern done` run both as one serial fix stage.

Seeded alone, the format job is housekeeping, not quality coverage: `setup done` and `discern doctor` report `minimal` until a project check joins it ([ADR 0220](../_adr/0220-self-supplied-commands-count-for-nothing-in-assurance.md)). During setup, doctor fails when every form of `discern tidy` leaves the format job; afterwards it is an informational opt-out.

An existing installation can opt in by adding the command to its format job; every config writer (`discern upgrade`, `discern config`, setup, presets, skill ejection, `standards --pin`) already emits the same canonical form.
