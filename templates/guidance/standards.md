{{#if has_standards}}## Quality standards

Standards are **numbers that can never get worse**: metrics held at a `limit`
that may only improve versus `{{main_branch}}` — a floor may only rise (`up`),
a ceiling only fall (`down`). Every **`discern_done`** run verifies no limit
loosened versus `{{main_branch}}` and measures each standard alongside the
tests — untouched `inputs` replay the recorded value for free;
`measure = "on-demand"` defers a standard to **`discern_standards`**.

**Never loosen one to pass.** A loosened or deleted limit fails the gate —
that is the standard working. Move the *metric* the right way; lowering a
limit is an owner decision, taken on the trunk.{{/if}}
