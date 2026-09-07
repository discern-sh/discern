/** Host-duration checks must declare the exact lifecycle they measure. */
import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { TEST_ELAPSED_BOUNDARIES } from "./test_elapsed_boundaries.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./temp_dir.ts";
import { gitInit } from "./engine_helpers.ts";

const ORIGINS = new WeakMap<Node, string | undefined>();

/** Resolve each syntax node once, including cycles between local aliases. */
function origin(
  node: Node | undefined,
  path: string,
  depth = 0,
): string | undefined {
  if (node === undefined || depth > 16) return undefined;
  if (ORIGINS.has(node)) return ORIGINS.get(node);
  ORIGINS.set(node, undefined);
  const value = resolveOrigin(node, path, depth);
  ORIGINS.set(node, value);
  return value;
}

/** Resolve imported capabilities and local aliases without loading dependencies. */
function resolveOrigin(
  node: Node | undefined,
  path: string,
  depth = 0,
): string | undefined {
  if (node === undefined || depth > 16) return undefined;
  if (Node.isParenthesizedExpression(node)) {
    return origin(node.getExpression(), path, depth + 1);
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (Node.isVariableDeclaration(declaration)) {
      return origin(declaration.getInitializer(), path, depth + 1);
    }
    if (Node.isFunctionDeclaration(declaration)) {
      const returns = declaration.getDescendantsOfKind(
        SyntaxKind.ReturnStatement,
      );
      const values = new Set(
        returns.map((statement) =>
          origin(statement.getExpression(), path, depth + 1)
        ),
      );
      if (values.size === 1) return [...values][0];
    }
    if (Node.isImportSpecifier(declaration)) {
      const target = normalize(
        join(
          dirname(path),
          declaration.getImportDeclaration().getModuleSpecifierValue(),
        ),
      );
      if (
        target === "src/shared/clock.ts" &&
        declaration.getName() === "SYSTEM_CLOCK"
      ) return "clock";
    }
    if (Node.isBindingElement(declaration)) {
      const parent = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const property = declaration.getPropertyNameNode()?.getText() ??
        declaration.getName();
      if (origin(parent?.getInitializer(), path, depth + 1) === "clock") {
        return property;
      }
    }
  }
  if (Node.isPropertyAccessExpression(node)) {
    if (origin(node.getExpression(), path, depth + 1) === "clock") {
      return node.getName();
    }
    const declaration = node.getExpression().getSymbol()?.getDeclarations()[0];
    if (
      Node.isNamespaceImport(declaration) && node.getName() === "SYSTEM_CLOCK"
    ) {
      const imported = declaration.getFirstAncestorByKind(
        SyntaxKind.ImportDeclaration,
      );
      if (
        imported &&
        normalize(join(dirname(path), imported.getModuleSpecifierValue())) ===
          "src/shared/clock.ts"
      ) return "clock";
    }
  }
  if (Node.isArrowFunction(node) && !Node.isBlock(node.getBody())) {
    return origin(node.getBody(), path, depth + 1);
  }
  if (Node.isCallExpression(node)) {
    return origin(node.getExpression(), path, depth + 1);
  }
  return undefined;
}

/** Bind a read to its nearest named helper or test, including nested callbacks. */
function enclosing(node: Node): string {
  for (const parent of node.getAncestors()) {
    if (Node.isFunctionDeclaration(parent)) {
      return parent.getName() ?? "<anonymous>";
    }
    if (
      Node.isCallExpression(parent) &&
      parent.getExpression().getText() === "Deno.test"
    ) {
      const first = parent.getArguments()[0];
      if (
        Node.isStringLiteral(first) ||
        Node.isNoSubstitutionTemplateLiteral(first)
      ) return first.getLiteralValue();
      if (Node.isObjectLiteralExpression(first)) {
        const name = first.getProperty("name");
        const value = Node.isPropertyAssignment(name)
          ? name.getInitializer()
          : undefined;
        if (Node.isStringLiteral(value)) return value.getLiteralValue();
      }
    }
  }
  return "<module>";
}

/** Census host monotonic reads and paired wall-clock duration subtraction. */
function observations(
  sources: readonly { path: string; source: string }[],
): Map<string, number> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { noLib: true, noResolve: true },
  });
  const counts = new Map<string, number>();
  for (const { path, source } of sources) {
    const file = project.createSourceFile(path, source);
    const reads = new Set<Node>();
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (origin(call, path) === "monotonicNow") reads.add(call);
    }
    for (
      const difference of file.getDescendantsOfKind(SyntaxKind.BinaryExpression)
    ) {
      if (difference.getOperatorToken().getKind() !== SyntaxKind.MinusToken) {
        continue;
      }
      if (
        origin(difference.getLeft(), path) !== "wallNow" ||
        origin(difference.getRight(), path) !== "wallNow"
      ) continue;
      // Count the paired wall measurement once, normalized to its two samples.
      const key = `${path}#${enclosing(difference)}`;
      counts.set(key, (counts.get(key) ?? 0) + 2);
    }
    for (const call of reads) {
      const key = `${path}#${enclosing(call)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Discover test modules and their fixture tree from Git, including new containers. */
function testFiles(root: string): Promise<string[]> {
  return structuralGuardScope({
    guard: "tests/test_elapsed_guard_test.ts#host-elapsed-boundaries",
    universe: "authored-ts",
    narrow: {
      reason:
        "Test and fixture execution owns assertion deadlines; runtime durations are product observations, not test verdicts.",
      include: (path) =>
        path.startsWith("tests/") || /(?:^|\/)[^/]+_test\.tsx?$/u.test(path),
    },
  }, root);
}

Deno.test("host elapsed measurements have reviewed lifecycle boundaries", async () => {
  const paths = await testFiles(REPO_ROOT);
  for (const row of TEST_ELAPSED_BOUNDARIES) {
    assert(
      row.reason.length > 0 && row.reads > 0,
      "each retained interval needs a reason and positive census",
    );
  }
  const sources = await Promise.all(
    paths.map(async (path) => ({
      path,
      source: await Deno.readTextFile(join(REPO_ROOT, path)),
    })),
  );
  const expected = new Map(
    TEST_ELAPSED_BOUNDARIES.map(
      (row) => [`${row.path}#${row.enclosing}`, row.reads],
    ),
  );
  assertEquals(
    expected.size,
    TEST_ELAPSED_BOUNDARIES.length,
    "duplicate boundary rows cannot hide a second interpretation",
  );
  assertEquals(
    [...observations(sources)].sort(),
    [...expected].sort(),
    "Use an injected clock/scheduler to assert a budget. A retained host duration needs an exact reviewed interval in test_elapsed_boundaries.ts; readiness alone does not exclude later restoration.",
  );
});

Deno.test("elapsed guard follows aliases and fresh helpers without enrolling timestamps or fake clocks", () => {
  const path = "another_test.ts";
  const prefix = 'import {SYSTEM_CLOCK as host} from "./src/shared/clock.ts";';
  const cases: readonly [string, number][] = [
    [
      "function instant() { return host.wallNow(); } function unrelated() { const before = instant(); return instant() - before; }",
      2,
    ],
    [
      "async function unrelated() { const begin = host.monotonicNow(); await work(); return host.monotonicNow() - begin; }",
      2,
    ],
    [
      "const alias = host; function other() { return alias.monotonicNow(); }",
      1,
    ],
    [
      "const {monotonicNow: sample} = host; function elsewhere() { return sample(); }",
      1,
    ],
    [
      "const sample = host.monotonicNow; function elsewhere() { return sample(); }",
      1,
    ],
    [
      "function elsewhere() { const begin = host.wallNow(); return host.wallNow() - begin; }",
      2,
    ],
    [
      "const timestamp = host.wallNow(); const age = host.wallNow() - Date.parse(record);",
      0,
    ],
    ["function elsewhere(host: Clock) { return host.monotonicNow(); }", 0],
    [
      "const fake = {monotonicNow: () => 99}; function elsewhere() { return fake.monotonicNow(); }",
      0,
    ],
    [
      'import * as times from "./src/shared/clock.ts"; function elsewhere() { return times.SYSTEM_CLOCK.monotonicNow(); }',
      1,
    ],
  ];
  for (const [body, count] of cases) {
    assertEquals(
      [...observations([{ path, source: prefix + body }]).values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
      count,
      body,
    );
  }
});

Deno.test("elapsed measurements in a future test tree auto-enrol", async () => {
  await withTempDir(async (root) => {
    const path = "checks/another/unrelated_test.ts";
    await Deno.mkdir(join(root, dirname(path)), { recursive: true });
    const source =
      'import {SYSTEM_CLOCK as source} from "../../src/shared/clock.ts"; function unrelated() { return source.monotonicNow(); }';
    await Deno.writeTextFile(join(root, path), source);
    await gitInit(root);
    assertEquals(await testFiles(root), [path]);
    assertEquals([...observations([{ path, source }])], [[
      `${path}#unrelated`,
      1,
    ]]);
  });
});
