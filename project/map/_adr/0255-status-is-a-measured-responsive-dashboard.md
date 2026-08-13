# ADR 0255: Status is a measured responsive dashboard over one result model

> **Presentation implementation amendment (2026-08-13; [ADR 0278](0278-external-terminal-rendering-crosses-one-process-boundary.md)):** The typed status result, precedence, and complete identity policy survive. The published package's lossless Fleet mode and Components now own responsive terminal geometry and reusable frames; Discern supplies safe product facts and explicit time/capability context. Proof is the current product term for the Gate evidence historically called a receipt below. Machine compatibility fields retain their declared names.

**Status**: accepted. Extends [ADR 0033](0033-status-verb-and-location-aware-scope.md), [ADR 0041](0041-self-describing-mcp-surface.md), [ADR 0188](0188-the-receipt-relays-as-one-line.md), and [ADR 0250](0250-discern-managed-human-output-declares-semantic-groups.md).

## Context

`discern status` must answer two related questions: what is happening across the worktree fleet, and what deserves attention next. Its structured result already carries Git divergence, logbook activity, gate receipts, landing authority, and cross-worktree collisions. The terminal renderer exposed much less of that evidence through a content-sized table.

The table gave every value its natural width. One long branch, worktree id, or authority string therefore widened every row beyond the terminal. Terminal auto-wrap then chose the structure. Worktree and branch occupied separate, usually duplicate columns; the current marker sat after the least important field; Git cleanliness appeared to be overall health; and receipt readiness, collision paths, and actionable states were either absent or displaced by static detail.

Truncating identities would fit a table but weaken the operator's ability to copy the exact branch or worktree id. Using one fixed stacked form would preserve facts but waste space on a wide terminal. Recomputing facts in a terminal-specific collector would let the human and machine surfaces disagree. The renderer needs responsive layout while the result envelope remains the authority.

## Decision

**Human `status` is a static, width-measured dashboard projected from the typed status result.** The result collector performs every Git, receipt, authority, collision, and logbook read. A pure status renderer receives that result together with terminal width, color mode, verbosity, and the current time; it performs no observation of its own.

The renderer reads the terminal width and caps the report at 104 display columns. It uses an aligned table only when every natural column and every required fact fit within that cap. Otherwise each worktree becomes a stacked row with hanging-indented fields. Ordinary prose and path detail wrap explicitly, including overlong tokens. A branch or worktree id may exceed the width only on its isolated identity line. It remains complete. The primary identity is the branch, with the shared `agent/` prefix and mechanical six-character suffix dimmed without changing the copied characters. A genuinely different worktree id appears on a labelled secondary line. Detached branches and the current row remain explicit.

One presentation model derives identity, status, tone, priority, Git state, Proof state, activity, authority, collision facts, and attention text for every row. Overall status uses this precedence: broken; unreadable; a failed or refused last action when no newer action is running; collision; behind; running; ready; stale unlanded work; recent work in progress; unreadable, unavailable, or stale Proof; committed work needing the gate; then idle. Successful observation commands remain activity facts and never establish health. Rows sort by that attention priority, then current context, recent activity, identity, and path.

Color reinforces complete text and glyph cues. Failed, broken, and unreadable states are red. Behind, blocked, collision, stale, uncommitted Git state, and other attention states are yellow. Running work and the current marker are cyan. Green is reserved for an honored Proof, readiness, or granted authority. Clean Git state and repeated mechanical metadata are dim. Actionable `discern …` commands are cyan inside their preserved backticks. Removing ANSI styling changes no words, glyphs, or facts.

The main-checkout dashboard leads with fleet counts, attention, and sorted worktrees. It reports the main checkout once, outside the worktree list. Proof state appears on every readable worktree row using the existing Gate Proof vocabulary. Activity combines the winning activity clock with the last action; a running action reports elapsed time and labels its median as historical context, such as `running done 2m · usually 4m`. Landing authority appears only where Proof-backed readiness makes it relevant. When a collision takes primary-status precedence over a ready branch, readiness and authority remain secondary facts. Default checks show configured changed scopes, planned gate jobs, and the number of standards. Derived scope markers remain machine facts. Port and resource assignments occupy a separate local-environment section. Landing evidence shows branch, pass state, changed files, diff size, commit, and age. Stored Proof Markdown and storage plumbing remain verbose or machine detail.

**The human dashboard and machine envelope are separate projections of the same result.** Existing JSON and MCP fields remain. Each readable fleet row adds the complete `gate_receipt` inspection while the honored-only receipt fields remain for compatibility. The result also adds project identity for the terminal heading. Canonical machine hints keep field-specific instructions; entries that need different terminal wording own an interactive projection with the same parameters.

## Consequences

- Narrow, ordinary, wide, and extra-wide terminals have deterministic structure. An extra-wide terminal no longer stretches related fields apart.
- Exact identities remain available in every layout. Long identifiers can make one isolated line wider than the report, while unrelated fields stay bounded.
- A person can distinguish running, failed, behind, dirty, blocked, colliding, and Proof-ready work without opening JSON. Color-blind and no-color output carries the same answer.
- The terminal report is intentionally more vertical when detail does not fit a bounded table. That cost keeps paths, reasons, and next steps readable.
- Default output omits low-value inventories and raw Proof storage detail. Operators use `--verbose` or the structured result when they need those records.
- The typed status and Proof vocabularies drive semantic and width matrices. Adding a state requires a presentation and test case, so a new critical fact cannot silently disappear from the row.
- JSON and MCP consumers see additive fields. They may adopt `fleet[].gate_receipt` while existing use of `receipt_honored`, `receipt`, and `receipt_line` continues to work.

## Alternatives considered

- **Truncate identity columns with an ellipsis.** Rejected because the exact identifier is operational input for review, update, and landing commands.
- **Keep an unlimited table and rely on terminal wrapping.** Rejected because the terminal cannot preserve row boundaries or hanging indents once a content-sized line exceeds the measured width.
- **Use stacked rows at every width.** Rejected because a bounded table is faster to scan when all required facts fit naturally.
- **Build a second human-only collector.** Rejected because duplicated observation would let terminal and machine answers drift and would make a read-only presentation layer unexpectedly effectful.
- **Make color the status classifier.** Rejected because redirected, `--no-color`, and inaccessible-color output must retain the same meaning.
