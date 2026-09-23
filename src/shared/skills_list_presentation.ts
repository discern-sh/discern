/** Renderer-neutral lines for `discern skills list` results. */

import { code, plural, text } from "./result_markdown_values.ts";

/** The listing's summary sentence and one line per skill. */
export interface SkillsListLines {
  readonly summary: string;
  readonly lines: readonly string[];
}

/**
 * Describe every listed skill, as the terminal listing does: excluded skills
 * and project skills that override a bundled one carry a marker.
 */
export function skillsListLines(
  skills: readonly Record<string, unknown>[],
): SkillsListLines {
  const excluded = skills.filter((skill) => skill.excluded === true).length;
  const counted = `Found ${
    plural(skills.length - excluded, "effective skill")
  }`;
  return {
    summary: excluded === 0
      ? `${counted}.`
      : `${counted} and ${excluded} excluded by \`[skills].exclude\`.`,
    lines: skills.map(skillLine),
  };
}

/** One skill's name, source, and any markers. */
function skillLine(skill: Record<string, unknown>): string {
  const notes: string[] = [];
  if (skill.overrides_bundled === true) {
    notes.push("overrides the bundled skill");
  }
  if (skill.excluded === true) notes.push("excluded by `[skills].exclude`");
  const suffix = notes.length === 0 ? "" : `, ${notes.join(", ")}`;
  return `${code(text(skill.name) ?? "unknown")}: ${
    text(skill.source) ?? "unknown"
  }${suffix}.`;
}
