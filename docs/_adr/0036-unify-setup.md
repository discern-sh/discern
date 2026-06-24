# ADR 0036: Unify init + bootstrap into one zero-config `discern setup`

**Status**: accepted

Amends [ADR 0024](0024-bootstrap-as-command.md) (which made bootstrap a command,
not a skill) and builds on [ADR 0016](0016-consolidate-install-surface.md).
Hardened by [ADR 0037](0037-setup-incompleteness-observable.md), which makes the
unfinished-setup state observable so the handoff can't be mistaken for
completion.

## Context

A fresh install took **two human touchpoints**:

1. The user ran **`discern init`** — an interactive wizard asking for a name, a
   slug, source globs, a brief, and which agent files to emit — which scaffolded
   the machinery.
2. The user then **told their coding agent to run `discern bootstrap`**, which
   laid the doc skeletons and printed the authoring instructions the agent
   worked through, finishing with `discern bootstrap done`.

Two problems with that shape:

- **It asks the user to make decisions the agent is better placed to make.** The
  slug, the globs, the agent set, the brief — an agent reading the repo can
  propose all of them, and the wizard is friction between install and value. The
  product we want to sell is _zero-configuration_: the user makes no decisions;
  their coding agent asks them clarifying questions and does the rest.
- **The split is an artifact, not a boundary.** `init` (mechanical scaffold) and
  `bootstrap` (agent authoring) are two halves of one event: "set this project
  up." Two verbs, two names to learn, two things to sequence — for one job.

There is also a **model-capability** insight specific to setup. Setup is a
one-time event whose output — the principles, the docs, the capability fills —
every later session inherits. The single biggest lever on whether discern feels
useful is whether that one-time pass was done by a _capable_ model. But the user
chooses the model _before_ the agent reads any instructions, so the nudge to
"use your most capable model" has to reach the user at the moment they kick the
agent off, not only inside the prompt.

## Decision

**Collapse `init` + `bootstrap` into a single, always-non-interactive
`discern
setup`, fronted by bare `discern`, and market it as
zero-configuration.**

- **One command.** `discern setup` scaffolds the machinery (a `discern.toml`
  with capabilities unset, the compiled agent files, the merged settings, the
  MCP wiring), lays the doc skeletons (only when the project has none), and
  prints the authoring instructions for the agent — in one invocation.
  `discern setup done` validates and records `[meta].bootstrapped`, exactly as
  `bootstrap done` did.
- **Bare `discern` is the entry point.** The install message is now "tell your
  coding agent to run `discern`." Bare `discern`, before setup is recorded, runs
  `setup` (in a project, or — to avoid scaffolding a stray directory — in any
  git work tree); once recorded, it shows help as before.
- **Always non-interactive.** There is no wizard. Setup resolves everything from
  zero-config defaults (slug from the directory, the default agent set, no
  brief). The user makes no decisions at the CLI; the agent asks clarifying
  questions in chat. The declarative `--config`/`--brief`/flag path is retained
  for CI and presets.
- **Pre-setup, the work verbs hard-redirect.** Until `[meta].bootstrapped` is
  recorded, `finish` / `prepare` / `test` / `ratchets` / `graduate` refuse and
  point at `discern setup` (exit non-zero; a structured `not_set_up` result
  under `--json`). This **amends ADR 0024's "nudge, not gate"** for these verbs:
  an empty gate pre-setup reports a false "all-green," which is worse than a
  clear redirect. `help` (discern's own documentation), `status`, `doctor`,
  `config`, the plumbing the hooks call, and `setup` itself stay open, and a
  parse-broken config still surfaces its own TOML error rather than the redirect
  (the `configOk` guard) — so the spirit of 0024 (never wall the debugging or
  read-only paths) is preserved where it matters. (`docs` was originally exempt
  too, but it browses the project's _own_ tree, which is empty until setup fills
  it; it later joined the gated set, with `help` as the pre-setup documentation
  surface — [ADR 0039](0039-bundled-help-docs.md). The gated set lives once in
  `shared/setup_state.ts`, shared by the CLI router and the MCP server.)
- **`init` and `bootstrap` redirect to `setup`.** The retired names (and
  `bootstrap done` → `setup done`) still work, printing a one-line "now
  `discern
  setup`" note, so existing muscle memory and older docs don't break.
- **The prompt carries a frontier-model gate.** Its first step tells the agent
  to confirm it is running the user's most capable model and, if not, to stop
  and ask the user to switch before continuing. The installer message carries
  the same nudge so it reaches the user up front. (See the adversarial review
  below for the other prompt changes.)
- **No schema change.** The completion marker stays `[meta].bootstrapped`
  (internal), so there is no migration; an install bootstrapped under the old
  verb reads as set up under the new one.

### Adversarial review of the prompt

Rewriting the instructions was an opportunity to fix weaknesses the old prompt
carried, beyond the rename:

- **Operating-principles preamble.** The non-negotiables (best model, ask-first,
  propose-don't-overwrite, stay-project-specific, safe-to-re-run) are
  front-loaded so a weaker model can't lose them mid-march.
- **Ask up front, in a batch.** The old prompt read a `brief.md` and asked
  questions only as a last resort. Zero-config has no brief, so the agent now
  derives intent from the repo and asks the user a small batch of sharp
  questions early — not peppered across every step.
- **Early health smoke-test.** Run `discern status`/`doctor` before authoring,
  so a broken install or PATH is caught before effort is spent.
- **Structured proposal mechanism.** Use `discern config set-*` (comment-
  preserving, validated) to propose capability fills, rather than hand-editing
  TOML.
- **Green-gate completion proof.** End by running `discern finish` and
  confirming it is genuinely green with the activated capabilities — proof the
  harness is real, not merely that the config parses.

## Consequences

- `src/commands/init.ts` + `src/commands/bootstrap.ts` become a single
  `src/commands/setup.ts`; `templates/bootstrap/` becomes `templates/setup/`;
  the skeleton marker becomes `<!-- setup fills this -->`.
- The interactive wizard (`resolveInitConfig`'s prompt branches) is no longer
  reached from setup; the prompt helpers (`confirmProceed`, `renderReview`)
  survive only for `add-preset`, which is still interactive.
- The default footprint is unchanged: setup with no flags still lands just
  `discern.toml` (+ the generated agent files), with no `brief.md`.
- Engine tests treat a scaffold as **set up** by default (`scaffoldEngine` marks
  `[meta].bootstrapped`); setup/audit tests opt into the un-set-up state, since
  the hard redirect would otherwise block every work-verb test.
- ADR 0024 keeps its point-in-time record; this ADR is the record of the change
  and is cross-linked from it.

## Alternatives considered

- **Keep `init` as the unified verb name.** Rejected: `init` carries the "run
  the wizard" connotation we are removing; `setup` names the one-time event
  cleanly. (`init` survives as a redirecting alias.)
- **Soft redirect (keep ADR 0024's nudge, still run the verb).** Rejected for
  the gate verbs: running an empty gate pre-setup returns a misleading success.
  A hybrid (hard for gate verbs, soft for the rest) was considered but adds a
  distinction users don't need — the redirect set is small and uniform.
- **Bare `discern` always scaffolds, no git guard.** Rejected: a bare command
  that mutates a stray directory is a footgun. Gating the bare-invocation path
  on "inside a git work tree (or already a project)" keeps the
  install→run-discern flow zero-friction while refusing to scaffold somewhere
  unexpected; the explicit `discern setup` always scaffolds for the deliberate
  case.
- **Rename the marker to `[meta].setup`.** Rejected: a cosmetic rename that
  would cost a schema migration for no behavioural gain.
