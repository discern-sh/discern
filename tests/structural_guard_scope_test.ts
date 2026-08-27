/** Architectural enrollment guard for structural-guard scope declarations. */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { fileExists } from "../src/shared/fs_presence.ts";

interface ScopeFinding {
  readonly line: number;
  readonly message: string;
}

const AUTHORED_PATHS_MODULE = "repo_authored_paths.ts";
const NON_GUARD_MODULES = new Map([
  [
    "tests/repo_authored_paths.ts",
    "This module implements the Git-derived universes rather than enforcing a cross-file invariant.",
  ],
  [
    "tests/repo_authored_paths_test.ts",
    "These behavioral tests exercise the universe implementation against injected Git fixtures.",
  ],
  [
    "tests/structural_guard_scope.ts",
    "This module is the declaration capability and must consume the underlying universe implementation.",
  ],
  [
    "tests/host_metadata_ingress_test.ts",
    "This behavioral test injects Git metadata files to verify the underlying authored-text projection.",
  ],
  [
    "scripts/build.ts",
    "The binary builder traverses caller-supplied physical resource roots to exclude unauthored entries; it does not enforce a cross-file source invariant.",
  ],
]);
const CANONICAL_IMPORT =
  /^(?:AUTHORED_(?:TS|DENO|TEXT)_FILES|TRACKED_MD_FILES|authored(?:Ts|Deno|Text)Files|trackedMarkdownFiles|gitListed(?:Repo|Text)Files)$/;

const REPO_RELATIVE_ROOT =
  /^(?:\.github|art|project|scripts|site|src|templates|tests|types)(?:\/|$)/;

/** Parse one module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Return an object's named property when it is a literal declaration object. */
function objectProperty(
  object: Node,
  name: string,
): Node | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const property = object.getProperty(name);
  if (property === undefined || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  return property.getInitializer();
}

/** Whether a path expression is visibly anchored in this repository. */
function repoRooted(
  expression: Node,
  seen = new Set<string>(),
  traceParameters = true,
): boolean {
  const text = expression.getText();
  if (
    (Node.isIdentifier(expression) ||
      Node.isPropertyAccessExpression(expression)) &&
    /\b(?:REPO|REPO_ROOT|REPO_AUTHORED_PATHS|SRC|SITE|TEMPLATES|WORKFLOWS|GITHUB|ADR_DIR|ADRS|MAP_DIR|CHECKPOINTS_DIR|STYLE_DIR)\b/
      .test(text)
  ) {
    return true;
  }
  if (
    (Node.isStringLiteral(expression) ||
      Node.isNoSubstitutionTemplateLiteral(expression)) &&
    REPO_RELATIVE_ROOT.test(expression.getLiteralValue())
  ) {
    return true;
  }
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().some((element) =>
      repoRooted(element, seen, traceParameters)
    );
  }
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression().getText();
    if (/^(?:join|resolve|fromFileUrl)$/.test(callee)) {
      const first = expression.getArguments()[0];
      return first !== undefined && repoRooted(first, seen, traceParameters);
    }
    return false;
  }
  if (Node.isNewExpression(expression)) {
    const args = expression.getArguments();
    if (
      expression.getExpression().getText() === "URL" &&
      args[1]?.getText() === "import.meta.url" &&
      args[0] !== undefined
    ) {
      return true;
    }
  }
  if (Node.isIdentifier(expression)) {
    if (seen.has(text)) return false;
    seen.add(text);
    const enclosingForOf = expression.getFirstAncestorByKind(
      SyntaxKind.ForOfStatement,
    );
    if (
      enclosingForOf !== undefined &&
      enclosingForOf.getInitializer().getText().includes(text) &&
      repoRooted(
        enclosingForOf.getExpression(),
        seen,
        traceParameters,
      )
    ) {
      return true;
    }
    const localVariables = expression.getSourceFile()
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .filter((node) => node.getName() === text);
    for (const node of localVariables) {
      const initializer = node.getInitializer();
      if (
        initializer !== undefined &&
        repoRooted(initializer, seen, traceParameters)
      ) {
        return true;
      }
    }
    if (!traceParameters) return false;
    for (const declaration of expression.getDefinitions()) {
      const node = declaration.getDeclarationNode();
      if (node !== undefined && Node.isVariableDeclaration(node)) {
        const initializer = node.getInitializer();
        if (
          initializer !== undefined &&
          repoRooted(initializer, seen, traceParameters)
        ) {
          return true;
        }
      }
      if (
        traceParameters && node !== undefined &&
        Node.isParameterDeclaration(node)
      ) {
        const fn = node.getParent();
        if (!Node.isFunctionDeclaration(fn)) continue;
        const name = fn.getName();
        const index = fn.getParameters().indexOf(node);
        if (name === undefined || index < 0) continue;
        const sourceFile = expression.getSourceFile();
        for (
          const call of sourceFile.getDescendantsOfKind(
            SyntaxKind.CallExpression,
          )
        ) {
          if (call.getExpression().getText() === name) {
            const argument = call.getArguments()[index];
            if (
              argument !== undefined &&
              repoRooted(argument, seen, traceParameters)
            ) {
              return true;
            }
          }
          const callback = call.getArguments()[0];
          const callee = call.getExpression();
          if (
            callback?.getText() === name &&
            Node.isPropertyAccessExpression(callee) &&
            callee.getName() === "map" &&
            repoRooted(callee.getExpression(), seen, traceParameters)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Whether a module has the source-inspection half of the class predicate. */
function inspectsSource(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((
    call,
  ) =>
    /(?:readTextFile|readFile|runPlugin|createSourceFile)$/.test(
      call.getExpression().getText(),
    )
  );
}

/** Whether one syntax subtree reads source text or parses a source module. */
function subtreeInspectsSource(node: Node): boolean {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) =>
    /(?:readTextFile|readFile|runPlugin|createSourceFile)$/.test(
      call.getExpression().getText(),
    )
  );
}

/** Find undeclared canonical consumers and hand-rooted authored-source walks. */
function scopeFindings(
  path: string,
  source: string,
  parsed?: SourceFile,
): ScopeFinding[] {
  if (NON_GUARD_MODULES.has(path)) return [];
  const sourceFile = parsed ?? parseModule(path, source);
  const findings: ScopeFinding[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (
      !declaration.getModuleSpecifierValue().endsWith(AUTHORED_PATHS_MODULE)
    ) {
      continue;
    }
    for (const named of declaration.getNamedImports()) {
      if (!CANONICAL_IMPORT.test(named.getName())) continue;
      findings.push({
        line: named.getStartLineNumber(),
        message:
          `imports ${named.getName()} directly; obtain the scan set through structuralGuardScope`,
      });
    }
  }

  if (inspectsSource(sourceFile)) {
    for (
      const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    ) {
      const expression = call.getExpression().getText();
      const argument = call.getArguments()[0];
      if (argument === undefined) continue;
      const enumerates = expression === "walk" ||
        expression === "Deno.readDir" ||
        expression === "Deno.readDirSync";
      if (enumerates && repoRooted(argument)) {
        findings.push({
          line: call.getStartLineNumber(),
          message:
            `hand-roots an authored-source ${expression} scan; declare its Git-derived universe`,
        });
      }
    }
    for (
      const loop of sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)
    ) {
      if (
        repoRooted(loop.getExpression(), new Set(), false) &&
        subtreeInspectsSource(loop.getStatement())
      ) {
        findings.push({
          line: loop.getStartLineNumber(),
          message:
            "iterates a hand-maintained authored-source set; declare its Git-derived universe",
        });
      }
    }
    for (
      const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    ) {
      const callee = call.getExpression();
      const callback = call.getArguments()[0];
      if (
        Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "map" &&
        repoRooted(callee.getExpression(), new Set(), false) &&
        callback !== undefined &&
        subtreeInspectsSource(callback)
      ) {
        findings.push({
          line: call.getStartLineNumber(),
          message:
            "maps a hand-maintained authored-source set; declare its Git-derived universe",
        });
      }
    }
  }

  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    if (call.getExpression().getText() !== "structuralGuardScope") continue;
    const declaration = call.getArguments()[0];
    if (declaration === undefined) continue;
    const guard = objectProperty(declaration, "guard");
    if (
      !Node.isStringLiteral(guard) ||
      !guard.getLiteralValue().startsWith(`${path}#`)
    ) {
      findings.push({
        line: call.getStartLineNumber(),
        message: `scope declaration guard must identify ${path}#<local-id>`,
      });
    }
    const universe = objectProperty(declaration, "universe");
    if (universe !== undefined && Node.isObjectLiteralExpression(universe)) {
      if (universe.getProperty("files") !== undefined) {
        findings.push({
          line: universe.getStartLineNumber(),
          message:
            "specialized universes name extensions for Git to enumerate, never a hand-maintained file list",
        });
      }
    }
  }
  return findings;
}

Deno.test("canonical structural universes are complete and narrowing is explicit", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "generated/\n");
    await gitInit(dir);
    for (
      const rel of [
        "src/existing.ts",
        "unrelated_tools/future.ts",
        "unrelated_tools/browser.js",
        "generated/ignored.ts",
      ]
    ) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, rel), "export const value = 1;\n");
    }
    assertEquals(
      await structuralGuardScope({
        guard: "tests/structural_guard_scope_test.ts#future-tree-control",
        universe: "authored-ts",
      }, dir),
      ["src/existing.ts", "unrelated_tools/future.ts"],
    );
    assertEquals(
      await structuralGuardScope({
        guard:
          "tests/structural_guard_scope_test.ts#explicit-runtime-narrowing",
        universe: "authored-deno",
        narrow: {
          reason:
            "This planted invariant governs runtime files outside the test tree.",
          include: (rel) => !rel.startsWith("tests/"),
        },
      }, dir),
      [
        "src/existing.ts",
        "unrelated_tools/browser.js",
        "unrelated_tools/future.ts",
      ],
    );
  });
});

Deno.test("a specialized Git universe includes executable fixture source without accepting member lists", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "generated/\n");
    await gitInit(dir);
    for (
      const rel of [
        "tests/live_test.ts",
        "tests/fixtures/executable.ts",
        "unrelated_tools/future.ts",
        "generated/ignored.ts",
      ]
    ) {
      await Deno.mkdir(join(dir, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(dir, rel), "export const value = 1;\n");
    }
    assertEquals(
      await structuralGuardScope({
        guard: "tests/structural_guard_scope_test.ts#fixture-source-boundary",
        universe: {
          kind: "specialized",
          name: "executable test TypeScript including inert fixture paths",
          extensions: [".ts", ".tsx"],
          reason:
            "Executable fixture modules are intentionally outside the canonical authored runtime universes.",
        },
        narrow: {
          reason:
            "The planted rule governs executable modules beneath the test tree.",
          include: (rel) => rel.startsWith("tests/"),
        },
      }, dir),
      ["tests/fixtures/executable.ts", "tests/live_test.ts"],
    );
    await Deno.writeTextFile(
      join(dir, "tests", "fixtures", "extensionless"),
      "fixture text\n",
    );
    await Deno.writeTextFile(
      join(dir, "tests", "fixtures", "image.png"),
      "binary contract\n",
    );
    assertEquals(
      await structuralGuardScope({
        guard: "tests/structural_guard_scope_test.ts#fixture-text-boundary",
        universe: {
          kind: "specialized",
          name: "authored text including inert fixture paths",
          text: true,
          reason:
            "The canonical authored-text universe intentionally omits inert fixture files.",
        },
        narrow: {
          reason: "The planted rule governs text beneath the fixture tree.",
          include: (rel) => rel.startsWith("tests/fixtures/"),
        },
      }, dir),
      [
        "tests/fixtures/executable.ts",
        "tests/fixtures/extensionless",
      ],
    );
    await assertRejects(
      () =>
        structuralGuardScope({
          guard:
            "tests/structural_guard_scope_test.ts#reject-path-shaped-extension",
          universe: {
            kind: "specialized",
            name: "fake local member list",
            extensions: ["src/existing.ts"],
            reason:
              "This invalid declaration models a hand-maintained list that omits a new source tree.",
          },
        }, dir),
      Error,
      "must be an extension, not a path or glob",
    );
  });
});

Deno.test("the syntax-aware detector rejects planted hand-rooted and local-list guards", () => {
  const planted = `
import { walk } from "@std/fs";
import { join } from "@std/path";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
const FILES = ["src/known.ts"];
Deno.test("every authored source avoids the planted token", async () => {
  for await (const entry of walk(join(REPO_ROOT, "src"))) {
    await Deno.readTextFile(entry.path);
  }
});
structuralGuardScope({
  guard: "tests/planted_guard_test.ts#fake-specialized-list",
  universe: { kind: "specialized", files: FILES, reason: "a fake list" },
});
`;
  assertEquals(
    scopeFindings("tests/planted_guard_test.ts", planted).map((finding) =>
      finding.message
    ),
    [
      "hand-roots an authored-source walk scan; declare its Git-derived universe",
      "specialized universes name extensions for Git to enumerate, never a hand-maintained file list",
    ],
  );
});

Deno.test("the syntax-aware detector follows a planted local root list through its walker", () => {
  const planted = `
import { join } from "@std/path";
const ROOTS = ["src", "tests"];
async function filesUnder(path: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    const child = join(path, entry.name);
    if (entry.isDirectory) files.push(...await filesUnder(child));
    else files.push(child);
  }
  return files;
}
Deno.test("all known roots reject a token", async () => {
  for (const file of (await Promise.all(ROOTS.map(filesUnder))).flat()) {
    await Deno.readTextFile(file);
  }
});
`;
  assert(
    scopeFindings("tests/planted_roots_test.ts", planted).some((finding) =>
      finding.message.includes("hand-root") ||
      finding.message.includes("hand-maintained")
    ),
    "a local root list that omits a future source tree must be rejected",
  );
});

Deno.test("every live structural guard obtains its scan set from a declaration", async () => {
  const files = await structuralGuardScope({
    guard: "tests/structural_guard_scope_test.ts#live-guard-enrollment",
    universe: "authored-ts",
  });
  const offenders: string[] = [];
  const declarations = new Map<string, string>();
  for (const [rel, reason] of NON_GUARD_MODULES) {
    assert(
      reason.length >= 40,
      `${rel} needs a specific classification reason`,
    );
    assert(
      await fileExists(join(REPO_ROOT, rel)),
      `${rel} classification exclusion is stale`,
    );
  }
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    const sourceFile = parseModule(rel, source);
    for (
      const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    ) {
      if (call.getExpression().getText() !== "structuralGuardScope") continue;
      const declaration = call.getArguments()[0];
      if (declaration === undefined) continue;
      const guard = objectProperty(declaration, "guard");
      if (!Node.isStringLiteral(guard)) continue;
      const identity = guard.getLiteralValue();
      const prior = declarations.get(identity);
      if (prior !== undefined) {
        offenders.push(
          `${rel}:${call.getStartLineNumber()} repeats scope identity ${identity} first declared at ${prior}`,
        );
      } else {
        declarations.set(identity, `${rel}:${call.getStartLineNumber()}`);
      }
    }
    for (const finding of scopeFindings(rel, source, sourceFile)) {
      offenders.push(`${rel}:${finding.line} ${finding.message}`);
    }
  }
  assert(declarations.size > 0, "the structural-guard population is empty");
  assert(
    offenders.length === 0,
    `structural guards bypass the declared scope contract:\n${
      offenders.join("\n")
    }`,
  );
});
