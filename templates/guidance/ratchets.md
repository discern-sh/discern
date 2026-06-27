{{#if has_ratchets}}## Quality ratchets

A **ratchet** is a metric held at a `limit` that may only improve versus
`{{main_branch}}` — a floor that may only rise (`up`), or a ceiling that may only
fall (`down`) — so a branch can never loosen it. Ratchets are **slow and
on-demand**, NOT part of `discern finish`: check them before pushing with
**`discern ratchets`**.

**Never loosen one to pass.** A limit loosened versus `{{main_branch}}` is the
regression a ratchet exists to catch — move the *metric* the right way, never the
limit.{{/if}}
