# ADR 0036: Unify setup under one zero-config `discern setup`

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` →
> `accept`, the retired product-category wording → `discern`, the gate, or the
> bar; the decision and reasoning are unchanged.

**Status**: accepted

Amends and **consolidates**
[ADR 0024](_superseded/0024-setup-command-not-skill.md) (which moved setup out
of a materialized skill — a decision that lives on here: `discern setup` is a
command that prints instructions, recorded by the `[meta].bootstrapped` marker)
and builds on [ADR 0016](_superseded/0016-consolidate-install-surface.md).
Hardened by [ADR 0037](0037-setup-incompleteness-observable.md), which makes the
unfinished-setup state observable so the handoff can't be mistaken for
completion. The setup-brief interaction model it established —
propose-and-confirm — is later revised to _involve, don't gate_ by
[ADR 0044](0044-setup-involve-not-gate.md).

## Context

A fresh install took **two human touchpoints**:

1. The user ran **`discern setup`** — an interactive wizard asking for a name, a
   slug, source globs, a brief, and which agent files to emit — which scaffolded
   the machinery.
2. The user then **told their coding agent to run `discern setup`**, which laid
   the doc skeletons and printed the authoring instructions the agent worked
   through, finishing with `discern setup done`.

Two problems with that shape:

- **It asks the user to make decisions the agent is better placed to make.** The
  slug, the globs, the agent set, the brief — an agent reading the repo can
  propose all of them, and the wizard is friction between install and value. The
  product we want to sell is _zero-configuration_: the user makes no decisions;
  their coding agent asks them clarifying questions and does the rest.
- **The split is an artifact, not a boundary.** `setup` (mechanical scaffold)
  and `setup` (agent authoring) are two halves of one event: "set this project
  up." Two verbs, two names to learn, two things to sequence — for one job.

There is also a **model-capability** insight specific to setup. Setup is a
one-time event whose output — the principles, the docs, the capability fills —
every later session inherits. The single biggest lever on whether discern feels
useful is whether that one-time pass was done by a _capable_ model. But the user
chooses the model _before_ the agent reads any instructions, so the nudge to
"use your most capable model" has to reach the user at the moment they kick the
agent off, not only inside the prompt.

## Decision

**Make `discern setup` the single, always-non-interactive setup surface, fronted
by bare `discern`, and market it as zero-configuration.**

- **One command.** `discern setup` scaffolds the machinery (a `discern.toml`
  with capabilities unset, the compiled agent files, the merged settings, the
  MCP wiring), lays the doc skeletons (only when the project has none), and
  prints the authoring instructions for the agent — in one invocation.
  `discern setup done` validates and records `[meta].bootstrapped`.
- **Bare `discern` is the entry point.** The install message is now "tell your
  coding agent to run `discern`." Bare `discern`, before setup is recorded, runs
  setup (in a project, or — to avoid scaffolding a stray directory — in any git
  work tree); once recorded, it shows help as before.
- **Always non-interactive.** There is no wizard. Setup resolves everything from
  zero-config defaults (slug from the directory, the default agent set, no
  brief). The user makes no decisions at the CLI; the agent asks clarifying
  questions in chat. The declarative `--config`/`--brief`/flag path is retained
  for CI and presets.
- **Pre-setup, the work verbs hard-redirect.** Until `[meta].bootstrapped` is
  recorded, `done` / `prepare` / `test` / `standards` / `accept` refuse and
  point at `discern setup` (exit non-zero; a structured `not_set_up` result
  under `--json`). This amends ADR 0024's "nudge, not gate" stance for these
  verbs: an empty gate pre-setup reports a false "all-green," which is worse
  than a clear redirect. `help` (discern's own documentation), `status`,
  `doctor`, `config`, the plumbing the hooks call, and `setup` itself stay open.
- **No launch aliases.** The launched CLI surface keeps `setup` as the only
  setup verb. Historical aliases were removed before launch so generated
  guidance, docs, and tests teach a single command.
- **The prompt carries a frontier-model gate.** Its first step tells the agent
  to confirm it is running the user's most capable model and, if not, to stop
  and ask the user to switch before continuing. The installer message carries
  the same nudge so it reaches the user up front.
- **No schema change.** The completion marker stays `[meta].bootstrapped`
  (internal), so there is no migration; a project completed under the earlier
  setup flow reads as set up under this one.

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
- **Green-gate completion proof.** End by running `discern done` and confirming
  it is genuinely green with the activated capabilities — proof the discern
  setup is real, not merely that the config parses.

## Consequences

- `src/commands/setup.ts` owns setup; `templates/setup/` holds the served
  instructions; the skeleton marker is `<!-- setup fills this -->`.
- The interactive wizard (`resolveSetupConfig`'s prompt branches) is no longer
  reached from setup; the prompt helpers (`confirmProceed`, `renderReview`)
  survive only for `preset`, which is still interactive.
- The default footprint is unchanged: setup with no flags still lands just
  `discern.toml` (+ the generated agent files), with no `brief.md`.
- Engine tests treat a scaffold as **set up** by default (`scaffoldEngine` marks
  `[meta].bootstrapped`); setup/audit tests opt into the un-set-up state, since
  the hard redirect would otherwise block every work-verb test.
- ADR 0024 keeps its point-in-time record; this ADR is the record of the change
  and is cross-linked from it.

## Alternatives considered

- **Keep the older split setup surface.** Rejected: the split surface keeps two
  names for one event, which is exactly the confusion this ADR removes.
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
