---
title: Format discern-owned surfaces
description: Run discern tidy directly or from the format job to keep the Map, instructions, TODO, and root config canonical.
order: 110
aliases:
  - discern tidy
  - tidy
  - markdown formatter
  - toml formatter
  - format discern files
---

# `discern tidy`: format discern-owned surfaces

_An offline formatter for the files whose conventions discern defines._

Fresh installations put bare `discern tidy` in the [format job](../00-orientation/glossary.md#gate-job). The project declares that formatter in its jobs table, so the Gate runs it as an ordinary fix-stage command. The Gate resolves `discern` in a job command to the engine running that Gate, so this self-invocation works even where the surrounding environment has no discern on `PATH`.

## What it formats

| Type     | Included                                                                                                      | Left alone                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Markdown | Every `.md` file under `[map].dir`, the `[project].todo` file, and files matched by `[instructions].sources`. | The project brief, authored Skills, generated agent files, and Markdown outside those configured sources. |
| TOML     | The root `discern.toml`.                                                                                      | Every other TOML file, including files owned by the project's stack or a coding-agent provider.           |

Markdown prose is stored unwrapped, with two-space indentation, spaces rather than tabs, and LF line endings. Fenced code stays byte-for-byte unchanged, though a fenced box-drawing diagram must stay column-aligned. A misaligned glyph fails the run under `diagrams_misaligned` with its file, line, and column, while a fence tagged `freeform` is exempt. TOML preserves comments and uses indentation to show depth: headers sit one two-space step per dotted level, entries one step deeper, and comments align with what they document. The plugins and their formatter host are pinned and embedded in the binary, so formatting makes no network call and needs no project runtime.

## Run it directly

| Command                  | Effect                                               |
| ------------------------ | ---------------------------------------------------- |
| `discern tidy`           | Format both Markdown and TOML targets.               |
| `discern tidy md`        | Format only the configured Markdown targets.         |
| `discern tidy toml`      | Format only the root config.                         |
| `discern tidy --dry-run` | List every file that would change and write nothing. |

The planner reads and formats every target before the first write. A file that cannot be parsed fails the run, leaving all files unchanged. A missing configured path is a successful no-op, and a run rewrites only changed files. A second run is a no-op.

## Keep a project formatter first

`discern tidy` does not format source code or detect a project's stack. When the project already has a formatter, run that command first and keep discern's formatter last:

```sh
discern config set-job format \
  --run "<the project's formatter>" \
  --run "discern tidy"
```

The commands remain literal and run in that order as one serial fix stage ([ADR 0317](../_adr/0317-gate-commands-and-setup-applicability-are-separate-facts.md)).

Seeded alone, the format job provides housekeeping. `setup done` and `discern doctor` report `minimal` assurance until a project check joins it ([ADR 0220](../_adr/0220-self-supplied-commands-count-for-nothing-in-assurance.md)). During setup, doctor fails when every form of `discern tidy` leaves the format job; afterward it is an informational opt-out.

`discern config set-job format` is the existing-installation path. Every config writer (`discern upgrade`, `discern config`, setup, presets, skill ejection, `standards --pin`) emits the canonical form.
