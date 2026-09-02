/**
 * Parse the authored launch lock-down audit and render its compact findings
 * index. The audit remains the only authority; `deno task codegen` writes the
 * committed summary from this projection.
 */

import { markdownCodeSpan } from "../src/shared/markdown_code.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";

export const LAUNCH_LOCKDOWN_AUDIT_REL =
  "project/map/_private/planning/launch-lockdown-audit.md";
export const LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL =
  "project/map/_private/planning/launch-lockdown-audit-summary.md";

const SEVERITIES = ["High", "Medium", "Low"] as const;

export type LaunchAuditSeverity = (typeof SEVERITIES)[number];
export type LaunchAuditReview =
  | "confirmed"
  | "partially confirmed"
  | "mixed skeptic verdict"
  | "unverified";

export interface LaunchAuditFindingSummary {
  readonly id: string;
  readonly title: string;
  readonly severity: LaunchAuditSeverity;
  readonly findingClass: string;
  readonly surface: string;
  readonly review: LaunchAuditReview;
  readonly freezesAtTag: boolean;
  readonly batches: readonly string[];
  readonly completion?: string;
}

export interface LaunchAuditBatchSummary {
  readonly id: string;
  readonly title: string;
  readonly findingIds: readonly string[];
}

export interface LaunchAuditRefutedSummary {
  readonly id: string;
  readonly title: string;
}

export interface LaunchAuditSummary {
  readonly provenance: string;
  readonly findings: readonly LaunchAuditFindingSummary[];
  readonly batches: readonly LaunchAuditBatchSummary[];
  readonly refuted: readonly LaunchAuditRefutedSummary[];
}

interface FindingWithoutBatches {
  readonly id: string;
  readonly title: string;
  readonly severity: LaunchAuditSeverity;
  readonly findingClass: string;
  readonly surface: string;
  readonly review: LaunchAuditReview;
  readonly freezesAtTag: boolean;
  readonly completion?: string;
}

interface NumberedSourceLine {
  readonly index: number;
  readonly number: number;
  readonly text: string;
}

/** Refuse a malformed source with the location needed to repair it. */
function malformed(lineNumber: number, detail: string): never {
  throw new Error(
    `${LAUNCH_LOCKDOWN_AUDIT_REL}:${lineNumber}: ${detail}`,
  );
}

/** Remove one required field label from a finding metadata segment. */
function metadataValue(
  segment: string,
  label: string,
  lineNumber: number,
): string {
  const prefix = `${label}: `;
  if (!segment.startsWith(prefix)) {
    return malformed(lineNumber, `expected metadata field "${label}"`);
  }
  const value = segment.slice(prefix.length).trim();
  if (value.length === 0) {
    return malformed(lineNumber, `metadata field "${label}" is empty`);
  }
  return value;
}

/** Collapse the detailed skeptic record into the digest's four review states. */
function reviewOf(verdict: string): LaunchAuditReview {
  if (verdict.includes("unverified")) return "unverified";
  const partial = verdict.includes("partially-confirmed");
  const confirmed = /(^|; )confirmed\b/.test(verdict);
  if (partial && confirmed) return "mixed skeptic verdict";
  if (partial) return "partially confirmed";
  return "confirmed";
}

/** Parse the six-field metadata line below one finding heading. */
function parseFindingMetadata(
  line: string,
  lineNumber: number,
): Pick<
  FindingWithoutBatches,
  "findingClass" | "surface" | "review" | "freezesAtTag"
> {
  const segments = line.split(" · ");
  if (segments.length !== 6) {
    return malformed(
      lineNumber,
      `expected six finding metadata fields, found ${segments.length}`,
    );
  }
  const findingClass = metadataValue(segments[0] ?? "", "Class", lineNumber);
  const surface = metadataValue(segments[1] ?? "", "Surface", lineNumber);
  metadataValue(segments[2] ?? "", "Confidence", lineNumber);
  const verdict = metadataValue(segments[3] ?? "", "Verdict", lineNumber);
  const irreversible = metadataValue(
    segments[4] ?? "",
    "Irreversible after tag",
    lineNumber,
  );
  metadataValue(segments[5] ?? "", "Sources", lineNumber);
  if (!irreversible.startsWith("yes") && !irreversible.startsWith("no")) {
    return malformed(
      lineNumber,
      '"Irreversible after tag" must begin with "yes" or "no"',
    );
  }
  return {
    findingClass,
    surface,
    review: reviewOf(verdict),
    freezesAtTag: irreversible.startsWith("yes"),
  };
}

/** Select one required Markdown section while retaining source line numbers. */
function sectionLines(
  lines: readonly string[],
  startHeading: string,
  endHeading: string,
): NumberedSourceLine[] {
  const start = lines.indexOf(startHeading);
  if (start < 0) malformed(1, `missing section "${startHeading}"`);
  const end = lines.indexOf(endHeading, start + 1);
  if (end < 0) malformed(start + 1, `missing section "${endHeading}"`);
  return lines.slice(start + 1, end).map((text, offset) => ({
    index: start + offset + 1,
    number: start + offset + 2,
    text,
  }));
}

/** Read every finding and its optional completion outcome in source order. */
function parseFindings(lines: readonly string[]): FindingWithoutBatches[] {
  const findings: FindingWithoutBatches[] = [];
  let severity: LaunchAuditSeverity | undefined;

  for (
    const sourceLine of sectionLines(
      lines,
      "## Findings",
      "## Delegation batches",
    )
  ) {
    const line = sourceLine.text;
    const severityMatch = line.match(/^### (High|Medium|Low)$/);
    if (severityMatch !== null) {
      severity = severityMatch[1] as LaunchAuditSeverity;
      continue;
    }
    const heading = line.match(/^#### (L-\d{3}) (.+)$/);
    if (heading === null) continue;
    if (severity === undefined) {
      malformed(sourceLine.number, "finding appears before a severity heading");
    }
    const id = heading[1] ?? "";
    const title = heading[2]?.trim() ?? "";
    if (title.length === 0) malformed(sourceLine.number, `${id} has no title`);

    let metadataLine: string | undefined;
    let metadataLineNumber = sourceLine.number + 1;
    let metadataIndex: number | undefined;
    let completion: string | undefined;
    let completionIndex: number | undefined;
    for (
      let cursor = sourceLine.index + 1;
      cursor < lines.length;
      cursor += 1
    ) {
      const candidate = lines[cursor] ?? "";
      if (candidate.startsWith("Class: ")) {
        if (candidate.includes(" Completed:")) {
          malformed(
            cursor + 1,
            `${id} must put Completed in its own paragraph after metadata`,
          );
        }
        metadataLine = candidate;
        metadataLineNumber = cursor + 1;
        metadataIndex = cursor;
      }
      if (candidate.startsWith("Completed:")) {
        if (completion !== undefined) {
          malformed(cursor + 1, `${id} has more than one Completed line`);
        }
        if (!candidate.startsWith("Completed: ")) {
          malformed(cursor + 1, `${id} has an empty Completed outcome`);
        }
        completion = candidate.slice("Completed: ".length).trim();
        completionIndex = cursor;
        if (completion.length === 0) {
          malformed(cursor + 1, `${id} has an empty Completed outcome`);
        }
      }
      if (candidate.startsWith("#### ") || candidate.startsWith("## ")) break;
    }
    if (metadataLine === undefined || metadataIndex === undefined) {
      malformed(sourceLine.number, `${id} has no metadata line`);
    }
    if (
      completionIndex !== undefined &&
      (
        completionIndex !== metadataIndex + 2 ||
        lines[completionIndex - 1]?.trim() !== "" ||
        lines[completionIndex + 1]?.trim() !== ""
      )
    ) {
      malformed(
        completionIndex + 1,
        `${id} must put Completed in its own first paragraph after metadata`,
      );
    }
    const metadata = parseFindingMetadata(metadataLine, metadataLineNumber);
    findings.push({
      id,
      title,
      severity,
      ...metadata,
      ...(completion === undefined ? {} : { completion }),
    });
  }

  if (findings.length === 0) malformed(1, "no findings found");
  const seen = new Set<string>();
  for (const [index, finding] of findings.entries()) {
    if (seen.has(finding.id)) {
      malformed(1, `duplicate finding id ${finding.id}`);
    }
    seen.add(finding.id);
    const expected = `L-${String(index + 1).padStart(3, "0")}`;
    if (finding.id !== expected) {
      malformed(
        1,
        `finding sequence skips or reorders ${expected}; found ${finding.id}`,
      );
    }
  }
  return findings;
}

/** Read every fixer batch and its finding membership. */
function parseBatches(lines: readonly string[]): LaunchAuditBatchSummary[] {
  const batches: LaunchAuditBatchSummary[] = [];
  let current: { id: string; title: string } | undefined;

  for (
    const sourceLine of sectionLines(
      lines,
      "## Delegation batches",
      "## Coverage",
    )
  ) {
    const line = sourceLine.text;
    const heading = line.match(/^### (B-\d{2}) (.+)$/);
    if (heading !== null) {
      current = { id: heading[1] ?? "", title: heading[2]?.trim() ?? "" };
      continue;
    }
    if (!line.startsWith("- **Findings:**")) continue;
    if (current === undefined) {
      malformed(
        sourceLine.number,
        "batch findings appear before a batch heading",
      );
    }
    const findingIds = [...line.matchAll(/\bL-\d{3}\b/g)].map((match) =>
      match[0]
    );
    if (findingIds.length === 0) {
      malformed(sourceLine.number, `${current.id} has no finding ids`);
    }
    batches.push({ ...current, findingIds });
    current = undefined;
  }

  if (batches.length === 0) malformed(1, "no delegation batches found");
  return batches;
}

/** Read the compact id and title of each explicitly refuted raw finding. */
function parseRefuted(lines: readonly string[]): LaunchAuditRefutedSummary[] {
  const refuted: LaunchAuditRefutedSummary[] = [];
  let inRefuted = false;
  for (const line of lines) {
    if (line === "## Appendix: refuted findings") {
      inRefuted = true;
      continue;
    }
    if (inRefuted && line.startsWith("## ")) break;
    if (!inRefuted || !line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const id = cells[0] ?? "";
    const title = cells[1] ?? "";
    if (id === "" || id === "Id" || /^-+$/.test(id)) continue;
    if (title.length === 0) malformed(1, `refuted finding ${id} has no title`);
    refuted.push({ id, title });
  }
  return refuted;
}

/** Parse and cross-check every fact the compact digest projects. */
export function parseLaunchLockdownAudit(source: string): LaunchAuditSummary {
  const lines = source.split(/\r?\n/);
  const provenance = lines.find((line) => line.startsWith("_Produced on "));
  if (provenance === undefined) malformed(1, "missing production provenance");

  const withoutBatches = parseFindings(lines);
  const batches = parseBatches(lines);
  const knownFindings = new Set(withoutBatches.map((finding) => finding.id));
  const batchIdsByFinding = new Map<string, string[]>();
  for (const batch of batches) {
    for (const id of batch.findingIds) {
      if (!knownFindings.has(id)) {
        malformed(1, `${batch.id} names unknown finding ${id}`);
      }
      const ids = batchIdsByFinding.get(id) ?? [];
      ids.push(batch.id);
      batchIdsByFinding.set(id, ids);
    }
  }

  const findings = withoutBatches.map((finding) => {
    const batchIds = batchIdsByFinding.get(finding.id);
    if (batchIds === undefined || batchIds.length === 0) {
      return malformed(1, `${finding.id} belongs to no delegation batch`);
    }
    return { ...finding, batches: batchIds };
  });

  return { provenance, findings, batches, refuted: parseRefuted(lines) };
}

/** Render one Markdown token as a code span through the shared escaper. */
function code(value: string): string {
  return markdownCodeSpan(value);
}

/** Render the compact, generated Markdown index. */
export function renderLaunchLockdownAuditSummary(
  audit: LaunchAuditSummary,
): string {
  const activeFindings = audit.findings.filter((finding) =>
    finding.completion === undefined
  );
  const completedFindings = audit.findings.filter((finding) =>
    finding.completion !== undefined
  );
  const activeFindingIds = new Set(
    activeFindings.map((finding) => finding.id),
  );
  const severityCounts = new Map<LaunchAuditSeverity, number>();
  for (const severity of SEVERITIES) severityCounts.set(severity, 0);
  let frozen = 0;
  let reviewed = 0;
  for (const finding of activeFindings) {
    severityCounts.set(
      finding.severity,
      (severityCounts.get(finding.severity) ?? 0) + 1,
    );
    if (finding.freezesAtTag) frozen += 1;
    if (finding.review !== "unverified") reviewed += 1;
  }

  const lines: string[] = [
    "<!-- GENERATED FILE — edit launch-lockdown-audit.md, then run `deno task launch-audit-summary`. -->",
    "",
    "# Launch lock-down audit — findings digest",
    "",
    audit.provenance,
    "",
    "This is a compact index generated from " +
    "[the full audit](launch-lockdown-audit.md). The source audit remains " +
    "authoritative for evidence, consequences, proposed fixes, owner decisions, " +
    "coverage, and method.",
    "",
    `**${activeFindings.length} active findings:** ${
      severityCounts.get("High")
    } high, ` +
    `${severityCounts.get("Medium")} medium, ${
      severityCounts.get("Low")
    } low · ` +
    `${frozen} freeze at the first tag · ${reviewed} skeptic-reviewed · ` +
    `${
      activeFindings.length - reviewed
    } unverified · ${completedFindings.length} completed · ` +
    `${audit.batches.length} fixer batches.`,
    "",
    "Each entry gives the finding's surface, class, skeptic status, " +
    "freeze-at-tag flag when applicable, and fixer batch. “Unverified” means no " +
    "skeptic was assigned; it does not mean refuted.",
    "",
    "A finding stays active until its source block carries a non-empty, " +
    "single-line `Completed:` outcome as the first paragraph after metadata. " +
    "Completed findings remain in their original batches and appear at the " +
    "bottom of this digest.",
  ];

  for (const severity of SEVERITIES) {
    const findings = activeFindings.filter((finding) =>
      finding.severity === severity
    );
    lines.push("", `## ${severity} (${findings.length})`, "");
    for (const finding of findings) {
      const metadata = [
        code(finding.surface),
        code(finding.findingClass),
        finding.review,
        ...(finding.freezesAtTag ? ["**freezes at tag**"] : []),
        ...finding.batches.map(code),
      ];
      lines.push(
        `- **${finding.id}** — ${finding.title}  `,
        `  ${metadata.join(" · ")}`,
      );
    }
  }

  lines.push("", "## Batch progress", "");
  for (const batch of audit.batches) {
    const activeCount = batch.findingIds.filter((id) =>
      activeFindingIds.has(id)
    ).length;
    lines.push(
      `- **${batch.id}** — ${batch.title} · ${activeCount} active / ${batch.findingIds.length} total`,
    );
  }

  if (audit.refuted.length > 0) {
    lines.push("", `## Refuted (${audit.refuted.length})`, "");
    for (const finding of audit.refuted) {
      lines.push(`- **${finding.id}** — ${finding.title}`);
    }
  }

  if (completedFindings.length > 0) {
    lines.push("", `## Completed (${completedFindings.length})`, "");
    for (const finding of completedFindings) {
      lines.push(
        `- **${finding.id}** — ${finding.title}  `,
        `  ${finding.completion ?? ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
  const source = await Deno.readTextFile(
    join(repoRoot, LAUNCH_LOCKDOWN_AUDIT_REL),
  );
  const summaryPath = join(repoRoot, LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL);
  const rendered = renderLaunchLockdownAuditSummary(
    parseLaunchLockdownAudit(source),
  );
  await Deno.writeTextFile(
    summaryPath,
    await formatMarkdownText(summaryPath, rendered),
  );
  console.log(`Generated ${LAUNCH_LOCKDOWN_AUDIT_SUMMARY_REL}`);
}
