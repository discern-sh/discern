/** Pure degraded-state projection shared by status classification and guidance. */

import type { StatusFleetEntry } from "../../shared/result_schemas.ts";

export type DegradedFleetKind =
  | "broken"
  | "setup-incomplete"
  | "unreadable";

/** Classify only the degraded states that pre-empt ordinary task status. */
export function degradedFleetKind(
  entry: StatusFleetEntry,
): DegradedFleetKind | undefined {
  if (entry.broken === true) return "broken";
  if (entry.git_unavailable === true || entry.read_failure !== undefined) {
    return "unreadable";
  }
  return entry.setup?.state === "incomplete" ||
      entry.setup?.state === "unavailable"
    ? "setup-incomplete"
    : undefined;
}

/** What an unreadable checkout could not read, most fundamental first: Git
 * state, then one configured env file, then the checkout's other files. */
export type UnreadableSubject =
  | { readonly kind: "git" }
  | { readonly kind: "env-file"; readonly file: string }
  | { readonly kind: "checkout" };

/** Name the unreadable part of a checkout the classifier marked unreadable. */
export function unreadableSubject(entry: StatusFleetEntry): UnreadableSubject {
  if (entry.git_unavailable === true) return { kind: "git" };
  const file = entry.read_failure?.file;
  return file === undefined ? { kind: "checkout" } : { kind: "env-file", file };
}

/** The fact that leads an unreadable checkout's guidance. */
function unreadableFact(entry: StatusFleetEntry): string {
  const subject = unreadableSubject(entry);
  switch (subject.kind) {
    case "git":
      return "Git could not read this checkout.";
    case "env-file":
      return `discern could not read the env file \`${subject.file}\` in this checkout.`;
    case "checkout":
      return "discern could not read this checkout's files.";
  }
}

/** Safe first action for each degraded state. */
export function degradedFleetAttention(
  kind: string,
  entry: StatusFleetEntry,
): string | undefined {
  switch (kind) {
    case "broken":
      return "Setup did not produce a readable project configuration. Choose Show recovery steps in `discern desk`.";
    case "setup-incomplete":
      return "Setup did not reach its ready marker. Choose Show recovery steps in `discern desk`.";
    case "unreadable":
      return `${
        unreadableFact(entry)
      } Choose Show recovery steps in \`discern desk\`.`;
    default:
      return undefined;
  }
}
