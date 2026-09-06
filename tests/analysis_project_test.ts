/** Source analysis must declare library types instead of loading them implicitly. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { resolveSpawnExpression } from "../scripts/subprocess_spawn_boundaries.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Identify a ts-morph constructor through local aliases and namespace imports. */
function isAnalysisConstructor(expression: Node): boolean {
  const resolved = resolveSpawnExpression(expression);
  if (resolved === undefined) return false;
  const identifier = Node.isPropertyAccessExpression(resolved)
    ? resolved.getName() === "Project" ? resolved.getExpression() : undefined
    : resolved;
  const declaration = identifier?.getSymbol()?.getDeclarations()[0];
  if (
    declaration === undefined ||
    !(Node.isImportSpecifier(declaration) &&
        declaration.getName() === "Project" ||
      Node.isNamespaceImport(declaration))
  ) return false;
  return declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
    ?.getModuleSpecifierValue() === "ts-morph";
}

/** Require an explicit no-library choice or a concrete library family. */
function explicitLibraries(options: Node | undefined): boolean {
  const resolved = resolveSpawnExpression(options);
  if (!Node.isObjectLiteralExpression(resolved)) return false;
  const compiler = resolved.getProperty("compilerOptions");
  if (!Node.isPropertyAssignment(compiler)) return false;
  const settings = resolveSpawnExpression(compiler.getInitializer());
  if (!Node.isObjectLiteralExpression(settings)) return false;
  const noLib = settings.getProperty("noLib");
  if (
    Node.isPropertyAssignment(noLib) &&
    noLib.getInitializer()?.getKind() === SyntaxKind.TrueKeyword
  ) return true;
  const lib = settings.getProperty("lib");
  if (!Node.isPropertyAssignment(lib)) return false;
  const libraries = lib.getInitializer();
  return Node.isArrayLiteralExpression(libraries) &&
    libraries.getElements().length > 0;
}

/** Inspect local binding declarations without loading library declarations. */
function implicitLibraryFindings(path: string, source: string): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
  });
  const file = project.createSourceFile(path, source);
  return file.getDescendantsOfKind(SyntaxKind.NewExpression).filter((node) =>
    isAnalysisConstructor(node.getExpression()) &&
    !explicitLibraries(node.getArguments()[0])
  ).map((node) =>
    `${path}:${node.getStartLineNumber()}: source analysis must set compilerOptions.noLib or explicitly select compilerOptions.lib`
  );
}

Deno.test("analysis library enrollment follows renamed constructors and option aliases", () => {
  const imports = 'import { Project as Analysis } from "ts-morph";\n';
  for (
    const source of [
      "new Analysis();",
      "const Builder = Analysis; new Builder({ useInMemoryFileSystem: true });",
      "const settings = {}; new Analysis(settings);",
    ]
  ) {
    assertEquals(
      implicitLibraryFindings("future.ts", imports + source).length,
      1,
    );
  }
  assertEquals(
    implicitLibraryFindings(
      "future.ts",
      [
        'import * as compiler from "ts-morph";',
        "const Different = compiler.Project; new Different({});",
      ].join("\n"),
    ).length,
    1,
  );
  for (
    const source of [
      "new Analysis({ compilerOptions: { noLib: true } });",
      "const settings = { compilerOptions: { lib: ['lib.esnext.d.ts'] } }; new Analysis(settings);",
      "function shadow(Analysis: unknown) { new Analysis({}); }",
    ]
  ) assertEquals(implicitLibraryFindings("future.ts", imports + source), []);
});

Deno.test("every authored analysis project declares its library requirements", async () => {
  const findings: string[] = [];
  for (
    const path of await structuralGuardScope({
      guard: "tests/analysis_project_test.ts#explicit-analysis-libraries",
      universe: "authored-ts",
    })
  ) {
    findings.push(...implicitLibraryFindings(
      path,
      await Deno.readTextFile(join(REPO_ROOT, path)),
    ));
  }
  assertEquals(findings, []);
});
