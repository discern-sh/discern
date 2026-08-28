/** Deterministic interpretation and ratcheting for pinned FTA output. */

import type { ComplexityHotspotBudget } from "./complexity_hotspots.ts";

/** A file enters the reviewed tail above either threshold. */
export const EXTREME_FTA_SCORE = 100;
export const EXTREME_CYCLO = 200;

/** Source ownership lanes used by the advisory report. */
export type ComplexityArea =
  | "generated"
  | "production"
  | "tests"
  | "tooling";

/** The stable subset of one FTA result row used by discern. */
export interface FtaMetric {
  readonly file: string;
  readonly score: number;
  readonly cyclo: number;
  readonly lines: number;
}

/** One enrolled metric with ownership and Git-churn context. */
export interface ComplexityMetric extends FtaMetric {
  readonly area: ComplexityArea;
  readonly touches: number;
}

/** Ranking axes exposed by the advisory report. */
export type ComplexityRank = "cyclo" | "lines" | "score" | "touches";

/** Normalize FTA's platform-specific relative file names. */
function normalizedFtaPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
}

/** Read one finite numeric property from an untrusted FTA row. */
function finiteNumber(
  row: Record<string, unknown>,
  property: string,
  index: number,
): number {
  const value = row[property];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`FTA row ${index} has invalid ${property}`);
  }
  return value;
}

/** Validate and project the JSON emitted by the pinned FTA binary. */
export function parseFtaJson(text: string): FtaMetric[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("FTA JSON must be an array");
  return parsed.map((value, index) => {
    if (typeof value !== "object" || value === null) {
      throw new Error(`FTA row ${index} must be an object`);
    }
    const row = value as Record<string, unknown>;
    if (typeof row.file_name !== "string" || row.file_name.trim() === "") {
      throw new Error(`FTA row ${index} has invalid file_name`);
    }
    return {
      file: normalizedFtaPath(row.file_name),
      score: finiteNumber(row, "fta_score", index),
      cyclo: finiteNumber(row, "cyclo", index),
      lines: finiteNumber(row, "line_count", index),
    };
  });
}

/** FTA's documented declaration-file omission, applied to the canonical set. */
export function expectedFtaFiles(files: readonly string[]): string[] {
  return files.filter((file) => !file.endsWith(".d.ts")).sort();
}

/** Missing, duplicate, and unexpected analyzer membership. */
export function ftaEnrollmentFindings(
  expectedFiles: readonly string[],
  metrics: readonly FtaMetric[],
): string[] {
  const expected = new Set(expectedFiles.map(normalizedFtaPath));
  const counts = new Map<string, number>();
  for (const metric of metrics) {
    counts.set(metric.file, (counts.get(metric.file) ?? 0) + 1);
  }
  const findings: string[] = [];
  for (const file of [...expected].sort()) {
    const count = counts.get(file) ?? 0;
    if (count === 0) findings.push(`FTA omitted authored source ${file}`);
    else if (count > 1) findings.push(`FTA returned ${file} ${count} times`);
  }
  for (const file of [...counts.keys()].sort()) {
    if (!expected.has(file)) {
      findings.push(`FTA returned unexpected source ${file}`);
    }
  }
  return findings;
}

/** Assign every current authored root to an explicit maintenance lane. */
export function complexityArea(
  file: string,
  generated: boolean,
): ComplexityArea {
  if (generated) return "generated";
  const root = normalizedFtaPath(file).split("/", 1)[0];
  if (root === "src" || root === "site") return "production";
  if (root === "tests") return "tests";
  if (root === "art" || root === "project" || root === "scripts") {
    return "tooling";
  }
  throw new Error(`FTA source has no complexity area: ${file}`);
}

/** Add generated ownership and full-history touch counts to analyzer rows. */
export function contextualizeComplexity(
  metrics: readonly FtaMetric[],
  generatedFiles: ReadonlySet<string>,
  touches: ReadonlyMap<string, number>,
): ComplexityMetric[] {
  return metrics.map((metric) => ({
    ...metric,
    area: complexityArea(metric.file, generatedFiles.has(metric.file)),
    touches: touches.get(metric.file) ?? 0,
  }));
}

/** Stable top-N ranking for one advisory axis. */
export function rankComplexity(
  metrics: readonly ComplexityMetric[],
  area: Exclude<ComplexityArea, "generated">,
  rank: ComplexityRank,
  limit = 5,
): ComplexityMetric[] {
  return metrics
    .filter((metric) => metric.area === area)
    .sort((left, right) =>
      right[rank] - left[rank] || left.file.localeCompare(right.file)
    )
    .slice(0, limit);
}

/** Whether one file belongs to the deliberately small extreme tail. */
export function isExtremeComplexity(
  metric: Pick<ComplexityMetric, "cyclo" | "score">,
): boolean {
  return metric.score > EXTREME_FTA_SCORE || metric.cyclo > EXTREME_CYCLO;
}

/** Match the two-decimal precision exposed in reports and reviewed budgets. */
function budgetedScore(score: number): number {
  return Number(score.toFixed(2));
}

/** Validate exact hotspot registry parity and each file-specific ceiling. */
export function complexityHotspotFindings(
  metrics: readonly ComplexityMetric[],
  budgets: readonly ComplexityHotspotBudget[],
): string[] {
  const findings: string[] = [];
  const budgetByFile = new Map<string, ComplexityHotspotBudget>();
  for (const budget of budgets) {
    if (budgetByFile.has(budget.file)) {
      findings.push(`duplicate complexity hotspot budget ${budget.file}`);
    }
    budgetByFile.set(budget.file, budget);
    if (
      budget.owner.trim().length < 3 || budget.reason.trim().length < 12 ||
      budget.recovery.trim().length < 12
    ) {
      findings.push(`incomplete complexity hotspot rationale ${budget.file}`);
    }
  }

  const metricByFile = new Map(metrics.map((metric) => [metric.file, metric]));
  const extreme = metrics.filter((metric) =>
    metric.area !== "generated" && isExtremeComplexity(metric)
  );
  for (const metric of extreme) {
    const budget = budgetByFile.get(metric.file);
    if (budget === undefined) {
      findings.push(
        `new extreme complexity hotspot ${metric.file} (score ${
          metric.score.toFixed(2)
        }, cyclo ${metric.cyclo})`,
      );
      continue;
    }
    if (budgetedScore(metric.score) > budget.maxScore) {
      findings.push(
        `${metric.file} FTA score ${metric.score.toFixed(2)} exceeds ${
          budget.maxScore.toFixed(2)
        }`,
      );
    }
    if (metric.cyclo > budget.maxCyclo) {
      findings.push(
        `${metric.file} cyclomatic complexity ${metric.cyclo} exceeds ${budget.maxCyclo}`,
      );
    }
  }
  for (const budget of budgets) {
    const metric = metricByFile.get(budget.file);
    if (metric === undefined) {
      findings.push(
        `complexity hotspot budget has no analyzed source ${budget.file}`,
      );
    } else if (metric.area === "generated") {
      findings.push(
        `generated source must not consume a hotspot budget ${budget.file}`,
      );
    } else if (!isExtremeComplexity(metric)) {
      findings.push(`stale complexity hotspot budget ${budget.file}`);
    }
  }
  return findings.sort();
}
