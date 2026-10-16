/**
 * `discern doctor`'s skills-directory check (ADR 0425).
 *
 * A provider skills directory is shared with other tools, so Git's ignore rules
 * must hide exactly the entries discern's ownership record names. A foreign
 * entry an ignore rule hides never reaches a fresh clone or worktree; a discern
 * entry no rule covers shows up as untracked work. Read-only.
 */

import {
  skillsIgnorePosture,
  surveySkillsDirs,
} from "../../lib/skill_ownership.ts";
import type { DoctorDraftCheck } from "./completion_checks.ts";

const NAME = "skills directories";

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
      name: NAME,
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
    name: NAME,
    ok: true,
    warn: true,
    detail: problems.join("; "),
    fix: fixes.join("; "),
  }];
}
