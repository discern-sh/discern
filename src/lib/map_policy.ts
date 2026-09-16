/** Local map purpose is independent of publication metadata. */
import type { DocEntry } from "./docs.ts";

/** Explicit reserved homes; other underscore directories remain current context. */
export function mapPageKind(path: string): "current" | "history" | "private" {
  const parts = path.split("/").slice(0, -1);
  if (parts.includes("_private")) return "private";
  if (parts.includes("_adr")) return "history";
  return "current";
}

/** History and private pages are available when their home is explicitly named. */
export function localMapEntries(
  entries: readonly DocEntry[],
  target?: string,
  all = false,
): DocEntry[] {
  const selected = target?.split("/") ?? [];
  return entries.filter((entry) => {
    const kind = mapPageKind(entry.relToDocs);
    return kind === "current" || all ||
      (kind === "history" && selected.includes("_adr")) ||
      (kind === "private" && selected.includes("_private"));
  });
}
