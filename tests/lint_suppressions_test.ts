/**
 * Deno lint suppression census controls.
 *
 * The detector recognizes both Deno directive forms in real line comments,
 * ignores comment-looking data, and shares the authored Deno-source universe
 * that enrolls new JavaScript and TypeScript files automatically.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  effectiveLintExclusions,
  type FileLintSuppression,
  lintSuppressionsInFiles,
  lintSuppressionsInSource,
} from "../scripts/lint_suppressions_lib.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { assertNamedCases } from "./assert_cases.ts";

const lineDirective = ["deno", "lint", "ignore"].join("-");
const fileDirective = `${lineDirective}-file`;

Deno.test("lint suppressions: lintSuppressionsInSource cases", () => {
  assertNamedCases({
    "lint suppression census recognizes both Deno directive forms": () => {
      const source = [
        `// ${fileDirective} no-explicit-any -- generated boundary`,
        "export const first = 1;",
        `  // ${lineDirective} no-explicit-any`,
        "export const second: any = 2;",
      ].join("\n");

      assertEquals(lintSuppressionsInSource(source), [
        { line: 1, directive: fileDirective },
        { line: 3, directive: lineDirective },
      ]);
    },
    "lint suppression census ignores non-directive text and block comments":
      () => {
        const source = [
          `const stringValue = "// ${lineDirective} no-explicit-any";`,
          `const templateValue = \`// ${fileDirective}\`;`,
          `const expression = /\\/\\/ ${lineDirective}/;`,
          `/* ${lineDirective} no-explicit-any */`,
          `// explains ${lineDirective} without becoming a directive`,
          `// ${lineDirective}d no-explicit-any`,
        ].join("\n");

        assertEquals(lintSuppressionsInSource(source), []);
      },
    "lint suppression census sees comments inside template expressions": () => {
      const source = [
        "const value = `${",
        `  // ${lineDirective} no-explicit-any`,
        "  String((globalThis as any).value)",
        "}`;",
      ].join("\n");

      assertEquals(lintSuppressionsInSource(source), [
        { line: 2, directive: lineDirective },
      ]);
    },
  });
});

Deno.test("lint suppressions: effectiveLintExclusions cases", () => {
  assertNamedCases({
    "lint exclusion census reports only effective authored-source patterns":
      () => {
        const config = JSON.stringify({
          lint: {
            exclude: [
              "site/build.ts",
              "site/page-src/",
              "future/**/*.ts",
              "dist/",
            ],
          },
        });
        assertEquals(
          effectiveLintExclusions(config, [
            "scripts/build.ts",
            "site/build.ts",
            "site/page-src/render.tsx",
            "future/nested/tool.ts",
          ]),
          [
            { pattern: "site/build.ts", files: ["site/build.ts"] },
            {
              pattern: "site/page-src/",
              files: ["site/page-src/render.tsx"],
            },
            { pattern: "future/**/*.ts", files: ["future/nested/tool.ts"] },
          ],
        );
      },
    "lint exclusion census enrolls a newly excluded future source": () => {
      assertEquals(
        effectiveLintExclusions(
          JSON.stringify({ lint: { exclude: ["another-root/"] } }),
          ["another-root/new-source.ts"],
        ),
        [
          {
            pattern: "another-root/",
            files: ["another-root/new-source.ts"],
          },
        ],
      );
    },
    "lint exclusion census counts the top-level exclude deno lint also applies":
      () => {
        assertEquals(
          effectiveLintExclusions(
            JSON.stringify({
              exclude: [".scratch/", "shared-root/"],
              lint: { exclude: ["lint-root/"] },
            }),
            ["shared-root/tool.ts", "lint-root/tool.ts", "src/main.ts"],
          ),
          [
            { pattern: "shared-root/", files: ["shared-root/tool.ts"] },
            { pattern: "lint-root/", files: ["lint-root/tool.ts"] },
          ],
        );
      },
    "lint exclusion census refuses a malformed exclusion list": () => {
      for (
        const config of [
          [],
          { exclude: "shared-root/" },
          { lint: { exclude: [1] } },
        ]
      ) {
        assertThrows(() => effectiveLintExclusions(JSON.stringify(config), []));
      }
    },
  });
});
Deno.test("lint suppression file scan reports repository-relative locations", async () => {
  await withTempDir(async (dir) => {
    const file = "nested/example.js";
    await Deno.mkdir(`${dir}/nested`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/${file}`,
      `// ${lineDirective} no-explicit-any\nconst value = 1;\n`,
    );

    assertEquals(await lintSuppressionsInFiles(dir, [file]), [
      { file, line: 1, directive: lineDirective },
    ]);
  });
});

/** Find forbidden directives in every authored source, including future roots. */
async function authoredLintSuppressions(
  root: string,
): Promise<FileLintSuppression[]> {
  const files = await structuralGuardScope({
    guard: "tests/lint_suppressions_test.ts#no-lint-suppressions",
    universe: "authored-deno",
  }, root);
  return await lintSuppressionsInFiles(root, files);
}

Deno.test("authored Deno sources contain no lint suppression directives", async () => {
  const findings = await authoredLintSuppressions(REPO_ROOT);
  assertEquals(
    findings,
    [],
    "Fix the named lint rule and remove each suppression directive. " +
      findings.map(({ file, line, directive }) =>
        `${file}:${line} ${directive}`
      ).join("\n"),
  );
});

Deno.test("lint suppression guard enrolls future roots and lint-excluded sources", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(`${root}/future-source`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ lint: { exclude: ["future-source/"] } }),
    );
    await Deno.writeTextFile(
      `${root}/future-source/line.mts`,
      `// ${lineDirective} no-explicit-any\nexport const value = 1;\n`,
    );
    await gitInit(root);
    await Deno.writeTextFile(
      `${root}/future-source/file.cjs`,
      `// ${fileDirective} no-explicit-any\nmodule.exports = 1;\n`,
    );
    assertEquals(await authoredLintSuppressions(root), [
      { file: "future-source/file.cjs", line: 1, directive: fileDirective },
      { file: "future-source/line.mts", line: 1, directive: lineDirective },
    ]);
  });
});
