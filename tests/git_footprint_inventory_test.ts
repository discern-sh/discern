/** Git configuration and ref ownership stay enrolled in both footprint pages. */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  DISCERN_GIT_CONFIG_FOOTPRINT,
  DISCERN_GIT_FOOTPRINT,
  DISCERN_GIT_REF_FOOTPRINT,
  DISCERN_OPTIONAL_REF_CLEANUP_ROOTS,
} from "../src/engine/git_footprint.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const FOOTPRINT_PAGES = [
  "project/manual/30-reference/files-and-ownership.md",
  "project/map/70-reference/artifact-ownership.md",
] as const;

/** Prefix before the first documented placeholder. */
function concretePrefix(pattern: string): string {
  return pattern.slice(
    0,
    pattern.indexOf("<") === -1 ? pattern.length : pattern.indexOf("<"),
  );
}

Deno.test("every Git config key and ref is documented from the footprint registry", async () => {
  const ids = [
    ...DISCERN_GIT_CONFIG_FOOTPRINT.map((entry) => entry.id),
    ...DISCERN_GIT_REF_FOOTPRINT.map((entry) => entry.id),
  ];
  assertEquals(
    new Set(ids).size,
    ids.length,
    "Git footprint ids must be unique",
  );
  assertEquals(
    new Set(DISCERN_GIT_FOOTPRINT).size,
    DISCERN_GIT_FOOTPRINT.length,
    "Git footprint members must be unique",
  );

  for (const path of FOOTPRINT_PAGES) {
    const page = await Deno.readTextFile(join(REPO_ROOT, path));
    for (const entry of DISCERN_GIT_CONFIG_FOOTPRINT) {
      assertStringIncludes(page, `\`${entry.key}\``, `${path}: ${entry.id}`);
    }
    for (const entry of DISCERN_GIT_REF_FOOTPRINT) {
      assertStringIncludes(page, `\`${entry.ref}\``, `${path}: ${entry.id}`);
    }
  }
});

Deno.test("optional cleanup roots derive from ref entries that uninstall retains", () => {
  const eligible = DISCERN_GIT_REF_FOOTPRINT.filter((entry) =>
    entry.optionalCleanup
  ).map((entry) => concretePrefix(entry.ref));
  assertEquals(
    [...DISCERN_OPTIONAL_REF_CLEANUP_ROOTS].sort(),
    eligible.sort(),
  );
  assertEquals(
    DISCERN_GIT_REF_FOOTPRINT.every((entry) => entry.uninstall === "retained"),
    true,
  );
});

Deno.test("Git-config mutation sites stay behind the registered owners", async () => {
  const files = await structuralGuardScope({
    guard: "tests/git_footprint_inventory_test.ts#config-mutation-owners",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only shipped source can mutate a user's clone-local Git configuration; scripts and tests operate under the repository owner's authority.",
      include: (path) => path.startsWith("src/"),
    },
  });
  const mutationTokens = new Set([
    "--add",
    "--replace-all",
    "--unset-all",
    "--remove-section",
  ]);
  const allowed = new Set([
    "src/engine/generated_merge_driver.ts",
    "src/engine/gate/proof_notes.ts",
    // Branch deletion removes Git's branch-scoped bookkeeping; it never writes
    // a discern-owned key and therefore is not a footprint member.
    "src/engine/worktree/ownership.ts",
  ]);
  const unexpected: string[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const file = project.createSourceFile(path, source);
    const mutatesConfig = file.getDescendantsOfKind(
      SyntaxKind.ArrayLiteralExpression,
    ).some((array) => {
      const literals = array.getElements().flatMap((node) =>
        Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
          ? [node.getLiteralText()]
          : []
      );
      return literals[0] === "config" &&
        literals.some((value) => mutationTokens.has(value));
    });
    if (mutatesConfig && !allowed.has(path)) unexpected.push(path);
  }
  assertEquals(unexpected.sort(), []);
});
