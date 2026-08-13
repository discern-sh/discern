# ADR 0088: the fresh setup welcome decorates only on TTY

> **Presentation amendment (2026-08-13; [ADR 0278](0278-external-terminal-rendering-crosses-one-process-boundary.md)):** The content-routing and no-colour decisions survive. An eligible colour TTY with enough room now composes the styled welcome through package Box, Section, Command, Token, and layout APIs. Narrow TTYs, `--no-color`, `NO_COLOR`, non-TTY, JSON, and later setup states retain their plain contracts. One process context decides attachment, dimensions, and colour before the pure renderer runs.

**Status**: accepted; narrows the TTY stance in [ADR 0075](0075-setup-staged-handshake.md) and builds on [ADR 0086](0086-setup-serves-relay-messages-and-a-consent-attestation.md).

## Context

ADR 0075 made first contact read-only and dual-addressed: a curious human can run `discern` safely, and a coding agent sees the `verify` funnel in the same output. It explicitly rejected `isTerminal()` for deciding **who** the output addresses, because the guess is unreliable: an agent shell can be a TTY, and a human can pipe output. A wrong guess there sends the wrong message to the wrong reader.

The launch-readiness setup runs showed a separate problem. The fresh welcome is the human's one owned surface before they hand the project to an agent. In a terminal, a plain block is accurate but under-designed for the product's first impression; in a pipe, that same plainness is exactly what agents need. The decision pressure is the asymmetry: sending content to the wrong reader is catastrophic, while a wrong decoration guess is cosmetic.

## Decision

The fresh setup welcome always carries the same dual-addressed content, but its decoration branches on TTY.

The renderer is pure: it takes an explicit presentation mode such as `{ tty: boolean }`. The command edge reads `stdout.isTerminal()` once, combines it with the existing `--no-color` / `NO_COLOR` plumbing, and chooses the styled TTY render only when stdout is a terminal and colour has not been disabled. Non-TTY output, `--no-color`, and `NO_COLOR` all use the plain render. JSON output is unchanged.

The branch is presentation-only:

- **No content routing.** Both FOR HUMANS and FOR CODING AGENTS remain present in both renders.
- **No welcome-routing change.** This does not decide when the welcome shows.
- **No ANSI on the plain path.** Piped output stays clean for agents and tests.
- **No art pass for setup's later states.** `in_progress` and `done` remain plain; the investment is the fresh first-contact screen.

## Consequences

The terminal first impression can have hierarchy, a brand treatment, and one dominant action without making the agent path harder to parse. A human who runs `discern` sees something deliberately designed; an agent that captures stdout receives the same facts as plain text.

The code now has a small renderer seam and parity tests: the styled render is driven directly with `{ tty: true }`, the plain render with `{ tty: false }`, and tests assert that disabling colour resolves to the plain render even when stdout would otherwise be a TTY.

The cost is that content and decoration must stay conceptually separate. Future welcome edits should change the shared copy first, then let both renderers present it; a TTY-only fact would reintroduce the content-routing problem ADR 0075 rejected.

## Alternatives considered

- **Keep the welcome entirely plain.** Rejected: it stays easy to parse but wastes the human's first owned surface.
- **Branch the whole message on TTY.** Rejected for the same reason ADR 0075 rejected it: the terminal guess is not reliable enough to decide which reader gets which content.
- **Use colour only, without structure.** Rejected: colour alone does not create the hierarchy the welcome needs, and `--no-color` would collapse the design back to an undifferentiated block.
