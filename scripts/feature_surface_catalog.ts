/**
 * The live members behind feature-canon `surfaces` claims. The product sets
 * keep their own authorities; this adapter is the one place that binds each
 * surface prefix to that authority, so enrolment guards and typed consumers
 * cannot disagree about what `set:member` values exist.
 */

import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";
import { bundledSkillNames } from "../src/lib/skills.ts";
import type { SurfaceSet } from "./feature_registry.ts";

/** Every live member, grouped by the prefix feature claims use. */
export async function liveFeatureSurfaceMembers(): Promise<
  Readonly<Record<SurfaceSet, readonly string[]>>
> {
  return {
    verb: [...KNOWN_VERBS].sort(),
    job: Object.keys(KNOWN_JOBS),
    stage: STAGES,
    config: Object.keys(configSchema.shape).sort(),
    skill: await bundledSkillNames(),
    agent: AGENT_NAMES,
  };
}
