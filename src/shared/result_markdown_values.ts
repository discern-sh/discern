/** Tolerant serialized-value readers shared by Markdown result presentations. */
import { markdownCodeSpan } from "./markdown_code.ts";

/** Owners recognise the short branch name; records carry the full ref. */
export function displayBranch(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/** Pluralize one counted noun the way the prose voice writes it. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Narrow one unknown serialized value to a plain object. */
export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read and trim a non-empty string. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Read non-empty content without changing whitespace-significant bytes. */
export function verbatimText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Read one finite numeric value. */
export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Read one boolean value. */
export function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Keep the plain-object members of one unknown array. */
export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const row = object(entry);
      return row === undefined ? [] : [row];
    })
    : [];
}

/** Keep the string members of one unknown array. */
export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Render an unknown dynamic value as a safe Markdown code span. */
export function code(value: unknown): string {
  return markdownCodeSpan(String(value));
}

/** Remove blank and duplicate presentation items without reordering them. */
export function unique(items: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item?.trim();
    if (normalized === undefined || normalized === "" || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Remove blank and exactly duplicate content without normalizing either. */
export function uniqueVerbatim(
  items: readonly (string | undefined)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (
      item === undefined || item.trim() === "" || seen.has(item)
    ) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}
