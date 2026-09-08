/** One bounded representation for frozen snapshot identity and immutable documents. */
import { EXECUTION_DOCUMENT_BYTES } from "./snapshot_schema.ts";

/** Reject oversized manifests during traversal, before JSON constructs an aggregate string. */
export function encodeExecutionDocument(value: unknown): string {
  let remaining = EXECUTION_DOCUMENT_BYTES;
  const raw = JSON.stringify(value, (key: string, item: unknown): unknown => {
    const count = (text: string): number =>
      text.length > EXECUTION_DOCUMENT_BYTES
        ? EXECUTION_DOCUMENT_BYTES + 1
        : new TextEncoder().encode(text).length;
    remaining -= count(key) + 4;
    if (typeof item === "string") remaining -= count(item) * 6;
    else if (item === null || typeof item !== "object") remaining -= 32;
    if (remaining < 0) {
      throw new Error(
        "Recovery manifest exceeds the bounded document format. Preserve the checkout and its payloads; no manifest was published.",
      );
    }
    return item;
  });
  if (raw === undefined) {
    throw new Error("Recovery documents must have a JSON value.");
  }
  return raw;
}
