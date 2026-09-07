/** Every shipped lazy import crosses the same context-free evaluation boundary. */
import { assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./temp_dir.ts";
import { gitInit } from "./engine_helpers.ts";

const AUTHORITY = "src/shared/module_loading.ts";

/** Enrol future runtime containers without making tooling and fixtures product code. */
function runtimeFiles(root: string): Promise<string[]> {
  return structuralGuardScope({
    guard: "tests/module_loading_guard_test.ts#runtime-module-loading",
    universe: "authored-ts",
    narrow: {
      reason:
        "Runtime modules carry invocation capabilities; tests, tooling and the separate site are distinct execution surfaces.",
      include: (path) => !/^(tests|scripts|site)\//u.test(path),
    },
  }, root);
}

/** Follow local aliases to their actual import, rejecting shadowed lookalikes. */
function isLoader(node: Node | undefined, path: string, depth = 0): boolean {
  if (node === undefined || depth > 12) return false;
  if (Node.isParenthesizedExpression(node)) {
    return isLoader(node.getExpression(), path, depth + 1);
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (Node.isVariableDeclaration(declaration)) {
      return isLoader(declaration.getInitializer(), path, depth + 1);
    }
    return Node.isImportSpecifier(declaration) &&
      declaration.getName() === "loadModule" &&
      normalize(
          join(
            dirname(path),
            declaration.getImportDeclaration().getModuleSpecifierValue(),
          ),
        ) === AUTHORITY;
  }
  if (
    Node.isPropertyAccessExpression(node) && node.getName() === "loadModule"
  ) {
    const declaration = node.getExpression().getSymbol()?.getDeclarations()[0];
    const imported = declaration?.getFirstAncestorByKind(
      SyntaxKind.ImportDeclaration,
    );
    return Node.isNamespaceImport(declaration) && imported !== undefined &&
      normalize(join(dirname(path), imported.getModuleSpecifierValue())) ===
        AUTHORITY;
  }
  return false;
}

/** Check syntax with one bounded analysis graph and no dependency or library loading. */
function findings(
  sources: readonly { path: string; source: string }[],
): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { noLib: true, noResolve: true },
  });
  const parsed: { path: string; file: SourceFile }[] = sources.map((
    { path, source },
  ) => ({
    path,
    file: project.createSourceFile(path, source),
  }));
  const errors: string[] = [];
  for (const { path, file } of parsed) {
    for (
      const imported of [
        ...file.getImportDeclarations(),
        ...file.getExportDeclarations(),
      ]
    ) {
      const specifier = imported.getModuleSpecifierValue();
      if (
        path !== AUTHORITY && specifier !== undefined &&
        /^(?:node:)?async_hooks$/u.test(specifier)
      ) {
        errors.push(
          `${path}:${imported.getStartLineNumber()} import async context primitives from ${AUTHORITY}, before installing invocation state`,
        );
      }
    }
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const loader = call.getParent();
      const boundary = loader?.getParent();
      if (
        !Node.isArrowFunction(loader) || loader.getBody() !== call ||
        loader.getParameters().length !== 0 ||
        !Node.isCallExpression(boundary) ||
        boundary.getArguments().length !== 1 ||
        !isLoader(boundary.getExpression(), path)
      ) {
        errors.push(
          `${path}:${call.getStartLineNumber()} wrap lazy imports with loadModule(() => import(...)) from ${AUTHORITY}`,
        );
      }
    }
  }
  return errors;
}

Deno.test("runtime lazy imports and context owners share the module-loading boundary", async () => {
  const sources = await Promise.all(
    (await runtimeFiles(REPO_ROOT)).map(async (path) => ({
      path,
      source: await Deno.readTextFile(join(REPO_ROOT, path)),
    })),
  );
  assertEquals(findings(sources), []);
});

Deno.test("module loading guard enrols future trees, aliases and negative cases", async () => {
  await withTempDir(async (root) => {
    const path = "another/runtime/extension.ts";
    await Deno.mkdir(join(root, dirname(path)), { recursive: true });
    const prefix =
      'import { loadModule as load } from "../../src/shared/module_loading.ts";\n';
    const cases = [
      ['await import("./cold.ts");', 1],
      ['await load(() => import("./cold.ts"));', 0],
      ['const alias = load; await alias(() => import("./cold.ts"));', 0],
      [
        'async function f(load: Function) { await load(() => import("./cold.ts")); }',
        1,
      ],
      [
        'const fake = (fn: Function) => fn(); await fake(() => import("./cold.ts"));',
        1,
      ],
      ['await load(import("./cold.ts"));', 1],
      [
        'import * as context from "../../src/shared/module_loading.ts"; await context.loadModule(() => import("./cold.ts"));',
        0,
      ],
      ['import { AsyncLocalStorage as Context } from "node:async_hooks";', 1],
      ['import * as hooks from "async_hooks";', 1],
      ['export { AsyncLocalStorage } from "node:async_hooks";', 1],
      [
        'import { AsyncLocalStorage } from "../../src/shared/module_loading.ts";',
        0,
      ],
      ['type Loaded = typeof import("./cold.ts");', 0],
    ] as const;
    await Deno.writeTextFile(join(root, path), prefix + cases[0][0]);
    await gitInit(root);
    assertEquals(await runtimeFiles(root), [path]);
    for (const [body, count] of cases) {
      assertEquals(
        findings([{ path, source: prefix + body }]).length,
        count,
        body,
      );
    }
  });
});
