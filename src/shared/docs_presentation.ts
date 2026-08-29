/** Shared, renderer-neutral facts for manual and Map result presentation. */

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
