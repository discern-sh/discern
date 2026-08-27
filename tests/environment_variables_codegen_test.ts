/**
 * Currency, structure, future-enrollment, and publication-boundary guards for
 * the generated public environment-variable reference.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL,
  renderEnvironmentVariableReferenceDoc,
} from "../scripts/environment_variable_reference.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import {
  DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  DISCERN_ENVIRONMENT_VARIABLE_GROUPS,
  type DiscernEnvironmentVariableDefinition,
  environmentVariableNamesForGroup,
} from "../src/shared/environment_variables.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

/** Count reference-table rows for one exact environment name. */
function tableRowCount(document: string, name: string): number {
  const rowStart = `| \`${name}\` |`;
  return document.split("\n").filter((line) => line.startsWith(rowStart))
    .length;
}

/** Count frontmatter aliases for one exact environment name. */
function aliasCount(document: string, name: string): number {
  return document.split("\n").filter((line) => line === `  - ${name}`).length;
}

/** Exact `DISCERN_*` names mentioned in one Markdown document. */
function documentedEnvironmentNames(document: string): ReadonlySet<string> {
  return new Set(
    document.match(/\bDISCERN_[A-Z][A-Z0-9_]*(?:<NAME>)?/g) ?? [],
  );
}

Deno.test("environment definitions have valid groups, names, and documentation policy", () => {
  const groupIds = DISCERN_ENVIRONMENT_VARIABLE_GROUPS.map((group) => group.id);
  assertEquals(new Set(groupIds).size, groupIds.length, "group ids are unique");
  const usedGroups = new Set<string>();
  const names = new Set<string>();
  for (const group of DISCERN_ENVIRONMENT_VARIABLE_GROUPS) {
    assert(group.id.trim().length > 0, "group ids are non-empty");
    assert(group.title.trim().length > 0, `${group.id}: title is non-empty`);
    assert(
      group.description.trim().length > 0,
      `${group.id}: description is non-empty`,
    );
  }
  for (
    const [key, definition] of Object.entries(
      DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
    )
  ) {
    assert(key.trim().length > 0, "definition keys are non-empty");
    assert(
      groupIds.includes(definition.group),
      `${definition.name}: unknown group ${definition.group}`,
    );
    usedGroups.add(definition.group);
    assert(
      /^DISCERN_[A-Z][A-Z0-9_]*(?:<NAME>)?$/.test(definition.name),
      `${definition.name}: invalid environment-variable syntax`,
    );
    assert(!names.has(definition.name), `${definition.name}: duplicate name`);
    names.add(definition.name);
    const copy = definition.documentation.public
      ? definition.documentation.description
      : definition.documentation.reason;
    assert(copy.trim().length > 0, `${definition.name}: empty documentation`);
  }
  assertEquals(
    [...usedGroups].sort(),
    [...groupIds].sort(),
    "every declared group has a definition",
  );
});

Deno.test("the configured map's environment reference matches the generator", async () => {
  const path = join(
    REPO_AUTHORED_PATHS.map,
    ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL,
  );
  const committed = await Deno.readTextFile(path);
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(
      path,
      renderEnvironmentVariableReferenceDoc(),
    ),
    `${REPO_AUTHORED_PATHS.mapRel}/${ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL} is stale — run \`deno task codegen\``,
  );
});

Deno.test("the generated reference publishes each public definition and no internal definition", () => {
  const document = renderEnvironmentVariableReferenceDoc();
  const documented = documentedEnvironmentNames(document);
  for (
    const definition of Object.values(
      DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
    )
  ) {
    if (definition.documentation.public) {
      assertEquals(
        tableRowCount(document, definition.name),
        1,
        `${definition.name}: expected one public reference row`,
      );
      assertEquals(
        aliasCount(document, definition.name),
        1,
        `${definition.name}: expected one public search alias`,
      );
    } else {
      assertEquals(
        documented.has(definition.name),
        false,
        `${definition.name}: internal definition leaked into the reference`,
      );
    }
  }
});

Deno.test("future public definitions auto-render while future internal definitions stay hidden", () => {
  const futurePublicName: `DISCERN_${string}` =
    `DISCERN_${"EXPERIMENTAL_FUTURE_PUBLIC"}`;
  const futureInternalName: `DISCERN_${string}` =
    `DISCERN_${"INTERNAL_FUTURE"}`;
  const futurePublic = {
    name: futurePublicName,
    group: "experimental-features",
    lifecycle: "live",
    documentation: {
      public: true,
      description: "A synthetic public control.",
    },
  } as const satisfies DiscernEnvironmentVariableDefinition;
  const futureInternal = {
    name: futureInternalName,
    group: "test-controls",
    lifecycle: "live",
    documentation: {
      public: false,
      reason: "A synthetic internal control.",
    },
  } as const satisfies DiscernEnvironmentVariableDefinition;
  const document = renderEnvironmentVariableReferenceDoc(
    DISCERN_ENVIRONMENT_VARIABLE_GROUPS,
    {
      ...DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
      futurePublic,
      futureInternal,
    },
  );
  assertEquals(tableRowCount(document, futurePublicName), 1);
  assertEquals(aliasCount(document, futurePublicName), 1);
  assertEquals(
    documentedEnvironmentNames(document).has(futureInternalName),
    false,
  );
  const experiments = environmentVariableNamesForGroup(
    {
      ...DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
      futurePublic,
      futureInternal,
    },
    "experimental-features",
  );
  assertEquals(experiments.futurePublic, futurePublicName);
});

Deno.test("published manual pages never name internal environment variables", async () => {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.manual,
    includeInternal: false,
  });
  assert(tree, "the product manual exists");
  const manual = await buildManualProjection(tree.entries);
  const hidden = Object.values(DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS)
    .filter((definition) => !definition.documentation.public);
  const leaks: string[] = [];
  for (const { entry } of manual.pages) {
    const document = await Deno.readTextFile(entry.absPath);
    const documented = documentedEnvironmentNames(document);
    for (const definition of hidden) {
      if (documented.has(definition.name)) {
        leaks.push(`${entry.relToDocs}: ${definition.name}`);
      }
    }
  }
  assertEquals(
    leaks,
    [],
    "internal environment variables are unsupported implementation details and must stay out of published docs",
  );
});
