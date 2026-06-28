# ADR 0017: Declare capabilities, derive the gate — retire slots + phases

> **Current-state note.** Lands together with its sibling
> [ADR 0018](0018-vocabulary-consolidation.md) (the four-layer vocabulary
> consolidation) — one 3→4 schema migration, best read as a pair.
> `KNOWN_CAPABILITIES` now lives in `src/shared/capabilities.ts` (the shell
> `capabilities.sh` mirror is gone —
> [ADR 0019](0019-single-binary-ts-engine.md)).

**Status**: accepted

## Context

The gate config asked every author to learn two coupled nouns before writing a
single command. A **slot** was a named hole you dropped a command into; a
**phase** (`fix`/`build`/`check`/`test`) was the scheduling bucket that decided
when and how it ran. So the smallest possible gate read:

```toml
[slots.format]
phase = "fix"
run   = "deno fmt"
```

Three lines and two concepts to say "this is how the project formats." The
problem was never that the model didn't work — it did — but that it spoke in
_mechanism_. "Slot" and "phase" describe the machine's plumbing, not the
project. Two frictions followed:

1. **No notion of a complete install.** Slot names were free-form, so the engine
   could not answer "does this project have a test capability?" or "is the build
   intentionally absent?" A slot named `verify-things` in the `check` phase
   carries no semantics — neither the engine nor an agent knows what guarantee
   it provides. The set of slots was open-ended, and you cannot report what is
   _missing_ from an open-ended set. This blocks the things readiness enables:
   an `agent doctor` that tells a newcomer whether the harness is actually
   wired, and a future `discern audit` that could advise _other_ repositories
   toward best-practice tooling — both of which need to reason over a closed,
   known vocabulary.

2. **The phase vocabulary leaked onto the user surface.** Because a slot _had_
   to carry a `phase`, every author met the four scheduling buckets on day one —
   in the config comments, the README phase table, the gotchas doc. But `fix`,
   `build`, `check`, `test` are nearly an alias of _what the command is for_: a
   formatter is a `fix`, a linter/type-checker is a `check`, the suite is a
   `test`. The author was made to declare the scheduling when the scheduling is
   almost always implied by the tool.

This is pre-launch (only two internal installs exist), so the model can still
change cleanly — the cheapest this will ever be, the window
[ADR 0009](0009-one-point-zero-drop-backward-compat.md) and
[ADR 0016](_superseded/0016-consolidate-install-surface.md) leaned on.

## Decision

Reframe the gate config around **capabilities**: a small, **closed** vocabulary
of things a project can do. The engine derives the scheduling.

1. **A known capability vocabulary, declared flat.** The core five are `format`,
   `build`, `lint`, `typecheck`, `test`. Each is one line — a capability name
   mapped to a command (or an array of commands run in order):

   ```toml
   [capabilities]
   format    = "deno fmt"
   lint      = "deno lint"
   typecheck = "deno check src/main.ts"
   test      = "deno task test"
   ```

   The set is **closed**: an unknown key under `[capabilities]` is a hard error
   that points the author at `[checks]`. A closed set is the whole point — you
   can only report presence/absence against a fixed vocabulary.

2. **The engine derives the stage; "phase" retires as a user word.** Each known
   capability maps to an internal scheduling **stage** — `format`→fix,
   `build`→build, `lint`→check, `typecheck`→check, `test`→test. The four stages
   survive _inside_ the engine (the parallel shape `fix → build → check ∥ test`
   is unchanged), but the author never writes one. The mapping lives in exactly
   two mirrored places: `KNOWN_CAPABILITIES` in `src/lib/config.ts` and
   `cap_stage()` in `templates/.discern/engine/lib/capabilities.sh`.

3. **An omitted capability is knowably absent.** There is no `:` no-op default
   anymore. A capability you don't have is simply not in the file — and _that
   absence is the readiness signal_. A fresh install with no capabilities is
   still a green gate (nothing to run passes); `agent doctor` reports the ✓/✗
   checklist and a "ready for agentic development" verdict. The old `:` existed
   only because a slot table had to physically exist to be discovered;
   capabilities are discovered by their known names whether present or not, so
   the structural reason for the no-op is gone. The engine treats an absent
   known capability as a **skip**, never an error.

4. **Custom work has an explicit escape hatch.** Anything outside the five known
   capabilities — a project-specific gate step the engine has no opinion about —
   is a `[checks.<name>]` with an explicit `stage`, a `run`, and an optional
   free-text `provides` label:

   ```toml
   [checks.licenses]
   stage    = "check"
   run      = "./scripts/check-licenses.sh"
   provides = "license-audit"
   ```

   `stage` is required here (the engine can't derive it from an unknown name);
   `provides` is a human/audit label, not a constraint.

The explicit **no**s: no user-facing `phase` key; no open-ended capability names
(custom work is a `[check]`, not an invented capability); no `:` no-op (absence
is meaningful); no "measurement slot" (a phase-less slot read by a ratchet —
that moves to the ratchet's inline `run`, see
[ADR 0018](0018-vocabulary-consolidation.md)).

## Consequences

- **Definition-of-done becomes a checklist, and readiness is first-class.** The
  config reads as a declaration of what the project can do, and `agent doctor`
  can report which of the five are wired and whether the install clears a
  minimal bar (test plus at least one static check). This is the foundation an
  `discern audit` would stand on.
- **The config reads like a sentence.** `format = "deno fmt"` replaces a
  three-line, two-concept block. The most common gate —
  format/lint/typecheck/test — is four lines under one header, no scheduling
  boilerplate.
- **The five-name ceiling is deliberate, and a real constraint.** Adding a sixth
  known capability (say `e2e` or `security`) is not a config tweak — it needs a
  new stage mapping in two languages and a deliberate widening of the
  vocabulary, i.e. its own ADR. That friction is the feature: the vocabulary
  stays small and meaningful. A project that wants a sixth thing _today_ uses a
  `[check]`.
- **A migration is owed.** Existing installs carry `[slots]`; a schema 3→4
  migration transforms them (the mechanics and the rest of the vocabulary
  consolidation are [ADR 0018](0018-vocabulary-consolidation.md)). The "upgrade
  ≡ fresh init" convergence test and an idempotent re-run are the guards.
- **The `--json` report changes shape.** Per-result reporting is now keyed by
  job (capability or check), not slot —
  `{name, kind, stage, status, duration_s}`, amending
  [ADR 0004](_superseded/0004-structured-finish-json.md). A no-op gate reports
  an empty `jobs` array rather than a list of `noop` rows; "what ran" replaces
  "what could run."
- **Amends earlier records.** This supersedes the slot/phase _surface_ of
  [ADR 0006](0006-long-slot-ergonomics.md) (the `[gate]` stream/fail_fast
  ergonomics survive untouched); amends
  [ADR 0004](_superseded/0004-structured-finish-json.md) (per-job, not
  per-slot); amends [ADR 0003](0003-named-metric-ratchets.md) (the measurement
  slot it relied on becomes the ratchet's inline `run`). Design principle #1
  ("push every stack fact behind a named slot") is reworded to "a named
  capability" and links here.

## Alternatives considered

- **Keep slots + phases, bolt a readiness report on top.** Rejected: readiness
  over an _open_ set is meaningless. You cannot say "build is absent" when
  "build" was never a known concept, only a string a user might or might not
  have typed. The closed vocabulary is precisely what makes the report possible
  — the report is not a feature you add, it is a property of the model.
- **Open-ended capability names (a `provides` tag on every slot).** Rejected: it
  _adds_ a concept without removing one, working against the goal of fewer
  nouns, and free-text tags fragment (`static-analysis` vs `static_analysis`),
  giving labels but never a checklist.
- **Fold checks into capabilities with a free `stage`.** I.e. let
  `[capabilities]` hold both known names and arbitrary ones, distinguished by
  whether a `stage` is written. Rejected: it re-merges the two concepts the
  split exists to separate — "a known thing whose scheduling I know" vs "a
  custom thing whose scheduling I must state." Two tables (`[capabilities]`
  closed/flat, `[checks]` open/explicit) keep that line crisp and make the
  closed set enumerable.
