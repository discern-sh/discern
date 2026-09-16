/** Shared, renderer-neutral facts for manual and Map result presentation. */

import { number, object, records, text } from "./result_markdown_values.ts";
import { isManualKind, type ManualKind, manualKindLabel } from "./manual.ts";

/** Optional stable manual identity fields carried by document results. */
export interface ManualResultIdentity {
  readonly page_id?: string;
  readonly manual_kind?: ManualKind;
}

/** Project one discovered page's optional manual identity. */
export function identity(
  pageId: string | undefined,
  kind: ManualKind | undefined,
): ManualResultIdentity {
  return {
    ...(pageId === undefined ? {} : { page_id: pageId }),
    ...(kind === undefined ? {} : { manual_kind: kind }),
  };
}

/** Label one trusted or untrusted manual kind without leaking invalid values. */
export function kindPrefix(kind: unknown): string {
  return isManualKind(kind) ? `${manualKindLabel(kind)} · ` : "";
}

/** Label one manual kind after an existing title. */
export function kindSuffix(kind: unknown): string {
  return isManualKind(kind) ? ` · ${manualKindLabel(kind)}` : "";
}

/** Label one optional search-result heading after its title. */
export function headingSuffix(
  heading: string | undefined,
  present: (value: string) => string,
): string {
  return heading === undefined ? "" : ` · ${present(heading)}`;
}

const SEARCH_MATCH_SUFFIX = {
  complete: "",
  partial: " · partial match",
  metadata: " · title or alias match",
} as const;

/** Explain how a terminal search result matched. */
export function matchSuffix(
  match: keyof typeof SEARCH_MATCH_SUFFIX,
): string {
  return SEARCH_MATCH_SUFFIX[match];
}

/** Append one optional search snippet to its heading. */
export function snippetSuffix(snippet: string | undefined): string {
  return snippet === undefined ? "" : ` ${snippet}`;
}

type DescriptionProjector = (
  kind: unknown,
  description: string,
) => string;

/** Corpus-specific kind labels without branching inside each renderer. */
const DOCUMENT_DESCRIPTION: Readonly<
  Record<"docs" | "map", DescriptionProjector>
> = {
  docs: (kind, description) => `${kindPrefix(kind)}${description}`,
  map: (_kind, description) => description,
};

/** Add the manual-purpose label only on the product-manual surface. */
export function desc(
  verb: "docs" | "map",
  kind: unknown,
  description: string,
): string {
  return DOCUMENT_DESCRIPTION[verb](kind, description);
}

/** Prefer the authoritative full match count over the bounded result array. */
export function count(
  count: number | undefined,
  returned: number,
): number {
  return count ?? returned;
}

/** The authoritative bounded-search sentence once truncation is known. */
export function truncationText(
  returned: number,
  count: number,
): string {
  return `Showing ${returned} highest-ranked matches of ${count}.`;
}

/** Explain a bounded search projection only when rows were omitted. */
export function truncation(
  truncated: unknown,
  returned: number,
  count: number,
): string | undefined {
  return truncated === true ? truncationText(returned, count) : undefined;
}

/** Human age wording; exact timestamps remain available in JSON. */
export function ageSince(iso: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  const minute = 60_000;
  const units: Array<[number, string]> = [
    [365 * 24 * 60 * minute, "year"],
    [30 * 24 * 60 * minute, "month"],
    [7 * 24 * 60 * minute, "week"],
    [24 * 60 * minute, "day"],
    [60 * minute, "hour"],
    [minute, "minute"],
  ];
  for (const [size, label] of units) {
    const value = Math.floor(elapsed / size);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

/** Page-specific evidence in a terminal region overview. */
export function mapRegionFreshness(value: unknown, now: number): string[] {
  const region = object(value) ?? {};
  const changedAt = text(region.pages_changed_at);
  const changes = number(region.code_changes_since);
  const pages = records(region.pages);
  const lines: string[] = [];
  if (
    changedAt === undefined || changes === undefined
  ) {
    lines.push(
      "freshness unknown — no specific file links or usable Git history",
    );
  } else {
    lines.push(
      `linked code changed ${changes} time${
        changes === 1 ? "" : "s"
      } since the pages that link it; oldest measured page changed ${
        ageSince(changedAt, now)
      }`,
    );
  }
  for (const page of pages) {
    if ((number(page.code_changes_since) ?? 0) > 0) {
      lines.push(
        `Review ${page.target}: ${page.code_changes_since} later source commits`,
      );
    }
  }
  const unknown =
    pages.filter((page) => number(page.code_changes_since) === undefined)
      .length;
  if (unknown > 0 && changes !== undefined) {
    lines.push(`${unknown} pages have unknown freshness`);
  }
  return lines;
}

/** Affected pages in a structured-result presentation, preserving every target. */
export function changedMapPages(
  regions: readonly Record<string, unknown>[],
  present: (target: unknown) => string,
): string[] {
  return regions.flatMap((region) =>
    records(region.pages).flatMap((page) =>
      (number(page.code_changes_since) ?? 0) > 0
        ? [
          `Review ${present(page.target)}: ${
            number(page.code_changes_since)
          } later commits to linked sources.`,
        ]
        : []
    )
  );
}

/** Selected-page evidence cannot claim semantic currency from Git history. */
export function pageFreshness(value: unknown): string | undefined {
  const page = object(value);
  if (page === undefined) return undefined;
  const changes = number(page.code_changes_since);
  return changes === undefined
    ? "Page freshness is unknown: no specific source links or usable Git history."
    : `${changes} commits changed linked sources after this page's last commit. Review decides whether its explanation is still true.`;
}
