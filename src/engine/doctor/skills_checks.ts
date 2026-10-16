/**
 * Authored-skill diagnostics for `discern doctor`: how many authored skills
 * `[skills].dir` holds, and one warning per link discern refuses to follow.
 * Read-only; the enumeration is the skills module's own.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { resolveSkillsDir } from "../../lib/paths.ts";
import { scanAuthoredSkills } from "../../lib/skills.ts";
import type { DoctorDraftCheck } from "./completion_checks.ts";

/** The `skills` count check, then a `skill link` warning per refused link. */
export async function skillsDoctorChecks(
  root: string,
  config: DiscernConfig,
): Promise<DoctorDraftCheck[]> {
  const { rel } = resolveSkillsDir(root, config);
  const { skills, linkIssues } = await scanAuthoredSkills(root, config);
  return [
    {
      name: "skills",
      ok: true,
      detail: skills.length === 0
        ? `no authored skills in ${rel}/ yet (built-ins still apply)`
        : `${skills.length} authored skill(s) in ${rel}/`,
    },
    // A refused link leaves its skill unmaterialized; warn, never fail, so a
    // deliberate out-of-project link cannot block setup.
    ...linkIssues.map((issue): DoctorDraftCheck => ({
      name: `skill link: ${issue.name}`,
      ok: true,
      status: "warn",
      detail: issue.message,
      fix:
        `replace ${issue.path} with a relative link to a skill directory inside the project, or with the skill directory itself`,
    })),
  ];
}
