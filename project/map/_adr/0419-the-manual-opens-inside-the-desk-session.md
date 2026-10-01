# ADR 0419: The manual opens inside the Desk session

**Status**: accepted; amends [ADR 0417](0417-desk-owned-effects-run-in-session.md) (which controls keep the terminal) and [ADR 0290](0290-discern-owns-the-default-interactive-markdown-reading-loop.md) (where the browser's page effects run)

## Context

The Desk's **Read the manual** handed the terminal to `discern docs` as a foreground child. The Desk released its screen, the docs command opened its own browser with its own frame and keys, and quitting it repainted the Desk with a "Back from the manual" message. The owner moved between two applications that looked and answered differently, and the inbox they came from flashed away and back.

The design system rebuilt its Markdown browser on the same application runtime the Desk runs on, and that runtime can now run one application nested inside another on the same screen, with the one beneath kept exactly as it was.

## Decision

**The manual is a nested application.** Read the manual returns the package browser over the bundled manual as a nested command. It opens in place of the inbox and closes back to it with the inbox's selection, open layers and scroll unchanged. Escape at the contents, `q`, or the **Back to the desk** entry closes it; a Ctrl+C closes it and reaches the Desk as Ctrl+C, so it quits or asks first exactly as on the inbox.

**The session reads the manual once, as it starts.** An action must return its command synchronously, so the Desk reads the manual beside its other start-up reads and the command paints at once. Until the read lands, or when it fails, choosing it leaves a message and opens nothing. `discern docs` and the Desk read the corpus through one loader, [`readDocsBrowser`](../../../src/commands/docs.ts), and build the same browser request.

**Pages open while the screen stays.** Inside the Desk, **Read the docs online** and a followed web link open the system browser through a package background command; one policy, `openDocsBrowserChoice`, decides what may open for both hosts, and a refusal or a browser that can't open shows inside the manual. Standalone `discern docs` still restores the terminal before it opens a page, because a standalone browser request returns what its reader chose.

**The reader's place lasts the session.** Each opening resumes where the reader last left the manual. While the manual is open the Desk's surveys, running-time ticks and evidence reads wait as they do for a foreground child, and resume when it closes; operations beside the screen keep running.

## Consequences

- `discern docs` and the Desk's manual share one frame, one key map, and one search.
- Reading the manual changes nothing, so it leaves no line in Session activity or in the list the terminal keeps at exit.
- Every Desk session reads the manual's pages once, whether or not the owner opens it.
- The browser names the bundled manual without its install location, which said nothing to its reader and crowded out the open document's title.

## Alternatives considered

- **Keep the foreground child.** Rejected: two frames and two key maps for one product, and a screen flash on every visit.
- **Show the manual as a Desk reader layer.** Rejected: the browser's own keys (`/`, `c`, `q`, Escape as Back) would compete with the Desk's key map, and the package keeps a nested application's keys its own for as long as it is in front.
- **Read the manual only when chosen.** Rejected: the read finishes after the action has returned, so the owner would have to choose the manual a second time.
