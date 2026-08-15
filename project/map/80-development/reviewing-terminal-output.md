---
title: Review terminal output
description: Capture a real Discern command at a fixed terminal size, inspect its HTML projection, and hand the rendered evidence to review.
aliases:
  - terminal capture
  - terminal screenshot
  - output preview
  - review CLI output
---

# Review terminal output

_A terminal-output change needs rendered evidence from before and after the change. The capture task runs the current checkout in a real pseudo-terminal (PTY) and writes the final screen as HTML._

## The review loop

Capture the unchanged command before editing. Give the capture a name that identifies the state:

```sh
deno task terminal:capture before-status --output .scratch/terminal-captures/before-status.html -- status
```

Make the output change, then capture the same command with the same options:

```sh
deno task terminal:capture after-status --output .scratch/terminal-captures/after-status.html -- status
```

The task prints the artifact's absolute path. Open both HTML files and inspect the rendered hierarchy, wrapping, spacing, alignment, colour, and final state. A linear text diff is supporting evidence; it does not replace looking at the HTML projection.

Attach the after-artifact's absolute path to the handoff. Include the before path when the visual comparison helps the reviewer. Do not report a visible terminal change as ready for review with only a prose description of its appearance.

The name becomes the artifact label; arguments after `--` belong to discern. Root help therefore uses an explicit flag:

```sh
deno task terminal:capture root-help -- --help
```

The default geometry is `canonical` (80 columns by 24 rows). `wide` is 120 by 24; `tall` is 80 by 40. Select another scripted geometry, the light HTML theme, a locale, or colour-off output explicitly:

```sh
deno task terminal:capture after-wide --geometry wide --theme light -- status
deno task terminal:capture after-plain --no-color --locale C -- doctor
```

Keep the before and after options identical unless the dimensions, locale, colour mode, or theme are the subject of the review.

## What the task captures

[`terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts) composes the repository's shared PTY process driver ([`pty_process.ts`](../../../tests/fixtures/pty_process.ts)) with the published `@discern-sh/design-system/cli/projection` surface. The driver sets the kernel terminal size before the command starts. It also supports readiness-gated input and named intermediate frames for interactive command capture; non-interactive command captures need neither.

The task compiles the current checkout to a temporary binary before the PTY run. This keeps Deno launcher's own startup controls out of discern's screen while ensuring the capture represents the current source rather than a frozen `dist/` build. The temporary binary is removed after the artifact is written.

Every task run overrides the caller's terminal environment with explicit facts: `TERM=xterm-256color`, a scripted geometry, static CI output, the selected locale, and the selected colour mode. The Gate may invoke the task with `CI=1`, `NO_COLOR=1`, and `TERM=dumb`; those inherited values do not change the capture. The static mode records the completed command surface rather than a history of progress-frame repaints.

The package projection validates the captured styled output and owns its conversion to typed spans and self-contained HTML. The repository does not decode Select Graphic Rendition (SGR) or Operating System Command (OSC) sequences for this workflow ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)). A carriage-return repaint left in a static capture makes the task fail.

## Flagship evidence

The reviewed fixtures under [`tests/fixtures/terminal_captures/`](../../../tests/fixtures/terminal_captures/) cover `discern status`, `discern doctor`, root `--help`, and a successful six-job `discern done` summary at 80 by 24. Each command has normalized JSON capture data and its package-projected HTML. [`flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts) creates two fresh repositories, captures both runs with one current-source binary, requires byte-identical results, validates package projection, and compares both artifact forms byte for byte.

The flagship scenario applies named normalizers at capture time. They replace only volatile scalar facts:

- absolute paths are masked only in labeled path fields and keep their captured width;
- timestamps and durations keep punctuation, units, and width while their digits become zero;
- semantic-version digits are zeroed, and doctor's operating-system and architecture value becomes one platform marker;
- Git object identifiers become zeroes of the same length.

Normalizers do not change line breaks, indentation, terminal styling, borders, or command structure. A layout defect must remain visible in the fixture diff.

When an intentional rendering change updates a flagship, regenerate all evidence, inspect each changed HTML file, then run the exact comparison test:

```sh
deno task terminal:capture-fixtures
deno task test tests/flagship_terminal_capture_test.ts
```

Do not update a fixture merely to make the test green. A failed comparison means the reviewed rendering changed; accept the new bytes only after inspecting the corresponding HTML artifact.

## Implementation map

| Concern                                                                        | Authority                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Real PTY execution, geometry, readiness-gated input, named intermediate frames | [`tests/fixtures/pty_process.ts`](../../../tests/fixtures/pty_process.ts)                               |
| Controlled command capture and package projection                              | [`tests/fixtures/terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts)     |
| One-command review artifact task                                               | [`scripts/terminal_capture.ts`](../../../scripts/terminal_capture.ts)                                   |
| Flagship scenario and scalar normalizers                                       | [`tests/fixtures/flagship_terminal_captures.ts`](../../../tests/fixtures/flagship_terminal_captures.ts) |
| Fixture regeneration                                                           | [`scripts/terminal_capture_fixtures.ts`](../../../scripts/terminal_capture_fixtures.ts)                 |
| Determinism, normalizer, projection, and exact-artifact proof                  | [`tests/flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts)           |
