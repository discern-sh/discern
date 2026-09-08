/** Diagnostic sampling preserves distinct observations and prioritizes separate rules. */
import { DIAGNOSTIC_SEVERITIES } from "./result.ts";

export const DIAGNOSTIC_SUMMARY_LIMIT = 6;
export const DIAGNOSTIC_SUMMARY_BYTES = 12_000;

/** Compare full records; different evidence or locations never become duplicate findings. */
export function sampleDiagnostics<
  T extends { severity?: unknown; tool?: unknown; rule?: unknown },
>(
  diagnostics: readonly T[],
  limit: number,
): { diagnostic: T; count: number }[] {
  const distinct = new Map<string, { diagnostic: T; count: number }>();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify(
      Object.entries(diagnostic).sort(([a], [b]) => a.localeCompare(b)),
    );
    const existing = distinct.get(key);
    if (existing === undefined) distinct.set(key, { diagnostic, count: 1 });
    else existing.count++;
  }
  const families = new Set<string>();
  return [...distinct.values()].map((entry) => {
    const family = JSON.stringify([
      entry.diagnostic.severity,
      entry.diagnostic.tool,
      entry.diagnostic.rule,
    ]);
    const representative = !families.has(family);
    families.add(family);
    const severity = DIAGNOSTIC_SEVERITIES.findIndex((value) =>
      value === entry.diagnostic.severity
    );
    return {
      ...entry,
      representative,
      severity: severity < 0 ? DIAGNOSTIC_SEVERITIES.length : severity,
    };
  }).sort((a, b) =>
    a.severity - b.severity ||
    Number(b.representative) - Number(a.representative)
  ).slice(0, limit);
}
