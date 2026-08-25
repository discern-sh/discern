/** Contextual validation for JSON and other values entering runtime code. */

import { z } from "@zod/zod";

const MAX_ISSUES = 5;
const MAX_FRAGMENT_LENGTH = 180;

/** Keep one source or validation fragment useful without echoing unbounded data. */
function bounded(text: string): string {
  const clean = text.replaceAll(/[\r\n\t]+/g, " ").trim();
  return clean.length <= MAX_FRAGMENT_LENGTH
    ? clean
    : `${clean.slice(0, MAX_FRAGMENT_LENGTH - 1)}…`;
}

/** Render a bounded path-qualified summary of schema issues. */
function issueSummary(issues: readonly z.core.$ZodIssue[]): string {
  const shown = issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.length === 0
      ? "<root>"
      : issue.path.map(String).join(".");
    return `${bounded(path)}: ${bounded(issue.message)}`;
  });
  const omitted = issues.length - shown.length;
  return `${shown.join("; ")}${
    omitted > 0 ? `; … ${omitted} more issue${omitted === 1 ? "" : "s"}` : ""
  }`;
}

/** Validate an unknown runtime value and return only the schema-earned type. */
export function decodeUnknown<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  source: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    `${bounded(source)} is invalid: ${issueSummary(result.error.issues)}`,
  );
}

/** Parse JSON as unknown, then validate it before returning a declared type. */
export function decodeJson<Schema extends z.ZodType>(
  schema: Schema,
  text: string,
  source: string,
): z.output<Schema> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${bounded(source)} is not valid JSON: ${bounded(message)}`,
      {
        cause: error,
      },
    );
  }
  return decodeUnknown(schema, value, source);
}
