{{#if has_standards}}## Quality standards

Standards protect measured limits: minimums may rise and maximums may fall. **`discern_done`** checks the required standards; **`discern_standards`** measures them separately.

**Never loosen or delete a limit to make a change pass.** Investigate the measured regression and try reasonable remedies within the authorized task. If satisfying the requested outcome requires changing a limit, explain the evidence, alternatives, and recommendation to the owner.

After owner agreement and the final ordinary commit, call **`discern_standards`** with `action: "propose"` and all simultaneously approved breaches in one `proposals` array. Give technical reasons, not authority claims. Changed values or reasons need fresh agreement; landing permission does not approve limits.

When a measure improves, offer to preserve the gain by tightening its limit through **`discern_standards`** with `pin`.{{else}}## Quality standards

No quality standards yet.{{#if has_skill_discern_set_the_standard}} When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.{{/if}}{{/if}}
