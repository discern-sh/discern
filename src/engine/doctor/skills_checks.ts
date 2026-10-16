/**
 * Skill diagnostics for `discern doctor`, all read-only:
 *  - authored skills: how many `[skills].dir` holds, and one warning per link
 *    discern refuses to follow; the enumeration is the skills module's own;
 *  - provider skills directories: shared with other tools, so Git's ignore
 *    rules must hide exactly the entries discern's ownership record names
 *    (ADR 0425). A foreign entry an ignore rule hides never reaches a fresh
 *    clone or worktree; a discern entry no rule covers shows up as untracked
 *    work.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { resolveSkillsDir } from "../../lib/paths.ts";
import { scanAuthoredSkills } from "../../lib/skills.ts";
import {
  skillsIgnorePosture,
  surveySkillsDirs,
} from "../../lib/skill_ownership.ts";
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

const SKILLS_DIRECTORIES = "skills directories";

/** Compare Git's ignore verdicts with entry ownership in every skills directory
 * present; empty when there is none, or outside a Git repository, where Git
 * cannot answer. */
export async function skillsDirectoryChecks(
  root: string,
): Promise<DoctorDraftCheck[]> {
  const surveys = await surveySkillsDirs(root);
  if (surveys.length === 0) return [];
  const posture = await skillsIgnorePosture(root, surveys);
  if (posture === undefined) return [];
  const { hiddenForeign, visibleOwned } = posture;
  if (hiddenForeign.length === 0 && visibleOwned.length === 0) {
    const owned = surveys.reduce((n, survey) => n + survey.owned.length, 0);
    const foreign = surveys.reduce((n, survey) => n + survey.foreign.length, 0);
    return [{
      name: SKILLS_DIRECTORIES,
      ok: true,
      detail: `${owned} materialized skill(s) ignored; ${foreign} other entr${
        foreign === 1 ? "y" : "ies"
      } left visible to Git`,
    }];
  }
  const problems = hiddenForeign.map(({ path, rule }) =>
    `${path} is not discern's, but Git ignores it (${rule})`
  );
  const fixes: string[] = [];
  if (hiddenForeign.length > 0) {
    fixes.push(
      "if the matching rule is inside discern's .gitignore block, run `discern upgrade` to retire it; otherwise narrow that rule to the paths you mean to ignore, so other tools' skills reach fresh clones and worktrees",
    );
  }
  if (visibleOwned.length > 0) {
    problems.push(
      `discern's ${visibleOwned.join(", ")} ${
        visibleOwned.length === 1 ? "is" : "are"
      } not ignored`,
    );
    fixes.push(
      "run `discern refresh` to restore the ignore file beside discern's skills",
    );
  }
  return [{
    name: SKILLS_DIRECTORIES,
    ok: true,
    warn: true,
    detail: problems.join("; "),
    fix: fixes.join("; "),
  }];
}
