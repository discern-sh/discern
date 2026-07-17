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

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 0x20 || codePoint === 0x7f)
    ) {
      return true;
    }
  }
  return false;
}

/** Render a string as a single-line, double-quoted TOML value. */
export function renderTomlString(value: string): string {
  if (hasControlCharacter(value)) {
    throw new Error("a TOML value cannot contain a control character");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a list of strings as comma-joined, double-quoted TOML array items. */
export function renderTomlStringList(items: string[]): string {
  return items.map(renderTomlString).join(", ");
}

/** A minimally-validated view of a parsed `discern.toml`. */
export interface DiscernToml {
  project: {
    slug?: string | undefined;
    agents?: string[] | undefined;
    gotchas_doc?: string | undefined;
  };
  repository: {
    trunk?: string | undefined;
    branch_prefix?: string | undefined;
    ensure?: string[] | undefined;
  };
  raw: Record<string, unknown>;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `discern.toml` text and surface the narrow `[project]` and `[repository]`
 * views installer callers need. Throws a clear error if the text is not valid
 * TOML; tolerates missing fields so `doctor` can report them precisely.
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
  const repository = isRecord(raw.repository) ? raw.repository : {};
  return {
    project: {
      slug: typeof project.slug === "string" ? project.slug : undefined,
      agents: Array.isArray(project.agents)
        ? project.agents.filter((a): a is string => typeof a === "string")
        : undefined,
      gotchas_doc: typeof project.gotchas_doc === "string"
        ? project.gotchas_doc
        : undefined,
    },
    repository: {
      trunk: typeof repository.trunk === "string"
        ? repository.trunk
        : undefined,
      branch_prefix: typeof repository.branch_prefix === "string"
        ? repository.branch_prefix
        : undefined,
      ensure: Array.isArray(repository.ensure)
        ? repository.ensure.filter((command): command is string =>
          typeof command === "string"
        )
        : undefined,
    },
    raw,
  };
}
