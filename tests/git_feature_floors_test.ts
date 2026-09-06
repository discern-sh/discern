/** Git feature use may never raise the supported floor by accident. */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  compareGitVersions,
  formatGitVersion,
  GIT_FEATURE_FLOORS,
  type GitFeatureFloor,
  MIN_GIT_VERSION,
  parseGitVersion,
  supportedGitVersion,
} from "../src/shared/git_floor.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Report every source use whose registered feature floor exceeds support. */
function unsupportedFeatureUses(
  sources: ReadonlyMap<string, string>,
): string[] {
  const failures: string[] = [];
  for (const [path, source] of sources) {
    const project = new Project({
      compilerOptions: { noLib: true },
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const file = project.createSourceFile(path, source);
    const argv = file.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)
      .map((array) =>
        array.getElements().flatMap((node) =>
          Node.isStringLiteral(node) ||
            Node.isNoSubstitutionTemplateLiteral(node)
            ? [node.getLiteralText()]
            : []
        )
      );
    for (
      const feature of GIT_FEATURE_FLOORS as readonly GitFeatureFloor[]
    ) {
      if (compareGitVersions(feature.minimum, MIN_GIT_VERSION) <= 0) continue;
      const used = feature.subcommand === undefined
        ? source.includes(feature.token)
        : argv.some((values) =>
          values.includes(feature.subcommand ?? "") &&
          values.some((value) => value.includes(feature.token))
        );
      if (used) {
        failures.push(
          `${path}: ${feature.feature} requires Git ${
            formatGitVersion(feature.minimum)
          }`,
        );
      }
    }
  }
  return failures.sort();
}

Deno.test("every authored Git feature stays at or below the declared minimum", async () => {
  const files = await structuralGuardScope({
    guard: "tests/git_feature_floors_test.ts#authored-git-features",
    universe: "authored-ts",
    narrow: {
      reason:
        "The feature-floor registry declares its own detection tokens, so only that authority module is excluded from use sites.",
      include: (path) =>
        path !== "src/shared/git_floor.ts" &&
        path !== "tests/git_feature_floors_test.ts",
    },
  });
  const sources = new Map<string, string>();
  for (const path of files) {
    sources.set(path, await Deno.readTextFile(join(REPO_ROOT, path)));
  }
  assertEquals(unsupportedFeatureUses(sources), []);
});

Deno.test("the feature-floor detector rejects a source use above the floor", () => {
  assertEquals(
    unsupportedFeatureUses(
      new Map([["future.ts", '["ls-tree", "--format=%(path)"]']]),
    ),
    ["future.ts: git ls-tree custom formatting requires Git 2.36.0"],
  );
});

Deno.test("Git version parsing holds the 2.30 boundary and accepts vendor suffixes", () => {
  assertEquals(parseGitVersion("git version 2.30.0"), MIN_GIT_VERSION);
  assertEquals(supportedGitVersion("git version 2.29.9"), false);
  assertEquals(supportedGitVersion("git version 2.30.0"), true);
  assertEquals(
    supportedGitVersion("git version 2.39.3 (Apple Git-146)"),
    true,
  );
  assertStringIncludes(formatGitVersion(MIN_GIT_VERSION), "2.30");
});
