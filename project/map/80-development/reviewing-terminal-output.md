---
title: Review terminal output
description: Capture a real discern command at a fixed terminal size, inspect its visual browser rendering, and hand the rendered evidence to review.
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

The task prints the artifact's absolute path. Open the before and after HTML artifacts in a browser and inspect the rendered hierarchy, wrapping, spacing, alignment, color, clipping, and final state.

### Rendered inspection is required

A coding-agent session must obtain visual browser evidence: a screenshot or another browser-rendered image. Reading the HTML source, extracting its text, or inspecting a Document Object Model (DOM) snapshot does not satisfy the review. Those forms can verify content and structure; they cannot show the spatial composition a person sees.

A human can inspect the open browser page directly. When the handoff surface supports images, include the screenshot alongside the HTML artifact path. State what the visual inspection found rather than claiming the file was viewed.

A cropped, blank, or unexpectedly scaled browser image is invalid evidence. Reload the page or open the review URL in a fresh browser tab and capture it again before judging the terminal output. Judge the terminal surface itself; any surrounding browser canvas is outside the command capture.

Some browser policies refuse `file://` navigation. Serve one artifact through a local-only HTTP address when direct local-file access is unavailable:

```sh
deno task terminal:review .scratch/terminal-captures/after-status.html
```

The task binds an ephemeral `127.0.0.1` port, prints its `http://127.0.0.1:<port>/` review URL, and serves only the named artifact. It does not expose the artifact's directory. Keep the task running while the browser reads the page, then stop it with Ctrl+C. Restart the task after replacing the artifact because each run holds the bytes it loaded.

A linear text diff remains supporting evidence. It does not replace the rendered inspection.

Attach the after-artifact's absolute path to the handoff. Include the before path when the visual comparison helps the reviewer. Do not report a visible terminal change as ready for review with only a prose description of its appearance.

The name becomes the artifact label; arguments after `--` belong to discern. Root help therefore uses an explicit flag:

```sh
deno task terminal:capture root-help -- --help
```

The default geometry is `canonical` (80 columns by 24 rows). `wide` is 120 by 24; `tall` is 80 by 40. Select another scripted geometry, the light HTML theme, a locale, or color-off output explicitly:

```sh
deno task terminal:capture after-wide --geometry wide --theme light -- status
deno task terminal:capture after-plain --no-color --locale C -- doctor
```

Keep the before and after options identical unless the dimensions, locale, color mode, or theme are the subject of the review.

### Capture an interactive journey

An interactive capture reads readiness-gated input phases from an ignored JSON file. Each phase waits for one marker or an ordered marker sequence before sending its steps. An optional `captureAs` records the settled screen after those markers appear and before the phase sends input:

```json
[
  {
    "waitFor": "○ Quit",
    "captureAs": "picker",
    "steps": [{ "bytes": "\u001b[B\u001b[B\r" }]
  },
  {
    "waitFor": ["Welcome to discern.", "Press Enter to continue."],
    "captureAs": "document",
    "steps": [{ "bytes": "\r" }]
  },
  {
    "waitFor": ["discern documentation", "○ Quit"],
    "captureAs": "restored",
    "steps": [{ "bytes": "\u001b", "allowLoneEscape": true }]
  }
]
```

Pass the file with `--script`. With no `--keyframe`, the artifact shows the journey's final settled screen. Name one recorded frame to inspect an earlier state:

```sh
deno task terminal:capture docs-reader --script .scratch/terminal-captures/docs-reader.json --keyframe document -- docs
```

Use `delayMs` only when elapsed time is itself part of the interaction. Prefer an observable `waitFor` marker for ordinary readiness. A step that intentionally sends a lone Escape byte must declare `allowLoneEscape: true`; otherwise the driver rejects a plan whose scheduling could change a multi-byte key sequence into cancellation.

## What the task captures

[`terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts) composes the repository's shared PTY process driver ([`pty_process.ts`](../../../tests/fixtures/pty_process.ts)) with the published `@discern-sh/design-system/cli/projection` surface. The driver sets the kernel terminal size before the command starts. It also supports readiness-gated input and named intermediate frames for interactive command capture; non-interactive command captures need neither.

The task compiles the current checkout to a temporary binary before the PTY run. This keeps Deno launcher's own startup controls out of discern's screen while ensuring the capture represents the current source rather than a frozen `dist/` build. The temporary binary is removed after the artifact is written. Interactive captures retain named keyframes and project the last settled full-frame repaint instead of a transcript containing superseded picker frames.

Every task run overrides the caller's terminal environment with explicit facts: `TERM=xterm-256color`, a scripted geometry, static CI output, the selected locale, and the selected color mode. The Gate may invoke the task with `CI=1`, `NO_COLOR=1`, and `TERM=dumb`; those inherited values do not change the capture. The static mode records the completed command surface rather than a history of progress-frame repaints.

The package projection validates the captured styled output and owns its conversion to typed spans and self-contained HTML. The repository does not decode Select Graphic Rendition (SGR) or Operating System Command (OSC) sequences for this workflow ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)). A carriage-return repaint left in a static capture makes the task fail.

## Flagship evidence

The reviewed fixtures under [`tests/fixtures/terminal_captures/`](../../../tests/fixtures/terminal_captures/) cover `discern status`, `discern doctor`, root `--help`, and a successful six-job `discern done` summary at 80 by 24. Each command has normalized JSON capture data and its package-projected HTML. [`flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts) creates two fresh repositories, captures both runs with one current-source binary, requires byte-identical results, validates package projection, and compares both artifact forms byte for byte.

The flagship scenario applies named normalizers at capture time. They replace only volatile scalar facts:

- absolute paths are masked only in labeled path fields and keep their captured width;
- timestamps and durations keep punctuation, units, and width while their digits become zero;
- semantic-version digits are zeroed, and doctor's operating-system and architecture value becomes one platform marker;
- Git object identifiers become zeroes of the same length.

Normalizers do not change line breaks, indentation, terminal styling, borders, or command structure. A layout defect must remain visible in the fixture diff.

When an intentional rendering change updates a flagship, regenerate all evidence, inspect each changed HTML file as a rendered browser page, then run the exact comparison test:

```sh
deno task terminal:capture-fixtures
deno task test tests/flagship_terminal_capture_test.ts
```

Do not update a fixture merely to make the test green. A failed comparison means the reviewed rendering changed; accept the new bytes only after inspecting the corresponding HTML artifact in a browser.

## Implementation map

| Concern                                                                        | Authority                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Real PTY execution, geometry, readiness-gated input, named intermediate frames | [`tests/fixtures/pty_process.ts`](../../../tests/fixtures/pty_process.ts)                               |
| Controlled command capture and package projection                              | [`tests/fixtures/terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts)     |
| One-command review artifact task                                               | [`scripts/terminal_capture.ts`](../../../scripts/terminal_capture.ts)                                   |
| Local-only browser review server                                               | [`scripts/terminal_review.ts`](../../../scripts/terminal_review.ts)                                     |
| Flagship scenario and scalar normalizers                                       | [`tests/fixtures/flagship_terminal_captures.ts`](../../../tests/fixtures/flagship_terminal_captures.ts) |
| Fixture regeneration                                                           | [`scripts/terminal_capture_fixtures.ts`](../../../scripts/terminal_capture_fixtures.ts)                 |
| Determinism, normalizer, projection, and exact-artifact proof                  | [`tests/flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts)           |
