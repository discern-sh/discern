/** The canonical spawn population must declare and enforce publication exclusion. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  SUBPROCESS_SPAWN_BOUNDARIES,
  type SubprocessSpawnBoundary,
} from "./spawn_surfaces.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** New subprocess members must choose a publication contract explicitly. */
function unclassified(rows: readonly SubprocessSpawnBoundary[]): string[] {
  return rows.filter((row) => row.publication === undefined).map((row) =>
    `${row.path}#${row.enclosingFunction}`
  );
}

Deno.test("every subprocess boundary declares its publication execution contract", () => {
  assertEquals(unclassified(SUBPROCESS_SPAWN_BOUNDARIES), []);
  assertEquals(
    unclassified([{
      path: "future/runner.ts",
      enclosingFunction: "start",
      operation: "future command",
      reason: "a new direct execution boundary",
      may: ["other"],
      role: "registered-boundary",
    }]),
    ["future/runner.ts#start"],
  );
});

Deno.test("every project command boundary checks publication ownership before effects", async () => {
  const rows = SUBPROCESS_SPAWN_BOUNDARIES.filter((row) =>
    row.publication === "forbidden"
  );
  const files = new Set(
    await structuralGuardScope({
      guard: "tests/operation_execution_guard_test.ts#publication-execution",
      universe: "authored-ts",
    }),
  );
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
    skipAddingFilesFromTsConfig: true,
  });
  // All package interactions, including composed forms, construct this runtime.
  for (
    const row of [...rows, {
      path: "src/lib/terminal_interaction.ts",
      enclosingFunction: "packageInteractionRuntime",
    }]
  ) {
    assert(files.has(row.path));
    const source = project.getSourceFile(row.path) ??
      project.createSourceFile(
        row.path,
        await Deno.readTextFile(join(REPO_ROOT, row.path)),
      );
    const fn = source.getFunctionOrThrow(row.enclosingFunction);
    const first = fn.getStatements()[0];
    assert(
      first && Node.isExpressionStatement(first),
      `${row.path}#${row.enclosingFunction} must guard before effects`,
    );
    const expression = first.getExpression();
    assert(Node.isAwaitExpression(expression));
    const call = expression.getExpression();
    assert(Node.isCallExpression(call));
    assertEquals(
      call.getExpression().getText(),
      "assertOutsideCommonPublication",
    );
    assert(
      source.getDescendantsOfKind(SyntaxKind.ImportDeclaration).some((
        declaration,
      ) =>
        declaration.getModuleSpecifierValue().endsWith(
          "/operation_execution_boundary.ts",
        ) && declaration.getNamedImports().some((name) =>
          name.getName() === "assertOutsideCommonPublication"
        )
      ),
    );
  }
});
