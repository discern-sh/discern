# ADR 0053: A gate guard keeps comments in the present tense, not narrating the codebase's past

**Status**: accepted; applies the
[ADR 0049](0049-bug-class-discipline-built-in.md) fix-the-class discipline to a
prose convention, and is the comment-side analogue of the retired-token guard in
`tests/dev_vocab_guard_test.ts`. Reconciled with — and bounded by —
[ADR 0051](0051-canonical-set-parity.md)'s "no denylist" stance (see
_Reconciling_ below).

## Context

The project asks that a comment describe what the code does **now**; history
belongs in `docs/` and ADRs
([design principle §2](../00-orientation/design-principles.md)). The rule had
only a _plea_ behind it — a line of guidance — and the plea kept getting
bypassed. Coding agents especially reflexively narrate the change they just
made: fixing a bug or moving a feature, they leave "it **used to** X; now Y",
"**replaces the old** shell dispatcher", "**before the** single-binary refactor
this was duplicated".

A survey of `src/` found ~50 such comments, almost all archaeology from two
refactors — the single-binary cutover
([ADR 0019](0019-single-binary-ts-engine.md)) and the `.discern/` dissolution
([ADR 0020](0020-dissolve-discern-dir.md)). Each describes the present code by
pointing at a predecessor — a shell function, a `manifest.json`, a hidden
directory — that **no longer exists in the tree**, so a reader cannot resolve
the reference. The comment is dead weight at best, misleading at worst.

A plea has no teeth: it relies on every author, human or agent, remembering it
at write time. That is precisely the rot
[ADR 0049](0049-bug-class-discipline-built-in.md) forbids — a convention with no
forcing function decays silently, and the decay is invisible because each
instance reads plausibly on its own.

## Decision

Enforce the convention with a tree-walking architectural test,
`tests/comment_currency_test.ts`, that **fails the gate** when a comment in
discern's code or its shipped config narrates the codebase's past. The class is
a checkable predicate, not a plea.

- **Predicate.** A curated set of _retrospective markers_ — general tense/aspect
  phrases (`used to`, `previously`, `formerly`, `the old`, `originally`, …) plus
  discern's _retired-architecture_ nouns (`shell engine`,
  `single-binary
  refactor`, …) — matched **only inside comments**. A marker in
  a string literal, an identifier, or running code is left alone.
- **Source of truth = the live tree.** The test walks the scanned trees, so a
  new file auto-enrols with nothing to remember. The marker list is the _rule
  definition_, not a member list to keep in sync.
- **Precision over recall, deliberately.** A predicate over prose cannot be
  exact. It is tuned for **few false positives** so the guard stays trusted, at
  the cost of recall: a backward-looking comment that uses none of the markers
  slips through. The residual is stated in the test header, not hidden.
- **Benign live-state words are NOT banned.** `legacy <path>`,
  `no longer
  exists`, `before the loop` overwhelmingly describe a
  compatibility layer the code still reads, a runtime condition, or ordering —
  current behaviour. Banning them would be chronic noise; the few
  genuinely-historical members were reworded by hand instead.
- **A reasoned escape hatch.** `discern-allow-retrospective: <reason>` on a
  comment exempts it; the reason is mandatory and lands in the diff, so every
  exception is visible and justified at review. The default is to reword — in
  the end the cleanup needed **zero** suppressions.
- **Scope = the places a stale reference reaches a reader cold.** The TypeScript
  under `src/` and `scripts/`, plus the `#`-comment surface of the shipped
  config (`templates/discern.toml.tmpl`, the gitignore fragment) and this repo's
  own root `discern.toml` — the config a prospective user reads first. Out of
  scope by design, because narrating the past is correct there: `tests/` (they
  narrate the past they guard against), `docs/` prose and `templates/`
  guidance/skills (documenting history, ADR lifecycle, and troubleshooting
  symptoms), and ADRs. The config surface was added after main's
  worktree-placement change leaked "restores the old nesting" into the shipped
  template — a regression the `src/`-only guard could not see.

### Reconciling with ADR 0051's "no denylist"

[ADR 0051](0051-canonical-set-parity.md) is emphatic that a canonical-set tie
must be applied _at the source_, **not** as "a lint rule that bans domain words
… [which] just relocates the same vocabulary into tracked test history". This
guard _is_ a banned-phrase list, so the tension is real and worth meeting
head-on. It is the **legitimate exception**, for three reasons:

1. **There is no canonical source to derive from.** ADR 0051 governs _closed
   vocabularies with a single source_ (verbs, capabilities, agents) whose
   satellites should auto-enrol. English tense has no registry. The defect here
   is a _prose pattern_, and the only structural expression of a prose pattern
   is a predicate over the prose. The part that _can_ be derived — the set of
   files scanned — **is** derived (the tree walks plus the listed config files).
2. **The list is the rule, not relocated content.** ADR 0051's worry is that
   banning _domain words_ shoves the vocabulary you want to keep generic into
   test history, achieving nothing structural. Here the markers are not content
   we are trying to erase from the universe — they are the _definition_ of the
   predicate, exactly as `dev_vocab_guard_test.ts` already lists the retired
   command tokens (`selfsync`, `selfcheck`) it forbids. This guard is that
   accepted pattern, applied to comments.
3. **It lives in the repo's own tests, never in `templates/`.** The shipped
   surface stays generic; the discern-specific marker vocabulary is confined to
   this repo's gate, like every other self-host guard.

The explicit _no_: this is **not** a new gate stage (it is a test under the
existing test stage) and **not** a blanket word ban (it is comment-scoped,
precision-tuned, and escapable with a reason).

### Alternative considered

A **`deno lint` plugin** would run in the existing check stage and get
AST-attached comments directly. Rejected in favour of an architectural test:
self-contained, trivially self-tested (nine cases pin the detector's own
contract — string skipping, `#` and `//` extraction, wrap detection, both
suppression cases), and consistent with the house pattern
(`dev_vocab_guard_test.ts`, `agent_agnostic_test.ts`). The comment extractor is
a ~40-line scanner that skips string and template bodies so a `//` inside a URL
is never read as a comment.

## Consequences

- **The ~50 existing instances are gone.** Each was reworded to present tense,
  or — where a constraint was real — re-anchored to something durable (a live
  parity fixture, an ADR) instead of a comparison to deleted code.
- **The lesson lands at the moment of the mistake.** A future backward-looking
  comment fails `finish` with a message naming the marker and the escape hatch,
  teaching the author — including one who never read the guidance — then and
  there. This is the structural answer to "context instructions keep getting
  bypassed".
- **Recall is bounded, on purpose.** A sufficiently creative backward reference
  with none of the markers passes. The guard catches the overwhelming common
  case (and all of discern's retired-architecture vocabulary) and is widened by
  adding a marker when a new evasion appears — the same way `dev_vocab_guard`'s
  token list grows.
- **A small standing cost.** The marker list is hand-curated and will
  occasionally want a new entry or a precision tweak, and a used escape hatch
  must be reviewed. Cheap relative to the alternative — comment-rot no reviewer
  reliably catches.
