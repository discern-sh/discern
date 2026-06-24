{{#if has_ratchets}}## Quality ratchets

A **ratchet** is a number you only ever want to improve — line coverage, a
bundle-size budget, a lint/type-error count. Each `[ratchets.<name>]` in
`discern.toml` declares one: a `run` command that emits the metric, a `direction`
(`up` = a floor that may only rise, `down` = a ceiling that may only fall), and a
`limit` compared against `{{main_branch}}` so a branch can never loosen it.

Ratchets are **slow and on-demand** — they are NOT part of `discern finish`. Hold
them explicitly before pushing:

- **`discern ratchets`** — run every configured ratchet and fail if any regressed.

When you make a change that moves a ratcheted metric the good way, tighten the
`limit` in `discern.toml` to lock the gain in.{{/if}}
