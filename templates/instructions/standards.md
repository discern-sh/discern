{{#if has_standards}}## Quality standards

Standards are **numbers that can never get worse**: metrics held at a `limit` that may only improve versus `{{main_branch}}` — a floor may only rise (`up`), a ceiling only fall (`down`). Every **`discern_done`** run verifies no limit loosened versus `{{main_branch}}` and measures each standard alongside the tests — untouched `inputs` replay the recorded value for free; `measure = "on-demand"` defers a standard to **`discern_standards`**.

**Never loosen one to pass.** A loosened or deleted limit fails the gate. Each limit records ground some past change earned. Cut waste your change added; when the work itself grew the number, report it: moving a limit is an owner decision.

When the owner agrees to propose a new limit, finish and commit the intended tree first. Proposal creation is a finalization step: call **`discern_standards_propose`** once on that clean `HEAD`. It measures only the named Standard before creating the config-only proposal commit. If later required work creates a descendant while the proposal tuple and measurement stay unchanged, repeat the same proposal command to renew its evidence binding without another commit. Do not create and undo proposal commits while implementation is still moving.

When your change _improves_ a measure, the result hints you to offer to lock in the gain. `discern_standards` with `pin` tightens the limit to the measured value and commits that change on its own, so today's gain becomes the baseline every later branch inherits.{{else}}## Quality standards

No quality standards yet. When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.{{/if}}
