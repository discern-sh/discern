# ADR 0290: Discern owns the default interactive Markdown reading loop

> **Amendments.**
>
> - **Dependency releases:** Discern now consumes later immutable design-system packages; `deno.json` holds the live pin. The composite browser contract this record introduced remains in force — the newer releases' terminal repertoire and motif defaults, public alternate-screen runtime option, and revised frame presentation do not move ownership of the default reading loop.

**Status**: accepted; extends [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md) and [ADR 0287](0287-terminal-markdown-delegates-to-the-design-system.md)

## Context

`discern docs` and `discern map` historically opened rendered Markdown in `$PAGER` whenever a terminal was available. The first internal-reader option inverted that behavior through a negative pager flag, but an internally rendered picker selection then ended the command. A configured pager could therefore bypass Discern's reading treatment by default, while choosing the internal treatment prevented continued browsing.

The documentation picker also led with paths inside one long Documents group. The discovered tree already owns reading order, section front doors, document titles, and admitted paths, so a second navigation taxonomy would create drift. Machine and static projections have a separate constraint: raw bodies, exports, results, JSON, authored Markdown results, and Model Context Protocol payloads must not acquire paging, terminal input, or human decoration.

`@discern-sh/design-system` 0.20.0 publishes the reusable missing contracts: secondary choice and group descriptions, search across both fields, browsing presentation, successful-frame cleanup, compact acknowledgement, and an adaptive composite Markdown browser. The sequential reader remains a useful capability fallback, but the complete browser can now become the normal human path without creating local terminal machinery.

## Decision

Interactive browsing renders Markdown inside Discern by default. `--pager` is the explicit opt-in to `$PAGER`, with `less -R` as the fallback command. Exiting a successful pager returns to the picker. If a pager cannot start or exits unsuccessfully, Discern warns, renders internally, and preserves the same continuation or direct-target disposition.

A direct rendered target prints internally and exits by default; with `--pager`, it pages and exits. Plain, non-terminal, and continuous-integration rendered targets print and exit. Raw, list, search-result, export, JSON, authored Markdown-result, and Model Context Protocol surfaces keep their existing contracts. `--pager` on a static or machine surface refuses the incompatible combination and names removal of the flag as the recovery.

The shared `docs` and `map` browser projects navigation from the canonical discovered entries. Browse appears first when the verb has a browsing action. Root documents sit in Overview. Each section group uses its front-door document title and top-level directory description; each choice leads with its heading title and follows with its filename or section-relative nested path. Both fields participate in package-owned search. Actions appears last, and typed discriminants keep product actions distinct from document paths. Stable choice identities preserve the remembered document after reordering and filtering.

Bare interactive browsing uses the package's complete Markdown browser. With no open document, the grouped picker fills the available reader viewport. Opening a document keeps an adaptive picker above a Markdown pane with its own scroll position when the terminal has room; smaller supported terminals use coherent picker-only and document-only states. Query text, highlighted entry, open document, pane focus, link focus, and scroll offsets remain package-owned resumable state. Keyboard input is complete on its own. Mouse tracking adds pane focus, wheel scrolling, and link activation without adding mouse-only actions.

Discern builds the rich browser and sequential reader from one projection of the admitted documentation tree. It eagerly supplies only admitted document sources after applying the existing terminal-body policy. A pure product resolver can navigate only to normalized paths in that in-memory tree; same-document fragments and admitted relative or root paths stay inside the browser. Missing, unsafe, unsupported, private, source-code, and root-escaping destinations remain unresolved. Absolute HTTP and HTTPS destinations become external actions.

The package restores raw mode, mouse tracking, cursor visibility, resize listeners, and the normal screen before it returns a product action, external link, exit, or failure. Discern performs browser-opening effects only after that restoration, then resumes the opaque package state. A typed control-capability or minimum-geometry refusal selects the sequential flow: the package clears the picker, Discern renders the selected document, and the package presents `Press Enter to continue.` before restoring the remembered selection. An arbitrary rendering or runtime defect is reported and does not trigger a second interaction attempt. A direct target never enters either browse loop.

Discern pins the immutable 0.20.0 package and keeps every terminal effect behind its existing process and interaction adapters. `--pager` bypasses the composite browser and retains the same picker-return loop. The package browser is the sole pane, input-decoding, mouse, hit-testing, rendering, and restoration authority; Discern owns document admission, actions, pager processes, link resolution, and operating-system effects.

## Consequences

- A configured `PAGER` has no effect unless the person supplies `--pager`; the Discern reading experience is the interactive default.
- A person can keep the picker and document visible together, scroll them independently, follow admitted links, and return to the same search and selection. Short supported terminals use one pane at a time.
- Titles and section meaning lead the picker while paths remain visible for identity and search.
- Static and machine consumers retain their existing bytes and do not wait for input. Invalid paging combinations fail instead of silently ignoring the request.
- The sequential reader remains available only when the package returns a typed capability refusal. It intentionally leaves the rendered document in the terminal's saved output and waits for Enter.
- Operating-system browser effects never run while the alternate screen, raw input, hidden cursor, mouse tracking, or resize observation remains active.
- Replacing the short-lived negative pager contract before launch is intentionally incompatible; no hidden alias preserves the inverted default.

## Alternatives considered

**Keep external paging as the default.** Rejected because local pager configuration would continue to bypass the product's reading experience and make behavior vary between machines.

**Render internally and end the browse command.** Rejected because reading one document would discard the active query and selection, turning exploration into repeated command launches.

**Implement panes, scrolling, link focus, or mouse input inside Discern.** Rejected because the package already owns those generic terminal behaviors and their cleanup. A product-local implementation would create a second terminal authority.

**Read keys or clear frames directly in the command.** Rejected because it would duplicate package-owned input, cleanup, and terminal restoration behind a second effect boundary.
