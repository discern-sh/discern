{{#if has_standards}}## Quality standards

Standards are **numbers that can never get worse**: metrics held at a `limit`
that may only improve versus `{{main_branch}}` — a floor that may only rise
(`up`), or a ceiling that may only fall (`down`) — so a branch can never loosen
one. Standards are **slow and
on-demand**, NOT part of `discern_done`: run **`discern_standards`** as needed.
Non-dry-run standards require a clean worktree, with a force override reserved for
standard authoring or debugging.

**Never loosen one to pass.** A limit loosened versus `{{main_branch}}` is the
regression a standard exists to catch — move the *metric* the right way, never the
limit.{{/if}}
