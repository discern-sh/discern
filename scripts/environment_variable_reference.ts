/**
 * Render the public environment-variable reference from the canonical
 * definitions in `src/shared/environment_variables.ts`.
 */

import { markdownCodeSpan } from "../src/shared/markdown_code.ts";
import {
  DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  DISCERN_ENVIRONMENT_VARIABLE_GROUPS,
  type DiscernEnvironmentVariableDefinition,
  type DiscernEnvironmentVariableGroup,
  publicEnvironmentVariableDefinitions,
} from "../src/shared/environment_variables.ts";

/** Map-relative destination of the generated public reference page. */
export const ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL =
  "70-reference/environment-variables.md";

const GENERATED_BANNER =
  "<!-- This reference is generated from the environment-variable registry. -->";

/** Escape one Markdown table cell without changing its inline Markdown. */
function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

/** Render the committed public environment-variable reference page. */
function renderEnvironmentVariableReferenceDocument(
  groups: readonly DiscernEnvironmentVariableGroup[] =
    DISCERN_ENVIRONMENT_VARIABLE_GROUPS,
  definitions: Readonly<Record<string, DiscernEnvironmentVariableDefinition>> =
    DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  manual = false,
): string {
  const published = publicEnvironmentVariableDefinitions(definitions);
  const aliases = published.map((definition) => definition.name);
  const renderedNames = new Set<string>();
  const sections: string[] = [];

  for (const group of groups) {
    const members = published.filter((definition) =>
      definition.group === group.id
    );
    if (members.length === 0) continue;
    const rows = members.map((definition) => {
      if (!definition.documentation.public) {
        throw new Error(
          `${definition.name}: an internal definition was published`,
        );
      }
      renderedNames.add(definition.name);
      return `| ${markdownCodeSpan(definition.name)} | ${
        tableCell(definition.documentation.description)
      } |`;
    });
    sections.push([
      `## ${group.title}`,
      "",
      group.description,
      "",
      "| Variable | What it does |",
      "| -------- | ------------ |",
      ...rows,
    ].join("\n"));
  }

  const unrendered = published
    .filter((definition) => !renderedNames.has(definition.name))
    .map((definition) => definition.name);
  if (unrendered.length > 0) {
    throw new Error(
      `public environment definitions use an unknown group: ${
        unrendered.join(", ")
      }`,
    );
  }

  return [
    "---",
    "title: Environment variables",
    manual
      ? "description: Look up the DISCERN_* settings you can supply and the values discern passes to project commands."
      : "description: Every public DISCERN_* environment variable, grouped by purpose, with defaults and activation behavior.",
    "order: 110",
    "publish: true",
    "aliases:",
    "  - environment variables",
    "  - env vars",
    ...aliases.map((name) => `  - ${name}`),
    "---",
    "",
    GENERATED_BANNER,
    "",
    "# Environment variables",
    "",
    manual
      ? "Environment variables pass settings to a running program. Some let you change how discern starts; others give your project scripts information such as the current worktree or its assigned port. This page lists the supported `DISCERN_*` variables by purpose."
      : "_The public `DISCERN_*` inputs and exported values discern supports, grouped by purpose._",
    "",
    manual
      ? "Find the variable name below to see who sets it, who reads it, and its default where one exists. Setting a variable affects the current process unless its entry says discern exports or writes it. For lasting project settings, use [`discern.toml`](config-reference.md)."
      : "Variables used only by discern's own processes, source checkout, and test suite are omitted.",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/** Render the external-reader manual projection from the same definitions. */
export function renderManualEnvironmentVariableReferenceDoc(
  groups: readonly DiscernEnvironmentVariableGroup[] =
    DISCERN_ENVIRONMENT_VARIABLE_GROUPS,
  definitions: Readonly<Record<string, DiscernEnvironmentVariableDefinition>> =
    DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
): string {
  return renderEnvironmentVariableReferenceDocument(groups, definitions, true);
}
