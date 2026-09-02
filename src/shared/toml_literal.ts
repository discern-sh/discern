/**
 * One renderer for a parsed value as a TOML literal, shared by the config
 * template renderer (schema defaults) and `config explain` (live values), so
 * a value spells the same wherever discern writes it back.
 */

import { renderTomlString } from "../lib/toml_render.ts";

/** True for a non-null, non-array object. */
function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A scalar or array as a TOML value literal; a table renders inline in
 * braces. Anything else is a caller error, named in the failure. */
export function renderTomlLiteral(value: unknown): string {
  if (typeof value === "string") return renderTomlString(value);
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(renderTomlLiteral).join(", ")}]`;
  }
  if (isTable(value)) {
    return `{ ${
      Object.entries(value).map(([k, v]) => `${k} = ${renderTomlLiteral(v)}`)
        .join(", ")
    } }`;
  }
  throw new Error(
    `cannot render a value of this shape as TOML: ${JSON.stringify(value)}`,
  );
}
