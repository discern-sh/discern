/** Live carrier choices shared by the Practice Canon guard and Canon Editor. */

import { bundledSkillNames } from "../src/lib/skills.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import { KNOWN_VERBS } from "../src/shared/verbs.ts";

/** The live set one practice carrier belongs to. */
export type PracticeCarrierSet = "verb" | "config" | "skill";

/** One carrier key and the live authority that owns its member. */
export interface PracticeCarrier {
  readonly key: string;
  readonly set: PracticeCarrierSet;
  readonly member: string;
}

/** The tier-compatible carrier catalog. */
export interface PracticeCarrierCatalog {
  /** Boundaries and machinery: verbs and top-level config sections. */
  readonly enforcement: readonly PracticeCarrier[];
  /** Teaching carriers: bundled skills only. */
  readonly teaching: readonly PracticeCarrier[];
}

/** Prefix one live set's members exactly as Practice Canon citations do. */
function carriers(
  set: PracticeCarrierSet,
  members: readonly string[],
): PracticeCarrier[] {
  return members.map((member) => ({ key: `${set}:${member}`, set, member }));
}

/** Build the carrier tiers from the same live authorities the guard enforces. */
export async function buildPracticeCarrierCatalog(): Promise<
  PracticeCarrierCatalog
> {
  return {
    enforcement: [
      ...carriers("verb", [...KNOWN_VERBS].toSorted()),
      ...carriers("config", Object.keys(configSchema.shape).toSorted()),
    ],
    teaching: carriers("skill", (await bundledSkillNames()).toSorted()),
  };
}
