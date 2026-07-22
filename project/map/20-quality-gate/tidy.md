---
title: Format discern-owned surfaces
description: Run discern tidy directly or from the format job to keep the map, guidance, TODO, and root config canonical.
order: 90
aliases:
  - discern tidy
  - tidy
  - markdown formatter
  - toml formatter
  - format discern files
---

# `discern tidy`: format discern-owned surfaces

_One offline formatter for the files whose conventions discern defines._

Fresh installations put bare `discern tidy` in the [format job](../00-orientation/glossary.md#gate-job). The project declares that formatter in its jobs table, so the gate runs it as an ordinary fix-stage command. A project can remove the command to opt out.

## What it formats

| Type     | Included                                                                                                  | Left alone                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Markdown | Every `.md` file under `[map].dir`, the `[project].todo` file, and files matched by `[guidance].sources`. | The project brief, authored skills, generated agent files, and Markdown outside those configured sources. |
| TOML     | The root `discern.toml`.                                                                                  | Every other TOML file, including files owned by the project's stack or a coding-agent provider.           |

Markdown prose is stored unwrapped, with two-space indentation, spaces rather than tabs, and LF line endings. Fenced code stays byte-for-byte unchanged. TOML uses the same indentation and line-ending convention while preserving comments. The plugins and their formatter host are pinned and embedded in the binary, so formatting makes no network call and needs no project runtime.

## Run it directly

| Command                  | Effect                                               |
| ------------------------ | ---------------------------------------------------- |
| `discern tidy`           | Format both Markdown and TOML targets.               |
| `discern tidy md`        | Format only the configured Markdown targets.         |
| `discern tidy toml`      | Format only the root config.                         |
| `discern tidy --dry-run` | List every file that would change and write nothing. |

The planner reads and formats every selected target before the first write. If a selected file cannot be parsed, the run fails and leaves all files unchanged. A configured path that does not exist is a successful no-op. A normal run writes only files whose content changes; a second run is a no-op.

## Keep a project formatter first

`discern tidy` does not format source code or detect a project's stack. When the project already has a formatter, run that command first and keep discern's formatter last:

```toml
[jobs]
format = ["<the project's formatter>", "discern tidy"]
```

This order lets the project tool own its files and gives `discern tidy` the final word only on discern-owned surfaces. `discern prepare` and `discern done` then run both commands as the ordinary serial fix stage.

During setup, `discern doctor` fails if the setup agent dropped every form of `discern tidy` from the format job. After setup is recorded, the same absence is an informational opt-out and never a warning.

An existing installation can opt in by adding the command to its format job. `discern upgrade`, `discern config`, setup, presets, skill ejection, and `standards --pin` already write `discern.toml` in the same canonical form, whether or not the gate invokes `discern tidy`.
