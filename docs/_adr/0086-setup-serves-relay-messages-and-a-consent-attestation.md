# ADR 0086: setup serves ready-to-relay messages and gates a fresh scaffold on a `--confirmed` attestation

**Status**: accepted; revises the _emphasis_ of
[ADR 0075](0075-setup-staged-handshake.md) (the staged, consent-driven
handshake), [ADR 0077](0077-setup-agent-is-the-configuration-engine.md)
(transparency over interrogation), and
[ADR 0078](0078-setup-pages-and-per-step-proof.md) (stateless pages, the
two-lane rule) — structure preserved, the prose lane's genre changed. Builds on
[ADR 0028](0028-result-envelope-and-diagnostics.md) (one result envelope per
verb) and [ADR 0041](0041-self-describing-mcp-surface.md) (schema-backed `data`).

## Context

Three iterations turned one advisory surface after another into a structural
one — the staged handshake (ADR 0075), the configuration-engine reframe (ADR
0077), derived progress and per-step proof (ADR 0078) — and ADR 0077 states the
governing lesson: **everything structurally enforced happened reliably;
everything merely advised degraded.** What is still advisory is the conversation
itself.

The prose lane — the load-bearing lane of ADR 0078's two-lane rule — carries
**stage directions** ("open warmly and explain what discern is… a conversation,
not a checklist") where it should carry **the script**. An agent with a warm
temperament improvises well from stage directions. A terse one executes every
command correctly, asks the verbatim model question, respects the write
boundary — and compresses the onboarding into a three-line checklist, because
composing warmth from instructions is exactly the transformation that fails
under final-answer compression. Clean-room runs (agents with no prior discern
knowledge, disposable target repos) reproduced this across vendors: the funnel
is followed mechanically while the conversation it exists to stage is compressed
away. The failure is the _genre_ — instructions _about_ a message — not
insufficiently stern wording.

Two adjacent gaps travel with it. The journey framing — what happens, how long,
what it costs in time and tokens — arrives only in the post-`begin` brief, after
the user is already turns deep, so it informs none of the moments it was written
for. And ADR 0075 left the `verify → begin` funnel deliberately soft, deferring
a harder consent measure "until real use proves it insufficient" — the
clean-room runs are that proof: agents reach `begin` and scaffold without ever
holding the conversation `verify` staged.

## Decision

**discern authors every human-facing message of setup; the agent couriers it.
And a fresh scaffold requires an explicit `--confirmed` attestation whose refusal
re-serves the consent message.**

1. **The prose lane ships the script, not stage directions.** Each human
   touchpoint serves a pre-composed, first-person "message to your human" block
   the agent relays: the **consent** message at `verify` (what discern adds, what
   it will do and cost, the verbatim model question, the docs home, the worktree
   location), the **started** moment at `begin` (a one-line "setup has started…"
   relay), and the **completion** message at `done` (honest coverage, the
   fresh-session reactivation step, the landing recommendation). The blocks are
   built once in `src/shared/setup_messages.ts` and carried verbatim on every
   surface — the human render, the `--json` `guidance` field, the
   `awaiting_consent` refusal — never decomposed into structured fields (ADR
   0078's finding: field-ized behavioral content is summarized and weakened; only
   prose is followed).

2. **The relay licence is adaptive, not verbatim-or-else.** Every block opens
   with _"adapt the wording to your own voice if you like, but keep every
   point."_ A terse agent pastes (the floor is raised); a warm agent embellishes
   (the ceiling is kept). The goal is a raised floor, not an equalized ceiling: an
   agent that does nothing but relay discern's served blocks still gives a novice
   a complete, accurate, warm-enough first experience.

3. **A `--confirmed` attestation gates a fresh scaffold.** `discern setup begin`
   requires `--confirmed` **exactly when** it would scaffold a fresh install
   outside the declarative paths — `freshInstall` **and** no `--config` **and** no
   `--allow-dirty`. Absent it, `begin` refuses before touching anything with a
   structured `awaiting_consent` error that **re-serves the same consent message**
   and the exact command to run after the conversation. The error path is the
   teaching path: an agent that skipped `verify` is handed the conversation, not
   silently proceeded past it. The attestation is **stateless** — it rides the
   invocation, records nothing — so ADR 0075's no-sidecar-marker invariant holds.

The journey framing (the time-and-tokens expectation, the roadmap) moves forward
into the `verify` consent message, so it lands before anything is written.

The explicit **no**s:

- **No CLI interactivity.** Print-and-exit stands (ADR 0036/0044); the
  `awaiting_consent` refusal is itself a print-and-exit, never a prompt.
- **No hard `verify → begin` state gate.** ADR 0075 rejected a state marker (it
  needs a record before any config exists, breaking read-only-until-`begin`); the
  stateless attestation is the strongest lever that respects that boundary, not a
  reintroduction of the gate.
- **No vendor-sniffed output.** The served blocks are domain- and vendor-neutral;
  the floor-raise makes detecting a terse agent to compensate unnecessary.
- **No field-ized messages.** The relay blocks ride the prose lane verbatim on
  every surface (ADR 0078's two-lane rule is preserved, not loosened).
- **Not a hard consent gate.** `--confirmed` is rubber-stampable by a determined
  agent — accepted; it is a speed bump with a payload (it re-serves the
  conversation), not proof.

## Consequences

- **The floor is raised without capping the ceiling.** A terse courier agent now
  delivers a complete first conversation — the novice learns what discern is,
  what it will do, what it costs, and what they are agreeing to, before anything
  is written — while a warm agent is still free to make it its own.
- **The refusal teaches.** An agent that ran `begin` too early is handed the
  consent conversation and the corrected command, rather than scaffolding past a
  step it skipped. This is ADR 0075's soft funnel gaining exactly one hard edge,
  at the read-only→destructive boundary, without a state machine.
- **Single-source discipline extends to the messages.** They live once and every
  surface carries them verbatim; parity tests fail if any copy drifts, and the
  `setup:done` payload is now schema-backed (ADR 0041) like `verify`/`step`.
- **The attestation is honest about its limits.** A determined agent can pass
  `--confirmed` without holding the conversation. Accepted: the aim is a raised
  floor, and the flag's value is the served payload it withholds until asked, not
  a cryptographic guarantee.
- **More surface to keep coherent.** Three served blocks, a flag, and a done
  schema are new moving parts — held together by the same single-source
  disciplines the rest of setup uses, plus the parity/faithfulness tests.
- **Emphasis, not reversal.** The staged handshake, derived progress, the
  stateless pages, and the configuration-engine reframe all stand. ADR 0075
  pre-authorized this revisit; the clean-room evidence is what it asked to wait
  for.

## Alternatives considered

- **Keep stage directions; sharpen the prose.** Rejected: the degradation was
  systemic across vendors and traces to the genre — instructions _about_ a
  message that a terse agent summarizes — not to wording. Sharper stage
  directions reproduce the same compression.
- **A hard `verify → begin` state gate.** Rejected as ADR 0075 rejected it: a
  pre-`begin` marker breaks read-only-until-`begin`. The stateless attestation is
  the strongest lever that respects that invariant.
- **Field-ize the messages for machine consumers.** Rejected by ADR 0078's
  two-lane finding: behavioral content delivered as JSON fields is treated as data
  to summarize and weakened. The relay blocks stay prose; only the machine lane
  (findings, spine, the structured `done` pieces) is field-ized.
- **Vendor-sniffed warmth (detect the terse agent and compensate).** Rejected:
  brittle, and the served-message floor makes it unnecessary — discern raises the
  floor for every agent rather than guessing which one needs help.
