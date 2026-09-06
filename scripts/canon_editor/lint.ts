/**
 * The as-you-type register lint: the same judgments the gate delivers minutes
 * after an edit, delivered at the keystroke. Retired synonyms come from the
 * glossary's own patterns, the plain register's jargon scan from the policed
 * terms, the grade from the standard's own arithmetic — and, on a pause, Vale
 * through `scripts/vale_lib.ts`, the repository's one sanctioned Vale spawn
 * site, against a probe path chosen so the register's real section styles
 * apply.
 */

import { dirname, join } from "@std/path";
import type { LintPattern } from "./snapshot.ts";
import type { ProseFieldRegister } from "./fields.ts";
import { countProse, fleschKincaidGrade } from "../plain_reading_grade_lib.ts";
import { decodeValeReport, type ValeReport } from "../prose_lib.ts";
import { runVale } from "../vale_lib.ts";
import { withToolTempDir } from "../temp_dir.ts";

/** One live finding under the editor. */
export interface LintFinding {
  readonly rule: string;
  readonly message: string;
  readonly severity: "error" | "warning" | "suggestion";
  /** Offsets into the field text, when the rule can place itself. */
  readonly start?: number;
  readonly end?: number;
}

/** The whole live report for one field text. */
export interface LintReport {
  readonly findings: readonly LintFinding[];
  /** The field text's own reading grade, shown for plain-register fields. */
  readonly grade?: number;
}

/** The serialized patterns the fast rules run on. */
export interface LintRules {
  readonly retired: readonly LintPattern[];
  readonly plainPoliced: readonly LintPattern[];
}

/** Blank out code spans in place, keeping every offset stable. */
export function blankCodeSpans(text: string): string {
  return text.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
}

/** Run one serialized pattern set over code-blanked text. */
function patternFindings(
  text: string,
  patterns: readonly LintPattern[],
  rule: string,
  message: (pattern: LintPattern) => string,
): LintFinding[] {
  const scannable = blankCodeSpans(text);
  const findings: LintFinding[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    for (const match of scannable.matchAll(new RegExp(pattern.source, flags))) {
      findings.push({
        rule,
        message: message(pattern),
        severity: "warning",
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return findings;
}

/** The keystroke-fast rules: retired synonyms, and plain-register jargon. */
export function lintFieldText(
  rules: LintRules,
  register: ProseFieldRegister,
  text: string,
): LintReport {
  const findings: LintFinding[] = patternFindings(
    text,
    rules.retired,
    "retired-synonym",
    (pattern) => `“${pattern.name}” is retired — canonical: ${pattern.plain}`,
  );
  if (register === "plain") {
    findings.push(
      ...patternFindings(
        text,
        rules.plainPoliced,
        "plain-jargon",
        (pattern) =>
          `“${pattern.name}” stays out of the plain register — say “${pattern.plain}”`,
      ),
    );
    const counts = countProse(text);
    if (counts.words > 0) {
      return { findings, grade: fleschKincaidGrade(counts) };
    }
  }
  return { findings };
}

/** Relative staged path that selects the register's real section styles. */
export function valeProbePath(register: ProseFieldRegister): string {
  return register === "brand"
    ? join(".scratch", "canon-editor", "vale", "_internal", "brand", "probe.md")
    : join(".scratch", "canon-editor", "vale", "probe.md");
}

/**
 * The on-pause tier: run Vale over the field text alone. The probe file's
 * path picks the section styles the field's committed page would get, and a
 * broken Vale toolchain surfaces as one suggestion instead of a dead editor.
 */
export async function valeFindings(
  root: string,
  register: ProseFieldRegister,
  text: string,
): Promise<LintFinding[]> {
  let output: Deno.CommandOutput;
  try {
    output = await withToolTempDir("canon-editor-prose", async (directory) => {
      const path = join(directory, valeProbePath(register));
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, `${text}\n`);
      return await runVale(root, ["--output=JSON", path]);
    });
  } catch (error) {
    return [{
      rule: "vale",
      message: error instanceof Error ? error.message : String(error),
      severity: "suggestion",
    }];
  }
  let parsed: ValeReport;
  try {
    parsed = decodeValeReport(
      new TextDecoder().decode(output.stdout),
      `Vale output for Canon Editor ${register} prose`,
    );
  } catch (error) {
    return [{
      rule: "vale",
      message: error instanceof Error ? error.message : String(error),
      severity: "suggestion",
    }];
  }
  const findings: LintFinding[] = [];
  for (const alerts of Object.values(parsed)) {
    for (const alert of alerts) {
      const severity = alert.Severity === "error"
        ? "error"
        : alert.Severity === "warning"
        ? "warning"
        : "suggestion";
      const span = alert.Span;
      findings.push({
        rule: alert.Check ?? "vale",
        message: alert.Message ?? "style finding",
        severity,
        ...(span === undefined || alert.Line !== 1
          ? {}
          : { start: span[0] - 1, end: span[1] }),
      });
    }
  }
  return findings;
}
