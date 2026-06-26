{{#if has_ratchets}}## Quality ratchets

A **ratchet** is a number you only ever want to improve — coverage, a size budget,
a lint or type-error count — held at a `limit` (`up` = a floor that may only rise,
`down` = a ceiling that may only fall) compared against `{{main_branch}}`, so a
branch can never loosen it.

Ratchets are **slow and on-demand** — NOT part of `discern finish`. Check them
explicitly before pushing:

- **`discern ratchets`** — run every configured ratchet and fail if any regressed.

**Never loosen to pass.** A limit reported as loosened versus `{{main_branch}}` is
the regression a ratchet exists to catch, not a baseline to reset — move the
*metric* the right way, never the limit.{{/if}}
