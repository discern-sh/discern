/** Architectural guard for declared ownership of test temp directories. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const AUTHORITY = "tests/temp_dir.ts";
const RAW_CREATORS = new Set(["makeTempDir", "makeTempDirSync"]);

/** Return raw Deno temp-directory creation calls in one TypeScript module. */
function tempDirFindings(path: string, source: string): string[] {
  if (path === AUTHORITY) return [];
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.createSourceFile(path, source, {
    overwrite: true,
  });
  const findings: string[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = call.getExpression();
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getExpression().getText() === "Deno" &&
      RAW_CREATORS.has(callee.getName())
    ) {
      findings.push(`${path}:${call.getStartLineNumber()} ${callee.getText()}`);
      continue;
    }
    if (
      Node.isElementAccessExpression(callee) &&
      callee.getExpression().getText() === "Deno"
    ) {
      const argument = callee.getArgumentExpression();
      if (
        argument !== undefined && Node.isStringLiteral(argument) &&
        RAW_CREATORS.has(argument.getLiteralValue())
      ) {
        findings.push(
          `${path}:${call.getStartLineNumber()} ${callee.getText()}`,
        );
      }
    }
  }
  return findings;
}

Deno.test("the temp-directory guard catches ordinary tests and executable fixtures", () => {
  assertEquals(
    tempDirFindings(
      "tests/future-owner_test.ts",
      "Deno.test('future', async () => { await Deno.makeTempDir(); });\n",
    ),
    ["tests/future-owner_test.ts:1 Deno.makeTempDir"],
  );
  assertEquals(
    tempDirFindings(
      "tests/fixtures/future_runner.ts",
      "export const dir = Deno['makeTempDirSync']();\n",
    ),
    ["tests/fixtures/future_runner.ts:1 Deno['makeTempDirSync']"],
  );
  assertEquals(
    tempDirFindings(
      AUTHORITY,
      "Deno.makeTempDir(); Deno.makeTempDirSync();\n",
    ),
    [],
  );
});

Deno.test("test temp directories come only from the ownership capability", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/temp_dir_guard_test.ts#declared-temp-dir-ownership",
      universe: {
        kind: "specialized",
        name: "test-typescript-including-fixtures",
        extensions: [".ts"],
        reason:
          "Executable TypeScript fixtures are omitted from authored-ts but run as test code.",
      },
      narrow: {
        reason:
          "Runtime code may create registered temp artifacts; every test and executable-fixture directory needs declared ownership.",
        include: (path) => path.startsWith("tests/"),
      },
    })
  ) {
    offenders.push(...tempDirFindings(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(
    offenders,
    [],
    "raw test temp-directory creation has no declared cleanup boundary; " +
      "use withTempDir or suiteTempDir from tests/temp_dir.ts",
  );
});
