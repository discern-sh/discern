/**
 * TOML rendering and reading for `discern.toml`.
 *
 * `discern.toml` itself is produced by token-substituting `discern.toml.tmpl`,
 * so there is no full TOML *writer* here — only the small fragment renderers
 * that turn answers into the TOML-array literals the template expects (e.g.
 * `agents = [{{agents_array}}]`), plus a parse-and-validate used by `doctor`.
 */

import { parse as parseToml } from "@std/toml";
import { tomlSyntaxHint } from "../shared/config_read.ts";

/** Render a list of strings as comma-joined, double-quoted TOML array items. */
export function renderTomlStringList(items: string[]): string {
  return items.map((item) => `"${item.replaceAll('"', '\\"')}"`).join(", ");
}

/** A minimally-validated view of a parsed `discern.toml`. */
export interface DiscernToml {
  project: {
    slug?: string | undefined;
    branch_prefix?: string | undefined;
    agents?: string[] | undefined;
    gotchas_doc?: string | undefined;
  };
  raw: Record<string, unknown>;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `discern.toml` text and surface the `[project]` block. Throws a clear
 * error if the text is not valid TOML; tolerates missing fields (the caller
 * decides which are required) so `doctor` can report them precisely.
 */
export function parseDiscernToml(text: string): DiscernToml {
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (error) {
    throw new Error(tomlSyntaxHint(error));
  }
  const raw = isRecord(parsed) ? parsed : {};
  const project = isRecord(raw.project) ? raw.project : {};
  return {
    project: {
      slug: typeof project.slug === "string" ? project.slug : undefined,
      branch_prefix: typeof project.branch_prefix === "string"
        ? project.branch_prefix
        : undefined,
      agents: Array.isArray(project.agents)
        ? project.agents.filter((a): a is string => typeof a === "string")
        : undefined,
      gotchas_doc: typeof project.gotchas_doc === "string"
        ? project.gotchas_doc
        : undefined,
    },
    raw,
  };
}
