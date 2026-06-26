{{#if has_ratchets}}## Quality ratchets

A **ratchet** is a number you only ever want to improve — line coverage, a
size budget, a lint or type-error count. Each `[ratchets.<name>]` in
`discern.toml` declares one: a `run` command that emits the metric, a `direction`
(`up` = a floor that may only rise, `down` = a ceiling that may only fall), and a
`limit` compared against `{{main_branch}}` so a branch can never loosen it.

Ratchets are **slow and on-demand** — they are NOT part of `discern finish`. Check
them explicitly before pushing:

- **`discern ratchets`** — run every configured ratchet and fail if any regressed.

**Ratchet a rate, not a raw count.** Ask: does this number grow as the project
grows — more files, more code, more docs — *even when nothing got worse*? Then a
raw count fails on growth rather than on regressions, and the only way to pass is
to loosen it. Add **`per`** to divide by the size and ratchet the *rate* instead —
e.g. `per = { words = "docs/**" }` ratchets alerts-per-word, with discern counting
the words itself (`files` | `lines` | `words` | `bytes` over a git pathspec, or the
name of a second metric your `run` emits; `scale` puts the limit in human units).
Ratchet a count raw only when it is a true budget that does *not* scale with size,
like shipped bytes.

**Never loosen to pass.** A limit reported as loosened versus `{{main_branch}}` is
the regression a ratchet exists to catch, not a baseline to reset — move the
*metric* the right way, never the limit. When a change genuinely improves the
metric, tighten the `limit` to lock the gain in.{{/if}}
