/**
 * One renderer for a parsed value as a TOML literal, shared by the config
 * template renderer (schema defaults) and `config explain` (live values), so
 * a value spells the same wherever discern writes it back.
 */

import { stringify as stringifyToml } from "@std/toml";

/** True for a non-null, non-array object. */
function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Render one scalar through the same TOML implementation that reads config.
 * The stringifier escapes control characters and spells non-finite numbers in
 * TOML's `inf`/`nan` forms, so every returned literal parses back. */
function renderScalar(value: string | number | boolean): string {
  const assignment = stringifyToml({ value }).trimEnd();
  const prefix = "value = ";
  if (!assignment.startsWith(prefix) || assignment.includes("\n")) {
    throw new Error(
      `the TOML stringifier did not render a scalar assignment: ${assignment}`,
    );
  }
  return assignment.slice(prefix.length);
}

/** A TOML key: bare when legal, otherwise a quoted basic string. */
function renderKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : renderScalar(key);
}

/** A scalar or array as a TOML value literal; a table renders inline in
 * braces. Anything else is a caller error, named in the failure. */
export function renderTomlLiteral(value: unknown): string {
  if (
    typeof value === "string" || typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return renderScalar(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(renderTomlLiteral).join(", ")}]`;
  }
  if (isTable(value)) {
    const entries = Object.entries(value).map(([key, entry]) =>
      `${renderKey(key)} = ${renderTomlLiteral(entry)}`
    );
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  throw new Error(
    `cannot render a value of this shape as TOML: ${JSON.stringify(value)}`,
  );
}

/** Render a parsed table as a complete TOML document rooted at `path`. The
 * standard stringifier orders scalar entries before child tables, preserves
 * their hierarchy, and quotes every value correctly. */
export function renderTomlDocumentAtPath(
  path: string,
  value: Readonly<Record<string, unknown>>,
): string {
  const segments = path.split(".").filter((segment) => segment !== "");
  if (segments.length === 0) {
    throw new Error("a TOML document path must not be empty");
  }
  let document: Record<string, unknown> = { ...value };
  for (const segment of segments.toReversed()) {
    document = { [segment]: document };
  }
  return stringifyToml(document).trim();
}
