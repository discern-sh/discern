/** Class guard for every authored real-PTY test and transport container. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  claimRealPtyBoundary,
  REAL_PTY_CONTRACTS,
  type RealPtyContract,
} from "./real_pty.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./helpers.ts";
import {
  runAgentPtyJourney,
  runAgentPtyWithViewport,
} from "./engine_helpers.ts";

interface PtyPrimitiveSite {
  readonly path: string;
  readonly owner: string;
  readonly primitive: string;
  readonly line: number;
}

interface PtyDeclarationSite {
  readonly path: string;
  readonly line: number;
  readonly contracts: readonly RealPtyContract[];
  readonly canary: boolean;
}

const APPROVED_PTY_PRIMITIVES = new Set([
  "tests/fixtures/pty_process.ts#<module>#module:package-pty",
  "tests/fixtures/interactive_tty_harness.ts#stty#command:stty",
  "tests/fixtures/desk_tty_harness.ts#stty#command:stty",
  "tests/fixtures/terminal_resize_harness.ts#stty#command:stty",
]);

/** Every authored test, fixture, and terminal-review tool joins by Git. */
async function ptyGuardFiles(root: string = REPO_ROOT): Promise<string[]> {
  return await structuralGuardScope({
    guard: "tests/real_pty_guard_test.ts#real-pty-boundary",
    universe: {
      kind: "specialized",
      name: "test TypeScript including executable fixture containers",
      reason:
        "The canonical authored TypeScript universe deliberately excludes fixtures, while PTY transports can be introduced by executable fixtures.",
      extensions: [".ts"],
    },
    narrow: {
      reason:
        "Real PTY construction belongs to tests and the terminal-review tooling that deliberately reuses their canonical driver.",
      include: (path) =>
        path.startsWith("tests/") || path.startsWith("scripts/terminal_"),
    },
  }, root);
}

/** Stable enclosing function name for one primitive constructor. */
function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.getName() ?? "<anonymous>";
    }
    if (Node.isMethodDeclaration(ancestor)) return ancestor.getName();
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const parent = ancestor.getParent();
      if (Node.isVariableDeclaration(parent)) return parent.getName();
      if (Node.isPropertyAssignment(parent)) return parent.getName();
    }
  }
  return "<module>";
}

/** Find PTY process/device primitives independently of fixture or test names. */
function primitiveSitesInSourceFile(
  path: string,
  sourceFile: SourceFile,
): PtyPrimitiveSite[] {
  const sites: PtyPrimitiveSite[] = [];
  const add = (node: Node, primitive: string): void => {
    sites.push({
      path,
      owner: enclosingFunction(node),
      primitive,
      line: sourceFile.getLineAndColumnAtPos(node.getStart()).line,
    });
  };
  for (
    const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)
  ) {
    if (node.getExpression().getText() !== "Deno.Command") continue;
    const binary = node.getArguments()[0];
    if (!Node.isStringLiteral(binary)) continue;
    if (
      binary.getLiteralValue() === "script" ||
      binary.getLiteralValue() === "stty"
    ) {
      add(node, `command:${binary.getLiteralValue()}`);
    }
  }
  for (const node of sourceFile.getImportDeclarations()) {
    const specifier = node.getModuleSpecifierValue();
    if (
      specifier === "discern-design-system/cli/interactive/testing" &&
      (node.getNamespaceImport() !== undefined ||
        node.getNamedImports().some((entry) =>
          entry.getName() === "runPtyProcess"
        ))
    ) {
      add(node, "module:package-pty");
    }
    if (
      /(?:^|[/@-])(?:node-pty|openpty|forkpty)(?:$|[/@-])/iu.test(specifier)
    ) {
      add(node, `module:${specifier}`);
    }
  }
  for (
    const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const name = node.getExpression().getText().split(".").at(-1);
    if (
      name !== undefined && /^(?:openpty|forkpty|posix_openpt)$/u.test(name)
    ) {
      add(node, `call:${name}`);
    }
  }
  for (
    const node of sourceFile.getDescendantsOfKind(
      SyntaxKind.StringLiteral,
    )
  ) {
    if (/^\/dev\/(?:tty|ptmx|pts\/)/u.test(node.getLiteralValue())) {
      add(node, `device:${node.getLiteralValue()}`);
    }
  }
  return sites;
}

/** Parse one synthetic source for adversarial fresh-container tests. */
function primitiveSitesInSource(
  path: string,
  source: string,
): PtyPrimitiveSite[] {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return primitiveSitesInSourceFile(
    path,
    project.createSourceFile(path, source),
  );
}

/** Resolve local bindings used for declared real-PTY boundaries. */
function realPtyDeclarationBindings(sourceFile: SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!/real_pty\.ts$/u.test(declaration.getModuleSpecifierValue())) continue;
    for (const imported of declaration.getNamedImports()) {
      if (
        imported.getName() !== "realPtyTest" &&
        imported.getName() !== "withRealPtyBoundary"
      ) continue;
      bindings.add(imported.getAliasNode()?.getText() ?? imported.getName());
    }
  }
  return bindings;
}

/** Literal property from a realPtyTest declaration object. */
function property(
  object: import("ts-morph").ObjectLiteralExpression,
  name: string,
): Node | undefined {
  const value = object.getProperty(name);
  return Node.isPropertyAssignment(value) ? value.getInitializer() : undefined;
}

/** Machine-readable declarations used by both the guard and canary census. */
function declarationSitesInSourceFile(
  path: string,
  sourceFile: SourceFile,
): { readonly sites: PtyDeclarationSite[]; readonly findings: string[] } {
  const bindings = realPtyDeclarationBindings(sourceFile);
  const sites: PtyDeclarationSite[] = [];
  const findings: string[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    if (!bindings.has(call.getExpression().getText())) continue;
    const line = sourceFile.getLineAndColumnAtPos(call.getStart()).line;
    const object = call.getArguments()[0];
    if (!Node.isObjectLiteralExpression(object)) {
      findings.push(
        `${path}:${line} realPtyTest needs an inline declaration object`,
      );
      continue;
    }
    const contractsNode = property(object, "contracts");
    const canaryNode = property(object, "canary");
    if (!Node.isArrayLiteralExpression(contractsNode)) {
      findings.push(
        `${path}:${line} realPtyTest contracts must be an inline literal array`,
      );
      continue;
    }
    const contracts: RealPtyContract[] = [];
    for (const member of contractsNode.getElements()) {
      if (!Node.isStringLiteral(member)) {
        findings.push(
          `${path}:${line} realPtyTest contract must be a string literal`,
        );
        continue;
      }
      const contract = member.getLiteralValue();
      if (!(contract in REAL_PTY_CONTRACTS)) {
        findings.push(
          `${path}:${line} realPtyTest names unknown contract '${contract}'`,
        );
        continue;
      }
      contracts.push(contract as RealPtyContract);
    }
    if (contracts.length === 0) {
      findings.push(
        `${path}:${line} realPtyTest must name at least one contract`,
      );
    }
    if (
      canaryNode?.getKind() !== SyntaxKind.TrueKeyword &&
      canaryNode?.getKind() !== SyntaxKind.FalseKeyword
    ) {
      findings.push(
        `${path}:${line} realPtyTest canary must be a boolean literal`,
      );
      continue;
    }
    sites.push({
      path,
      line,
      contracts,
      canary: canaryNode.getKind() === SyntaxKind.TrueKeyword,
    });
  }
  return { sites, findings };
}

/** Load and parse the complete live guard universe once. */
async function liveSources(): Promise<ReadonlyMap<string, SourceFile>> {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const sources = new Map<string, SourceFile>();
  for (const path of await ptyGuardFiles()) {
    sources.set(
      path,
      project.createSourceFile(
        path,
        await Deno.readTextFile(join(REPO_ROOT, path)),
      ),
    );
  }
  return sources;
}

Deno.test("a fresh PTY fixture container cannot construct a parallel transport", async () => {
  await withTempDir(async (root) => {
    await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
    const path = "tests/foreign-rig/scenes/orbit_console.ts";
    const source = `
export async function openOrbitConsole(): Promise<void> {
  await new Deno.Command("script", { args: ["-q", "/dev/null", "true"] }).output();
}
`;
    await Deno.mkdir(dirname(join(root, path)), { recursive: true });
    await Deno.writeTextFile(join(root, path), source);

    assert(
      (await ptyGuardFiles(root)).includes(path),
      "a new fixture container must join the Git-derived real-PTY universe",
    );
    for (
      const binding of ["{ runPtyProcess as openConsole }", "* as instruments"]
    ) {
      const imported = primitiveSitesInSource(
        path,
        `import ${binding} from "discern-design-system/cli/interactive/testing";`,
      );
      assertEquals(imported.map((site) => site.primitive), [
        "module:package-pty",
      ]);
    }
    const sites = primitiveSitesInSource(path, source);
    assertEquals(
      sites.map((site) => `${site.path}#${site.owner}#${site.primitive}`),
      [
        "tests/foreign-rig/scenes/orbit_console.ts#openOrbitConsole#command:script",
      ],
    );
  });
});

Deno.test("the canonical PTY driver rejects an undeclared fresh consumer", async () => {
  const driver = new URL("./fixtures/pty_process.ts", import.meta.url).href;
  const source = `
import { runPtyProcess } from ${JSON.stringify(driver)};
async function orbitConsoleTest(): Promise<void> {
  await runPtyProcess({ command: "true", args: [] });
}
await orbitConsoleTest();
`;
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--no-check",
      source,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  assertEquals(result.success, false, output);
  assertStringIncludes(
    output,
    "real PTY use requires a realPtyTest or withRealPtyBoundary declaration",
  );
  assertStringIncludes(output, "orbitConsoleTest");
  assertThrows(
    () => claimRealPtyBoundary(),
    Error,
    "realPtyTest or withRealPtyBoundary declaration",
  );
});

Deno.test("real PTY primitives and package transport remain enclosed by their canonical authorities", async () => {
  const sources = await liveSources();
  const sites = [...sources].flatMap(([path, source]) =>
    primitiveSitesInSourceFile(path, source)
  );
  const actual = sites.map((site) =>
    `${site.path}#${site.owner}#${site.primitive}`
  ).sort();
  assertEquals(actual, [...APPROVED_PTY_PRIMITIVES].sort());
});

Deno.test("real PTY declarations are literal and retain every OS-boundary canary", async () => {
  const sources = await liveSources();
  const findings: string[] = [];
  const sites = [...sources].flatMap(([path, source]) => {
    const result = declarationSitesInSourceFile(path, source);
    findings.push(...result.findings);
    return result.sites;
  });
  for (const contract of Object.keys(REAL_PTY_CONTRACTS) as RealPtyContract[]) {
    if (
      !sites.some((site) => site.canary && site.contracts.includes(contract))
    ) {
      findings.push(`real PTY contract '${contract}' has no retained canary`);
    }
  }
  assertEquals(findings.sort(), []);
});

Deno.test("public-command PTYs cannot override the shared completion allowance", () => {
  const futureConsumer = (): void => {
    void runAgentPtyJourney("/synthetic/project", ["done"], {
      input: [],
      // @ts-expect-error — product journeys do not own infrastructure deadlines
      timeoutMs: 12_000,
    });
    void runAgentPtyWithViewport("/synthetic/project", ["test"], {
      size: { columns: 80, rows: 24 },
      // @ts-expect-error — timeout behavior is tested at the transport boundary
      timeoutMs: 8_000,
    });
  };
  assertEquals(typeof futureConsumer, "function");
});
