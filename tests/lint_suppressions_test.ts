/**
 * Deno lint suppression census controls.
 *
 * The detector recognizes both Deno directive forms in real line comments,
 * ignores comment-looking data, and shares the authored Deno-source universe
 * that enrolls new JavaScript and TypeScript files automatically.
 */

import { assertEquals } from "@std/assert";
import {
  lintSuppressionsInFiles,
  lintSuppressionsInSource,
} from "../scripts/lint_suppressions_lib.ts";
import { withTempDir } from "./helpers.ts";

const lineDirective = ["deno", "lint", "ignore"].join("-");
const fileDirective = `${lineDirective}-file`;

Deno.test("lint suppression census recognizes both Deno directive forms", () => {
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
});

Deno.test("lint suppression census ignores non-directive text and block comments", () => {
  const source = [
    `const stringValue = "// ${lineDirective} no-explicit-any";`,
    `const templateValue = \`// ${fileDirective}\`;`,
    `const expression = /\\/\\/ ${lineDirective}/;`,
    `/* ${lineDirective} no-explicit-any */`,
    `// explains ${lineDirective} without becoming a directive`,
    `// ${lineDirective}d no-explicit-any`,
  ].join("\n");

  assertEquals(lintSuppressionsInSource(source), []);
});

Deno.test("lint suppression census sees comments inside template expressions", () => {
  const source = [
    "const value = `${",
    `  // ${lineDirective} no-explicit-any`,
    "  String((globalThis as any).value)",
    "}`;",
  ].join("\n");

  assertEquals(lintSuppressionsInSource(source), [
    { line: 2, directive: lineDirective },
  ]);
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
