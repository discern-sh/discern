# ADR 0012: Run the engine under `set -f` (noglob) by default

**Status**: accepted

## Context

`changed-scopes` classifies changed paths against the `[scopes]` globs by
word-splitting each scope's patterns out of `config_array` in an unquoted `for`
loop:

```sh
for _ms_pat in $(config_array "scopes.$_ms_key"); do
```

Under POSIX `sh` (and bash, and dash) an unquoted expansion is subject to BOTH
word-splitting **and** pathname expansion. So when the gate runs from the repo
root and a scope pattern like `app/**` matches real directories, the shell
expands the pattern against the working tree before `path_matches_pattern` ever
sees it: `app/**` becomes `app/StarterVision app/bin …`, the literal pattern is
lost, and a nested change (`app/StarterVision/Scene/Foo.swift`) matches nothing.
The result was a **silent** gate defect — a custom side-gate (a native sub-app's
build/test) simply never fired for ordinary nested source. zsh, the default
macOS interactive shell, does not pathname-expand `$(…)` results, so the bug was
invisible to anyone testing by hand in a terminal.

The local fix was `set -f` in that one recipe. But the hazard is structural, not
local: any recipe that word-splits config values is one unquoted expansion away
from the same bug, and shellcheck does **not** flag the `for x in $(cmd)` form
(it treats the splitting as intentional), so the linter cannot guard it.

An audit confirmed that **no engine recipe relies on filesystem globbing** —
every unquoted split iterates over names (slot, scope, agent names) that carry
no glob metacharacters, and there is no `for f in *.x` or `rm dir/*` anywhere in
the engine.

## Decision

Disable pathname expansion engine-wide: `lib/bootstrap.sh` — sourced first by
every recipe — runs `set -f`. Globbing is off for the whole engine by default.

- A recipe that genuinely needs a glob opts back in locally with `set +f` around
  the specific expansion (none do today).
- `set -f` touches only filename generation; `case` pattern-matching and `${…}`
  parameter expansion, which the recipes rely on, are unaffected.
- `changed-scopes` keeps its own `set -f` as documented defense-in-depth at the
  highest-risk site.

This sits alongside two complementary measures that landed with it: a shellcheck
`check` slot (catches the broad class of quoting bugs, though not the `for`-loop
split), and a CI matrix that runs the engine tests under both dash and bash
(catches shell-specific behaviour the default runner misses — the check that
actually reproduces this bug class).

## Consequences

- The whole class of "an unquoted config split silently globs" is structurally
  impossible in any recipe, present or future — not merely discouraged.
- The cost is mild action-at-a-distance: globbing is off via a sourced lib, not
  visible in the recipe itself. The failure mode for an author who expects a
  glob is **loud** (the loop iterates the literal pattern once, so the feature
  visibly does nothing), unlike the silent bug this prevents. The bootstrap
  comment and this ADR document the rule; `set +f` is the escape hatch.
- User recipes under `.icculus/recipes/` that source bootstrap inherit noglob
  too. This is intended — they run in the engine's environment — and documented.

## Alternatives considered

- **Per-recipe `set -f` at each split site.** Smaller blast radius, but it fails
  the "prevent it going forward" goal: a new recipe that forgets it reintroduces
  the bug, and nothing enforces the habit (shellcheck won't).
- **Documentation only — a house rule with no code.** Weakest: relies on every
  author and reviewer remembering an invisible rule. We kept the rule but backed
  it structurally.
- **Rewrite every split to avoid word-splitting** (e.g. `while read` over a temp
  file). More invasive, and still unenforced against the next author. `set -f`
  is one line and total.
