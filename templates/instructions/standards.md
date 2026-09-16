{{#if has_standards}}## Quality standards

Standards protect measured limits: minimums may rise and maximums may fall. **`discern_done`** checks the required standards; **`discern_standards`** measures them separately.

**Never loosen or delete a limit to make a change pass.** Investigate the measured regression and try reasonable remedies within the authorized task. If satisfying the requested outcome requires changing a limit, explain the evidence, alternatives, and recommendation to the owner.

After owner agreement, complete every required preview, review, regeneration, edit, **`discern_prepare`** run, and ordinary commit. Then call **`discern_standards`** with `action: "propose"` and every simultaneously approved breach in one `proposals` array. Each reason is technical justification only; it must not claim approval, consent, or landing authority. A changed value or reason is a different decision that needs fresh owner agreement. General permission to land does not approve a standard-limit change.

When a measure improves, offer to preserve the gain by tightening its limit through **`discern_standards`** with `pin`.{{else}}## Quality standards

No quality standards yet.{{#if has_skill_discern_set_the_standard}} When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.{{/if}}{{/if}}
