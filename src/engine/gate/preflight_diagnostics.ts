/** Actionable diagnostics for the Gate's repository-integrity preflights. */

import type { AdrIndexState } from "../../lib/adr_index.ts";
import type { AdrNumberDuplicate } from "../../lib/adr_numbers.ts";
import {
  gitLsFilesCommand,
  type TrackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifactsHint,
} from "../../lib/agent_gitignore.ts";
import {
  skillsConflictMessage,
  type SkillsDriftEntry,
  type SkillWellformedness,
} from "../../lib/skills.ts";
import {
  DOCS_INTEGRITY_REMEDIES,
  type DocsIntegrityFinding,
  type DocsIntegrityRule,
} from "../../lib/map_integrity.ts";
import { fire, HINTS } from "../../shared/hints.ts";
import type { Diagnostic } from "../../shared/result.ts";
import {
  hasUnsourcedAgentLines,
  type InstructionDriftEntry,
} from "../instruction_render.ts";
import type { TrackedRefreshPlan } from "../tracked_refresh.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";

/** A bounded summary of lines a tracked refresh would remove. */
function driftDiff(entry: InstructionDriftEntry): string {
  const lost = entry.discard?.lines ?? [];
  const shown = lost.slice(0, 12).map((line) => `  + ${line}`);
  if (lost.length > shown.length) {
    shown.push(`  … and ${lost.length - shown.length} more line(s)`);
  }
  const head =
    `${entry.path}: differs from what \`discern refresh\` would write.`;
  return lost.length > 0
    ? `${head}\n  These lines are in the file but not the recompiled output (a refresh removes them):\n${
      shown.join("\n")
    }`
    : `${head}\n  (the file is missing content a refresh would restore.)`;
}

/** Explain stale compiled agent instructions and their authored remedy. */
export async function instructionDiagnostic(
  root: string,
  stale: InstructionDriftEntry[],
): Promise<Diagnostic> {
  const files = stale.map((entry) => entry.path).join(", ");
  const unsourced = hasUnsourcedAgentLines(stale);
  const remedy = unsourced
    ? fire(HINTS["gate-failure-instructions-unsourced"]).text
    : "Run `discern refresh` to regenerate them. If you meant to change the " +
      "instructions, edit your [instructions].sources (e.g. instructions.md) instead — a direct " +
      "edit to a generated file is overwritten on the next refresh.";
  const outputFields = await diagnosticOutputFields(
    root,
    `Agent files are out of date: ${files}.\n${remedy}\n\n` +
      stale.map(driftDiff).join("\n\n"),
  );
  return {
    tool: "instructions",
    severity: "error",
    message: unsourced
      ? `agent file(s) hold lines no instruction source produces: ${files}`
      : `agent file(s) out of date: ${files}`,
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/** Explain every tracked artifact a read-only refresh plan would change. */
export async function trackedRefreshDiagnostic(
  root: string,
  plan: TrackedRefreshPlan,
): Promise<Diagnostic> {
  if (plan.unavailable !== undefined) {
    return {
      tool: "refresh",
      severity: "error",
      message: plan.unavailable,
      reproduce_cmd: "discern releases",
    };
  }
  const paths = plan.changes.map((change) => change.path);
  const details = plan.changes.map((change) => {
    const effects = [
      change.bytesChanged ? "bytes" : undefined,
      change.modeChanged ? "mode" : undefined,
    ].filter((effect): effect is string => effect !== undefined).join(" + ");
    return `  - ${change.path} (${effects}; ${change.kinds.join(" + ")})`;
  });
  const failures = plan.errors.map((error) => `  - ${error}`);
  const outputFields = await diagnosticOutputFields(
    root,
    "Tracked refresh artifacts are not converged. Running `discern refresh` " +
      "would change the tree, so this commit cannot earn a gate Proof.\n\n" +
      (details.length > 0 ? `Planned changes:\n${details.join("\n")}\n` : "") +
      (failures.length > 0
        ? `\nPlanning errors:\n${failures.join("\n")}\n`
        : "") +
      "\nRun `discern refresh`, review and commit the named tracked files, then " +
      "re-run `discern done`.",
  );
  return {
    tool: "refresh",
    severity: "error",
    message: paths.length > 0
      ? `tracked refresh artifacts out of date: ${paths.join(", ")}`
      : "tracked refresh convergence could not be planned",
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/** Explain stale materialized skill directories and their authored remedy. */
export async function skillsDiagnostic(
  root: string,
  blocking: SkillsDriftEntry[],
): Promise<Diagnostic> {
  const stale = blocking.filter((entry) => entry.reason === "stale");
  const conflicts = blocking.filter((entry) => entry.reason === "conflict");
  const dirs = [...new Set(blocking.map((entry) => entry.dir))].join(", ");
  const sections: string[] = [];
  if (stale.length > 0) {
    sections.push(
      `Materialized skills are out of date in: ${
        [...new Set(stale.map((entry) => entry.dir))].join(", ")
      }.\n` +
        "Run `discern refresh` to re-materialize them. If you meant to change a skill, " +
        "edit its source under [skills].dir (or `discern skills eject` a bundled one) — a " +
        "direct edit to a materialized copy is overwritten on the next refresh.\n\n" +
        stale.map((entry) => `  • ${entry.detail}`).join("\n"),
    );
  }
  if (conflicts.length > 0) sections.push(skillsConflictMessage(conflicts));
  const outputFields = await diagnosticOutputFields(
    root,
    sections.join("\n\n"),
  );
  return {
    tool: "skills",
    severity: "error",
    message: conflicts.length === 0
      ? `materialized skills out of date: ${dirs}`
      : `skills directories need attention: ${dirs}`,
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/** Explain malformed skill source frontmatter that refresh cannot repair. */
export async function skillFrontmatterDiagnostic(
  root: string,
  malformed: SkillWellformedness[],
): Promise<Diagnostic> {
  const files = malformed.map((entry) => entry.file).join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `Skill frontmatter that agent runtimes cannot read:\n\n` +
      malformed.map((entry) =>
        `${entry.file}:\n${
          entry.issues.map((issue) => `  • ${issue}`).join("\n")
        }`
      ).join("\n\n") +
      "\n\nEdit each named source file. A SKILL.md opens with a `---`-fenced " +
      "YAML block whose `name:` and `description:` are non-empty strings; " +
      "a value containing `:` must be quoted.",
  );
  return {
    tool: "skill-frontmatter",
    severity: "error",
    message: `invalid SKILL.md frontmatter: ${files}`,
    reproduce_cmd: "discern done",
    ...outputFields,
  };
}

/** Explain duplicated ADR numbers and the manual renumbering remedy. */
export async function adrNumbersDiagnostic(
  root: string,
  dupes: AdrNumberDuplicate[],
): Promise<Diagnostic> {
  const numbers = dupes.map((duplicate) => duplicate.number).join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `ADR numbers claimed by more than one record:\n\n` +
      dupes.map((duplicate) =>
        `${duplicate.number}:\n${
          duplicate.paths.map((path) => `  - ${path}`).join("\n")
        }`
      ).join("\n\n") +
      "\n\nKeep the number on the record that landed first (or the superseded " +
      "record that retired it), and move the newer record to the next free " +
      "number — filename, title, and any references to it.",
  );
  return {
    tool: "adr-numbers",
    severity: "error",
    message: `ADR number(s) claimed by more than one record: ${numbers}`,
    reproduce_cmd: "discern done",
    ...outputFields,
  };
}

/** Turn map and instruction integrity findings into routed diagnostics. */
export async function mapIntegrityDiagnostic(
  root: string,
  findings: DocsIntegrityFinding[],
): Promise<Diagnostic[]> {
  const byRule = new Map<DocsIntegrityRule, DocsIntegrityFinding[]>();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  const sections = [...byRule.entries()].map(([rule, group]) =>
    `${rule}:\n` +
    group.map((finding) =>
      `  ${finding.file}:${finding.line} ${finding.detail}`
    ).join("\n") +
    `\n  fix: ${DOCS_INTEGRITY_REMEDIES[rule]}`
  );
  const outputFields = await diagnosticOutputFields(
    root,
    "The map or instructions references things a reader cannot follow:\n\n" +
      sections.join("\n\n"),
  );
  return findings.map((finding) => ({
    tool: "map-integrity",
    severity: "error",
    message:
      `map or instructions integrity (${finding.rule}): ${finding.detail}`,
    reproduce_cmd: "discern done",
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    ...outputFields,
  }));
}

/** Select the actionable remedy for an invalid maintained ADR index. */
function adrIndexInvalidRemedy(
  state: Extract<AdrIndexState, { kind: "invalid" }>,
): string {
  switch (state.cause) {
    case "record":
      return "Fix the named record file — its first heading must carry the " +
        "record's number and a title — then run `discern refresh`.";
    case "markers":
      return `Repair the marker pair in ${state.path}: restore the missing ` +
        "END marker named above after its BEGIN marker (or remove the pair " +
        "to retire the maintained list). The record files may all be fine. " +
        "Then run `discern refresh`.";
    case "error":
      return "The derivation itself failed. Fix the underlying problem " +
        "reported above, then run `discern refresh`.";
  }
}

/** Turn an ADR index marker or title failure into an actionable diagnostic. */
export async function adrIndexDiagnostic(
  root: string,
  state: Extract<AdrIndexState, { kind: "stale" | "invalid" }>,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
    root,
    state.kind === "stale"
      ? `The maintained ADR index is out of date: ${state.path}.\n` +
        "Run `discern refresh` to regenerate the record lists between its " +
        "markers, and commit the rewritten file. If you meant to change the " +
        "framing prose, edit outside the marked blocks — a refresh rewrites " +
        "only the lists.\n\n" +
        driftDiff({
          path: state.path,
          reason: "stale",
          expected: state.expected,
          actual: state.current,
        })
      : `The maintained ADR index in ${state.path} cannot be derived:\n\n` +
        `  ${state.issue}\n\n` +
        adrIndexInvalidRemedy(state),
  );
  return {
    tool: "adr-index",
    severity: "error",
    message: state.kind === "stale"
      ? `maintained ADR index out of date: ${state.path}`
      : `maintained ADR index cannot be derived: ${state.path}`,
    reproduce_cmd: state.kind === "stale" ? "discern refresh" : "discern done",
    ...outputFields,
  };
}

/** Explain tracked discern-managed artifacts and their repair command. */
export async function trackedArtifactsDiagnostic(
  root: string,
  tracked: TrackedDiscernIgnoredArtifacts,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
    root,
    `${trackedDiscernIgnoredArtifactsHint(tracked).text}\n\n` +
      `Tracked paths:\n${
        tracked.paths.map((path) => `  - ${path}`).join("\n")
      }`,
  );
  return {
    tool: "tracked-artifacts",
    severity: "error",
    message: `discern-managed ignored artifacts are tracked by Git: ${
      tracked.paths.join(", ")
    }`,
    reproduce_cmd: gitLsFilesCommand(tracked.repairTargets),
    ...outputFields,
  };
}
