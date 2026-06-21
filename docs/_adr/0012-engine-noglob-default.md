# ADR 0012: Run the engine under `set -f` (noglob) by default

**Status**: accepted; **retired by [ADR 0019](0019-single-binary-ts-engine.md)**
— see _Update (single-binary cutover)_ below.

## Update (single-binary cutover)

The single-binary cutover ([ADR 0019](0019-single-binary-ts-engine.md)) makes
the engine TypeScript, not shell. Scope glob classification is in-memory in
[`src/engine/scopes/glob.ts`](../../src/engine/scopes/glob.ts), so there is no
unquoted shell word-splitting to guard. `set -f` and the `DISCERN_ENGINE_RECIPE`
marker are gone; a project recipe is just an executable with normal shell
globbing.

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

Disable pathname expansion for engine recipes: `lib/bootstrap.sh` — sourced
first by every recipe — runs `set -f`, gated on the `DISCERN_ENGINE_RECIPE`
marker that `bin/agent` sets per dispatch (`1` for an engine recipe, `0` for a
project recipe). Globbing is off for every engine recipe by default; project
recipes that merely source the library keep normal globbing (see Refinement).

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
  impossible in any engine recipe, present or future — not merely discouraged.
- The cost is mild action-at-a-distance: globbing is off via a sourced lib, not
  visible in the recipe itself. The failure mode for an author who expects a
  glob is **loud** (the loop iterates the literal pattern once, so the feature
  visibly does nothing), unlike the silent bug this prevents. The bootstrap
  comment and this ADR document the rule; `set +f` is the escape hatch.
- Project recipes under `.discern/recipes/` are NOT subject to noglob: they
  source bootstrap for its helpers, not to inherit engine shell policy, so they
  keep normal globbing. `bootstrap.sh` stays a stable contract for recipe
  authors (it provides the library; it does not impose shell modes). See
  Refinement.

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

## Refinement (2026-06-17)

The first implementation put `set -f` unconditionally in `bootstrap.sh`. Because
project recipes also source bootstrap (for `config_get`, `info`, `die`, …), they
inherited noglob too — and on the next `discern upgrade`, a downstream project's
custom recipe that used `ls "$dir"/*.xcodeproj` silently matched nothing. That
was a breaking change to the recipe-authoring contract, leaked through a shared
file.

Fix: scope the policy to engine recipes. `bin/agent` exports
`DISCERN_ENGINE_RECIPE=1` before dispatching an engine recipe and `=0` before a
project recipe; `bootstrap.sh` runs `set -f` only when the marker is `1`. Engine
recipes keep the structural guarantee above; project recipes keep normal
globbing. The lesson generalises: `bootstrap.sh` is a contract surface shared
with user recipes, so engine-internal shell policy belongs **scoped to the
engine**, not imposed on everyone who sources the library.

## Refinement 2 (2026-06-17): the audit missed `guidelines`

The audit above — "no engine recipe relies on filesystem globbing" — was wrong
by one recipe. `guidelines` globs twice: `.ai/guidelines/*.md` (its sources) and
`.ai/skills/*` (the skill directories it links into `.claude/skills/`). Under
the new noglob default both patterns stayed literal, so `guidelines` collected
zero sources and `die`d "no sources" _before_ it reached the skill-linking step.

The user-visible damage was indirect but real. `.claude/skills/` is git-ignored
and regenerated by `guidelines`, which the worktree-create hook runs for every
new worktree. With `guidelines` broken, a freshly-created worktree got no
`.claude/skills/` symlinks, so the coding agent could discover no bundled skill
there (e.g. `handoff-worktree`). The main checkout kept working only because it
still held symlinks from an earlier, pre-noglob run.

Two gaps let it ship green:

- **No test exercised `guidelines`.** The engine suite shelled out to `--help`,
  `finish`, `doctor`, and the worktree token recipes, but never ran
  `agent guidelines` or asserted that a skill symlink resolved. The one recipe
  that relied on globbing had zero execution coverage when noglob landed.
- **The gate does not run `guidelines`.** Despite a stale comment in the recipe
  calling it "the first step of the gate," `finish` never invokes it — so
  `./bin/agent finish` could not have caught the breakage.

Fix:

- `guidelines` opts back into globbing locally with `set +f`/`set -f` around
  each of its two glob loops — the escape hatch this ADR already sanctions — and
  the stale "first step of the gate" comment is corrected.
- The recipe's two jobs (compile agent files; link skills) are decoupled:
  skill-linking now runs even when there are no guideline sources, so a
  missing/empty `.ai/guidelines/` can no longer take out skill discovery.
- `tests/engine_guidelines_test.ts` runs `agent guidelines` through the real
  dispatcher (marker set → noglob active) and asserts both jobs — agent files
  compiled and `.claude/skills/<skill>` resolving — in CI's dash/bash matrix. It
  fails on the pre-fix recipe, so this regression class cannot return silently.

The lesson sharpens the original: a blanket `set -f` is safe only if the audit
behind it is exhaustive **and** enforced. Here the audit was a one-time human
pass with no test behind it, and the recipe it missed had no coverage. The
durable guard is not a more careful audit — it is execution coverage for every
engine recipe that globs.
