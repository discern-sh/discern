# ADR 0290: Discern owns the default interactive Markdown reading loop

**Status**: accepted; extends [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md) and [ADR 0287](0287-terminal-markdown-delegates-to-the-design-system.md)

## Context

`discern docs` and `discern map` historically opened rendered Markdown in `$PAGER` whenever a terminal was available. The first internal-reader option inverted that behavior through a negative pager flag, but an internally rendered picker selection then ended the command. A configured pager could therefore bypass Discern's reading treatment by default, while choosing the internal treatment prevented continued browsing.

The documentation picker also led with paths inside one long Documents group. The discovered tree already owns reading order, section front doors, document titles, and admitted paths, so a second navigation taxonomy would create drift. Machine and static projections have a separate constraint: raw bodies, exports, results, JSON, authored Markdown results, and Model Context Protocol payloads must not acquire paging, terminal input, or human decoration.

`@discern-sh/design-system` 0.20.0 publishes the reusable missing contracts: secondary choice and group descriptions, search across both fields, browsing presentation, successful-frame cleanup, compact acknowledgement, and an adaptive composite Markdown browser. Discern can adopt the permanent sequential fallback before integrating the richer browser without creating local terminal machinery.

## Decision

Interactive browsing renders Markdown inside Discern by default. `--pager` is the explicit opt-in to `$PAGER`, with `less -R` as the fallback command. Exiting a successful pager returns to the picker. If a pager cannot start or exits unsuccessfully, Discern warns, renders internally, and preserves the same continuation or direct-target disposition.

A direct rendered target prints internally and exits by default; with `--pager`, it pages and exits. Plain, non-terminal, and continuous-integration rendered targets print and exit. Raw, list, search-result, export, JSON, authored Markdown-result, and Model Context Protocol surfaces keep their existing contracts. `--pager` on a static or machine surface refuses the incompatible combination and names removal of the flag as the recovery.

The shared `docs` and `map` browser projects navigation from the canonical discovered entries. Browse appears first when the verb has a browsing action. Root documents sit in Overview. Each section group uses its front-door document title and top-level directory description; each choice leads with its heading title and follows with its filename or section-relative nested path. Both fields participate in package-owned search. Actions appears last, and typed discriminants keep product actions distinct from document paths. Stable choice identities preserve the remembered document after reordering and filtering.

For an internal picker selection, the package clears the completed picker frame, Discern reads and renders the admitted document through its existing package-backed Markdown adapter, and the package presents `Press Enter to continue.` as a compact acknowledgement. Enter restores the picker and remembered document. Selection or continuation cancellation exits cleanly. A direct target never acknowledges because it has no picker to restore.

Discern pins the immutable 0.20.0 package and keeps every terminal effect behind its existing process and interaction adapters. The sequential flow intentionally leaves long documents in the terminal's saved output. The package's composite Markdown browser — including split geometry, independent scrolling, internal-link navigation, mouse input, and restoration — is the only admissible richer implementation and remains deferred to the next integration wave.

## Consequences

- A configured `PAGER` has no effect unless the person supplies `--pager`; the Discern reading experience is the interactive default.
- A person can read, press Enter, and continue browsing without restarting the command. Explicit pager users retain the same return loop.
- Titles and section meaning lead the picker while paths remain visible for identity and search.
- Static and machine consumers retain their existing bytes and do not wait for input. Invalid paging combinations fail instead of silently ignoring the request.
- The sequential reader cannot independently scroll a document pane or keep the picker visible. Those capabilities arrive only when Discern adopts the published composite browser.
- Replacing the short-lived negative pager contract before launch is intentionally incompatible; no hidden alias preserves the inverted default.

## Alternatives considered

**Keep external paging as the default.** Rejected because local pager configuration would continue to bypass the product's reading experience and make behavior vary between machines.

**Render internally and end the browse command.** Rejected because reading one document would discard the active query and selection, turning exploration into repeated command launches.

**Implement the split reader in the same change.** Rejected because default behavior, navigation projection, and static-contract preservation can land independently. The sequential loop is also the required fallback when a terminal cannot support the composite reader.

**Read keys or clear frames directly in the command.** Rejected because it would duplicate package-owned input, cleanup, and terminal restoration behind a second effect boundary.
