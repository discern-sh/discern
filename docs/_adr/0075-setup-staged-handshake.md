# ADR 0075: `discern setup` is a staged, consent-driven handshake

**Status**: accepted; revises [ADR 0036](0036-unify-setup.md) (unify init +
bootstrap into one `discern setup`),
[ADR 0037](0037-setup-incompleteness-observable.md) (incompleteness is
observable), [ADR 0044](0044-setup-involve-not-gate.md) (involve, don't gate),
and [ADR 0065](0065-setup-keeps-its-promises.md) (setup keeps its promises).
Builds on [ADR 0069](0069-agent-auto-detect-at-setup.md) (agent auto-detect),
[ADR 0052](0052-worktree-sibling-placement.md) (worktree sibling placement), and
the provider registry of
[ADR 0031](0031-typed-provider-integration.md)/[ADR 0043](0043-registry-derived-agent-parity.md).

## Context

ADR 0036 collapsed init + bootstrap into one zero-config `discern setup`: the
user installs the binary, tells their coding agent to "run discern," and a
single command scaffolds the machinery, lays the doc skeletons, and prints the
authoring brief. ADR 0037 made the unfinished state observable; ADR 0044 made
the agent's conversation warm rather than gated; ADR 0065 made completion a
proven gate. Each hardened the _single-shot_ shape: one command that **acts on
first contact**.

Running that shape end-to-end with agents — and humans — that had never heard of
discern surfaced a cluster of defects the hardening could not reach, because
they trace to the shape itself:

- **First contact is addressed to the wrong reader.** The install message says
  "tell your coding agent to run discern," but the first thing a curious human
  does with a new binary is **run it themselves** — before they will trust an
  agent with it. They are met with a frame addressed to "you, the agent," and a
  command that immediately checks out a branch and writes files. The one reader
  most in need of reassurance gets the least.

- **A command that mutates on first contact cannot also earn consent.** Handed
  the brief by the same call that did the scaffolding, an agent reads it two
  failure-prone ways. One stops and reports the work _done_ without doing it
  (the echo-back ADR 0037 fights). The other freezes: the brief says it is "in
  control," but nothing told it _when_ it had the user's go-ahead to act, so it
  asks "may I?" and waits — the consent-paralysis ADR 0044's tone could not
  dissolve, because the missing thing was a _structural_ moment of consent, not
  a warmer sentence.

- **Conflicts surface too late, or never.** A repo with its own `docs/` tree, or
  a hand-authored `CLAUDE.md`, or an opinion about where worktrees belong, is
  the common case — not the exception. The single-shot command discovers these
  _while writing_ (the dirty-tree refusal) or not at all (it folds an existing
  `CLAUDE.md` into `guidance.md` but never tells the human it happened, nor asks
  where their docs should live). The human is never given the facts to weigh
  before the scaffold lands.

- **Progress is invisible and only prose-enforced.** The brief is eight steps;
  weaker models skip some. `setup done` catches the _outcome_ (markers must
  clear, the gate must be green), but nothing shows _what is left_ along the
  way, so a skipped step is invisible until the final gate bounces it.

- **No provenance.** Setup is the single highest-leverage moment in a project's
  life with discern, and its quality is bounded by the model that did it. When a
  "discern is broken" report arrives, nothing records which model configured the
  project — the one fact that most often explains it.

The unifying root is that **orientation and mutation were fused.** A command
that _acts_ on first contact cannot also be the thing a curious human safely
pokes, nor the thing an agent deliberately commits to. Splitting them is the
lever.

## Decision

**`discern setup` becomes an explicit, mostly read-only state machine whose one
hard invariant is that nothing is written until `begin`.** Four phases:

1. **`discern setup` (and bare `discern`, pre-bootstrap) → welcome.** Read-only,
   and **three-state**: _fresh_ (no config, in a git tree), _in progress_
   (`begin` ran, `[meta].bootstrapped` still false), and _done_ (bootstrapped →
   today's grouped help). Human output is **dual-addressed** — a Humans block
   (what discern is, that it is safe, reversible, and touches nothing outside
   this folder) and an Agents block (you drive setup; run
   `discern setup
   verify`). `--json` carries `phase` and `next_action` so a
   JSON-consuming agent is funneled the same way.

2. **`discern setup verify` → preflight.** Read-only. It machine-checks the
   ground and produces the consent conversation **from facts about this repo**:
   git state (repo? clean tree?), an existing `docs/` tree, a pre-existing
   `CLAUDE.md`/`AGENTS.md` that `begin` will fold into `guidance.md`, the agents
   detected on `PATH` (ADR 0069), and the **exact** worktree sibling path that
   will be created (ADR 0052). It hands the agent a short checklist to confirm
   with the human — model capability and a fresh session, the worktree location,
   readiness for the branch checkout — then points at `begin`.

3. **`discern setup begin` → the first mutation.** This is today's scaffold
   (`runSetup`'s clean-tree check, the `discern-setup` branch, the seed plan,
   the compile, the skeletons) plus the brief, now reached only here. It records
   **provenance** (a `--model` self-declared model id, alongside the discern
   version it observed). The declarative `--config`/flag path (CI, presets)
   lands here too and skips the handshake.

4. **`discern setup done` → unchanged proof.** `refresh → doctor → finish`, then
   `[meta].bootstrapped` (ADR 0065). It now also emits the **provider-aware
   reactivation handoff**: the `discern_*` MCP tools and session hooks are wired
   but load at session start, so each configured agent is told its specific
   reactivation step (new session; for some, a one-time trust). Each step is
   DERIVED from that agent's required wiring (its live `mcp` server, its
   `hooks`, its `trust` gate) — not a hand-listed table — so a reuse-canonical
   agent that wired nothing is never told to restart, and a parity test ties the
   derivation to the `PROVIDERS` registry (ADR 0051): a new vendor's
   setup-completion handoff follows from its declaration and cannot be silently
   forgotten.

The read-only→destructive boundary sits exactly at `verify | begin`.

**The funnel is soft; the outcome stays hard-gated.** Each phase's `next_action`
points at the next, but no phase hard-refuses to run before its predecessor —
there is no pre-`begin` state to gate on (on a fresh repo there is no
`discern.toml` until `begin` writes it), and the _outcome_ is already gated
where it cannot be faked: `setup done` refuses while any marker remains or the
gate is red (ADR 0065). This extends ADR 0037's principle — make the state
observable, not the path mandatory.

**Progress is derived, not self-reported.** A new `setupProgress(root)` reads
which scaffolded files still carry a skeleton marker (`findSkeletonMarkers`,
already the `setup done` predicate) and which capabilities are wired versus
unset, and the welcome's _in-progress_ state and `status` render it. Skipping a
step becomes _visible_ without any self-reported "mark step N done" call an
agent could fake.

The explicit *no*s:

- **No hard `verify → begin` gate.** It would require a state marker written
  before any config exists, breaking the read-only-until-`begin` invariant; the
  funnel plus the `done` outcome-gate already prevent a skipped-step completion.
  Deferred exactly as ADR 0037 deferred its per-step state machine — until real
  use proves it insufficient.

- **No self-reported per-step tracking.** A `setup done --step=N` that writes a
  step number to `[meta]` reintroduces ADR 0037's echo-back at finer grain (an
  agent marks a step it did not do), taxes the loop with round-trips, and most
  brief steps have no machine-checkable predicate anyway.
  `discern setup step
  <n>` exists only as a **read-only re-serve** of one
  step's text, for a model that lost the thread — it tracks nothing.

- **The welcome shows for both TTY and non-TTY.** Dual-addressing both readers
  is robust where detecting them is not: an agent's shell can be a terminal and
  a human can pipe, so `isTerminal()` would address the wrong reader on a wrong
  guess. Each reader self-selects its block.
  [ADR 0088](0088-fresh-setup-welcome-decorates-only-on-tty.md) later narrows
  this stance: content remains dual-addressed, while decoration alone may branch
  on TTY for the fresh welcome.

- **`discern setup` keeps its declarative behaviour.** Given `--config` or the
  scaffold flags (the CI/preset path), `setup` proceeds as `begin`; only the
  _bare_ invocation welcomes. The retired `init`/`bootstrap` aliases still
  redirect (ADR 0036).

- **The commands stay non-interactive.** Each prints and exits (ADR 0036/0044);
  the conversation — including the new consent checklist — is the _agent's_ to
  hold, not a CLI prompt.

- **Turning worktrees off is not offered as a setup suggestion.** The worktree
  workflow is load-bearing to discern's model; `verify` presents _keep the
  sibling location_ or _relocate it_ (`[worktree].root`), not _disable it_.

## Consequences

- **The curious human is the design centre, not an afterthought.** Running
  `discern` writes nothing and reads as a welcome, so the instinct to poke the
  binary first is rewarded with reassurance instead of a confusing
  agent-addressed scaffold. This is the first impression the launch lives or
  dies on.

- **Consent is structural.** The agent reaches `begin` only after a phase that
  told it what to confirm with the human — so "you are in control" finally has a
  _moment_ attached to it, dissolving both the false-done and the
  consent-paralysis failures without a heavier gate.

- **The consent conversation is grounded.** `verify` turns generic questions
  into ones about _this_ repo — your existing docs, your existing instructions,
  the precise path that will appear beside your checkout — which is both better
  UX and the natural home for the teaching moment that discern's docs tree is
  "what is inferable from the code," distinct from a hand-curated one.
  [ADR 0080](0080-configured-agent-docs-root.md) makes the chosen location
  persistent: `verify` remains read-only and passes it to `begin`, which records
  `[docs].dir`.

- **Provenance makes triage possible.** `doctor` surfaces who set the project
  up; a broken-install report can be read against the model that produced it.

- **More round-trips before scaffolding.** Welcome → verify → begin is three
  calls where there was one. The friction is the point — it is where consent and
  the first impression are bought — but it is real, and a power user who wants
  the old immediacy uses `discern setup begin` (or the declarative `--config`)
  directly.

- **The handshake stays CLI-only.** MCP is not wired until `begin`, so setup
  cannot run over the `discern_*` tools; the reactivation handoff at `done` is
  what bridges the gap to the post-setup MCP/hook surface — the seam this ADR
  also closes.

- **More surface to keep coherent.** Four phases, a three-state welcome, and the
  derived-progress view are more moving parts than one command. They are kept
  coherent by the existing single-source disciplines: the phase vocabulary and
  the not-set-up wording live once in `shared/setup_state.ts` (shared by the CLI
  router, `status`, the session hook, and the MCP server), and the phase set is
  tied to its satellites by a forcing function (ADR 0051), so a new phase cannot
  drift across surfaces.

- **The tests must run cold.** ADR 0065's lesson was that the suite scaffolded
  `bootstrapped = true` and so never exercised the un-set-up state where the bug
  lived. The welcome's three states, `verify`, and `begin` are all driven from
  the un-bootstrapped state, the only place they are real.

## Alternatives considered

- **Keep single-shot setup; fix the framing with TTY detection.** Rejected: the
  earlier proposal to fork the message on `isTerminal()` is fragile — an agent's
  shell can be a terminal and a human can pipe output — so a wrong guess
  addresses the wrong reader. Dual-addressing both, always, cannot misfire, and
  the deeper problem (a command that mutates before consent) is untouched by
  framing alone.

- **Hard-gate `verify → begin` with a state marker.** Rejected for now: there is
  no `discern.toml` to record "verified" in until `begin` writes one, so the
  marker would have to be a sidecar that breaks the read-only-until-`begin`
  invariant. The outcome-gate at `done` already makes a skipped-step completion
  impossible, so the marginal integrity is not worth the cost. Revisit if cold
  runs show agents skipping `verify`.

- **Self-reported per-step tracking in `[meta]`.** Rejected: it is the precise
  failure ADR 0037 exists to prevent, one altitude down — an agent that will
  report the whole job done without doing it will mark a single step done just
  as readily — and it buys round-trips for no real verification. Derived
  progress cannot be faked, and is free.

- **Flags (`--agent-verification` / `--agent-begin`) instead of sub-verbs.**
  Rejected: a flag that transforms a command from "show information" into
  "scaffold a repository" is a smell — flags modify, verbs act. `setup verify` /
  `begin` match the existing `setup done`, are discoverable in `--help`, and
  self-identify to the agent through the welcome's Agents block rather than the
  verb name.

- **Fold the preflight into the welcome's Agents block.** Rejected: the welcome
  must stay short and legible to a human, and the full preflight is agent-facing
  detail. Separating them keeps each surface addressed to one reader with one
  purpose, which is the whole point of the split.
