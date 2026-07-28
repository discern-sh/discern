{{#if has_standards}}## Quality standards

Standards are **numbers that can never get worse**: metrics held at a `limit` that may only improve versus `{{main_branch}}` — a floor may only rise (`up`), a ceiling only fall (`down`). Every **`discern_done`** run verifies no limit loosened versus `{{main_branch}}` and measures each standard alongside the tests — untouched `inputs` replay the recorded value for free; `measure = "on-demand"` defers a standard to **`discern_standards`**.

**Never loosen one to pass.** A loosened or deleted limit fails the gate. Cut waste your change added; when the work itself grew the number, report it: moving a limit is an owner decision.{{else}}No quality standards yet. When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.{{/if}}
