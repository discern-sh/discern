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

The default geometry is `canonical` (80 columns by 24 rows). `wide` is 120 by 24, `tall` is 80 by 40, and `short` is 80 by 13 for coherent single-pane states. Select another scripted geometry, the light HTML theme, a locale, or color-off output explicitly:

```sh
deno task terminal:capture after-wide --geometry wide --theme light -- status
deno task terminal:capture after-short --geometry short -- docs
deno task terminal:capture after-plain --no-color --locale C -- doctor
```

Keep the before and after options identical unless the dimensions, locale, color mode, or theme are the subject of the review.

### Capture an interactive journey

An interactive capture reads readiness-gated input phases from an ignored JSON file. Each phase waits for one marker or an ordered marker sequence before sending its steps. An optional `capture` names a frame and gives it an independent positive output condition under `when`; the phase sends input only after both its input readiness and capture readiness hold:

```json
[
  {
    "waitFor": "○ Quit",
    "capture": {
      "name": "picker",
      "when": ["discern documentation", "○ Quit"]
    },
    "steps": [{ "bytes": "\u001b[B\u001b[B\r" }]
  },
  {
    "waitFor": ["Welcome to discern.", "Press Enter to continue."],
    "capture": {
      "name": "document",
      "when": ["Welcome to discern.", "Press Enter to continue."]
    },
    "steps": [{ "bytes": "\r" }]
  },
  {
    "waitFor": ["discern documentation", "○ Quit"],
    "capture": {
      "name": "restored",
      "when": ["discern documentation", "○ Quit"]
    },
    "steps": [{ "bytes": "\u001b", "allowLoneEscape": true }]
  }
]
```

Pass the file with `--script`. With no `--keyframe`, the artifact shows the journey's final settled screen. Name one recorded frame to inspect an earlier state:

```sh
deno task terminal:capture docs-reader --script .scratch/terminal-captures/docs-reader.json --keyframe document -- docs
```

The capture condition states the complete screen the named frame will be used to judge. The task saves a named frame only once its own screen projection accepts the transcript: a pseudo-terminal delivers one repaint across several reads, and markers in a frame's last row are visible before that row's padding arrives. Use `delayMs` only when elapsed time is itself part of the interaction. Prefer an observable `waitFor` marker for ordinary input readiness. A step that intentionally sends a lone Escape byte must declare `allowLoneEscape: true`; otherwise the driver rejects a plan whose scheduling could change a multi-byte key sequence into cancellation.

## What the task captures

[`terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts) composes the repository's shared PTY process driver ([`pty_process.ts`](../../../tests/fixtures/pty_process.ts)) with the published `@discern-sh/design-system/cli/projection` surface. The thin adapter delegates generic transport to `discern-design-system/cli/interactive/testing` while retaining repository environment policy, test admission, and evidence. The package sets the kernel terminal size before the command starts. It also supports readiness-gated input and named intermediate frames for interactive command capture; non-interactive command captures need neither. Capture tasks declare the control-rendering and platform-transport contracts through the same [`real_pty.ts`](../../../tests/real_pty.ts) authority as the test canaries.

The task compiles the current checkout to a temporary binary before the PTY run. This keeps Deno launcher's own startup controls out of discern's screen while ensuring the capture represents the current source rather than a frozen `dist/` build. A `docs` capture points that binary at the checkout's current `project/map`, so it does not depend on docs bundled into an older executable. The temporary binary is removed after the artifact is written. `--config <path>` compiles it under another Deno config, such as the local package loop's linked one; the task must then run under that config too, and it refuses a mismatch. Interactive captures retain each named frame and project the last settled full-frame repaint instead of a transcript containing superseded picker frames.

Complete alternate-screen paints go through `captureTerminalFrame` from the package testing export with the observed geometry. It requires exactly one viewport of complete cell rows and rejects partial or oversized frames. This bounded protocol does not interpret arbitrary cursor movement. Existing inline consumers retain the local settled-inline path; the desk's foreground action journeys retain their specialized cursor fixture. Capture its bounded overview and task application with the package complete-frame protocol. Both paths normalize PTY line endings, while a remaining live repaint refuses the artifact.

Every task run overrides the caller's terminal environment with explicit facts: `TERM=xterm-256color`, a scripted geometry, static CI output, the selected locale, and the selected color mode. The gate may invoke the task with `CI=1`, `NO_COLOR=1`, and `TERM=dumb`; those inherited values do not change the capture. The static mode records the completed command surface rather than a history of progress-frame repaints.

The package projection validates the captured styled output and owns its conversion to typed spans and self-contained HTML. The repository does not decode Select Graphic Rendition (SGR) or Operating System Command (OSC) sequences for this workflow ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)). A carriage-return repaint left in a static capture makes the task fail.

## Application fixture matrix

The [application fixture](terminal-applications.md) uses complete package paints. Capture its choices and reading regions at the requested wide, tall, canonical, and below-minimum sizes, with color and ASCII variants:

```sh
discern queue -- deno run -A scripts/terminal_application_capture.ts
```

The script prints HTML paths under `.scratch/terminal-application/` and retains raw transcripts, bounded frames, and geometry inspections alongside them. It observes complete frames before Tab or Escape and validates the chosen color mode. The canonical color journey also records foreground-child input and the restored application frame. Its optional output directory and child Deno config arguments support development against an explicitly linked package worktree; the script must run under that same config, because the fixture refuses a child that loads a different package build. Such captures verify local source; the published-consumer gate still requires the immutable package pin.

Inspect each generated frame in the browser using the review procedure above. The native tests separately verify resizing, pending-read release, foreground child input, and application return.

## Desk gallery

Run the production desk against disposable fixture repositories and retain named complete frames:

```sh
discern queue -- deno run -A scripts/desk_capture.ts
```

The optional first argument names the output directory. To review an unreleased package change, run the gallery through the [local package loop](terminal-applications.md#develop-against-a-local-package), which passes its linked config to the script with `--config` and runs the script under it:

```sh
deno task cli:design-system capture .scratch/desk-local
```

The [capture script](../../../scripts/desk_capture.ts) captures every frame of the desk design's frame index that the product can render, from the [sandbox fleet](#desk-sandbox) with Claude Code and Codex on its `PATH`:

- the inbox at 120 by 30, 80 by 24, 60 by 20, 80 by 13 and 32 by 10, without color or Unicode at 40 by 20, below the minimum at 30 by 9, empty, offline after two failed surveys, after an agent returns with changed files, zoomed, and with Parked unfolded on a light terminal;
- home, on the Commands row, once the session's tip has reached its panel (`deskHomeWithTip`) at 120 by 30, 80 by 24, empty, and on a light terminal; zoomed; with the palette its Enter opens; and while a release check is due, at both sizes and with that palette starting on Check for updates…, the `release-due` journey writing an old release record and restoring it afterwards;
- one frame per row state the brief names: stale, checks failed with the failure its run's journal retained, setup stopped, checks running and queued;
- the actions menu at both widths, the wide one showing an unavailable action's reason, the palette and the keys reader;
- every review sheet and form: Land direct and integrating, with its plan open, on a short screen, and with confirm focused on a light terminal; Drop with its challenge half typed at 80 and at 40 columns; New task; Check for updates; and the agent picker;
- a landing's progress, the message once it and the queued task it walks have landed, a partial landing's result sheet, and a refused landing whose task reads Didn't land on the next survey;
- the manual inside the desk at 80 by 24 and 120 by 30: its contents, a guide open, its search, and the inbox it returns to.

The refused landing scripts only acceptance's refusal and the trace a real refusal leaves in the logbook; its survey and review are real. The `landing` and `landing-partial` journeys land for real, each on its own fleet: `landing` captures a landing's progress while a repository ensure step builds, and `landing-partial` leaves the agent files uncommitted, so the queue walk refuses the second task. `--only <journeys>` captures a subset. Every phase waits on the package's state reports (the open layer, the focused control, the selected row), never on prose. Its HTML index links separate terminal viewports, each with a JSON file holding the frame's text and state report. Render and inspect each relevant HTML frame before judging a change; these artifacts are review evidence, not fixed screenshot expectations. The [Desk PTY fixture](../../../tests/fixtures/desk_tty_harness.ts) retains raw named paints for the package capture helper and its specialized cursor accounting for inline foreground journeys. A named desk frame waits until no complete-viewport repaint is still arriving, and the script refuses a journey whose frames differ from the ones it declared, so the gallery never drops or truncates a frame. [`settled_keyframe_test.ts`](../../../tests/settled_keyframe_test.ts) sweeps every byte prefix of a repaint through each named-frame readiness condition that feeds a strict projection.

### Desk sandbox

For hands-on review, build a persistent project seeded with one task per desk state:

```sh
deno run -A scripts/desk_sandbox.ts .scratch/desk-sandbox
deno task cli:design-system desk --project .scratch/desk-sandbox/project
```

The [sandbox script](../../../scripts/desk_sandbox.ts) builds its fleet with the desk PTY fixture's keep mode. Real Git and engine state carry every fact: commits behind main, backdated activity, a running and a failed check in the logbook, uncommitted files, incomplete setup, a queued pre-authorized task proven by the real gate, and three parked branches closed by Park. The script prints the facts it only approximates, such as Proof age. `--replace` rebuilds a directory the script created and refuses any other. Open the sandbox with this checkout's source, as the script prints, or through the local package loop as above. The fixture's `createDeskTtyProject` gives galleries and tests the same fleets without the sandbox's persistence.

## Flagship evidence

The reviewed fixtures under [`tests/fixtures/terminal_captures/`](../../../tests/fixtures/terminal_captures/) cover `discern status`, `discern doctor`, root `--help`, and a successful six-job `discern done` summary at 80 by 24. Each command has normalized JSON capture data and its package-projected HTML. [`flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts) captures each command once with one current-source binary, validates package projection, and compares both artifact forms byte for byte. Deterministic serialization and projection tests exercise repeatability without opening a second pseudo-terminal.

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

| Concern                                                                        | Authority                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Real PTY execution, geometry, readiness-gated input, named intermediate frames | [`tests/fixtures/pty_process.ts`](../../../tests/fixtures/pty_process.ts)                                                  |
| Controlled command capture and package projection                              | [`tests/fixtures/terminal_command_capture.ts`](../../../tests/fixtures/terminal_command_capture.ts)                        |
| One-command review artifact task                                               | [`scripts/terminal_capture.ts`](../../../scripts/terminal_capture.ts)                                                      |
| Local-only browser review server                                               | [`scripts/terminal_review.ts`](../../../scripts/terminal_review.ts)                                                        |
| Flagship scenario and scalar normalizers                                       | [`tests/fixtures/flagship_terminal_captures.ts`](../../../tests/fixtures/flagship_terminal_captures.ts)                    |
| Fixture regeneration                                                           | [`scripts/terminal_capture_fixtures.ts`](../../../scripts/terminal_capture_fixtures.ts)                                    |
| Normalizer, real-transport, projection, and exact-artifact proof               | [`tests/flagship_terminal_capture_test.ts`](../../../tests/flagship_terminal_capture_test.ts)                              |
| Real-PTY contract declarations and future-consumer enrollment                  | [`tests/real_pty.ts`](../../../tests/real_pty.ts), [`tests/real_pty_guard_test.ts`](../../../tests/real_pty_guard_test.ts) |
