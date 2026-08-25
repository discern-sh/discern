/** Architectural guard keeping optional filesystem reads behind one capability. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const FS_PRESENCE_AUTHORITY = "src/shared/fs_presence.ts";
const FILESYSTEM_READS = new Set([
  "lstat",
  "lstatSync",
  "readDir",
  "readDirSync",
  "readFile",
  "readFileSync",
  "readLink",
  "readLinkSync",
  "readTextFile",
  "readTextFileSync",
  "realPath",
  "realPathSync",
  "stat",
  "statSync",
]);

/** Parse one authored module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Name a direct Deno filesystem read call, including element access. */
function denoFilesystemRead(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (
    Node.isPropertyAccessExpression(callee) &&
    callee.getExpression().getText() === "Deno" &&
    FILESYSTEM_READS.has(callee.getName())
  ) {
    return callee.getText();
  }
  if (
    Node.isElementAccessExpression(callee) &&
    callee.getExpression().getText() === "Deno"
  ) {
    const member = callee.getArgumentExpression();
    if (
      member !== undefined && Node.isStringLiteral(member) &&
      FILESYSTEM_READS.has(member.getLiteralValue())
    ) {
      return callee.getText();
    }
  }
  return undefined;
}

/** Return the nearest function-like boundary around a control-flow node. */
function enclosingFunction(node: Node): Node | undefined {
  return node.getFirstAncestor((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor) || Node.isMethodDeclaration(ancestor)
  );
}

/** Whether a raw read lives inside a test body rather than a reusable helper. */
function insideDenoTest(node: Node): boolean {
  return node.getAncestors().some((ancestor) =>
    Node.isCallExpression(ancestor) &&
    ancestor.getExpression().getText() === "Deno.test"
  );
}

/** Whether a return expression is one of the ordinary absence sentinels. */
function isAbsenceFallback(node: Node | undefined): boolean {
  if (node === undefined) return true;
  if (
    node.getKind() === SyntaxKind.FalseKeyword || Node.isNullLiteral(node) ||
    Node.isArrayLiteralExpression(node) && node.getElements().length === 0 ||
    Node.isObjectLiteralExpression(node) && node.getProperties().length === 0
  ) {
    return true;
  }
  return Node.isIdentifier(node) && node.getText() === "undefined" ||
    Node.isStringLiteral(node) && node.getLiteralValue() === "";
}

/** Whether a catch converts its protected read into ordinary absence. */
function catchSuppressesFailure(catchClause: Node): boolean {
  const owner = enclosingFunction(catchClause);
  const ownerStart = owner?.getStart();
  const block = Node.isCatchClause(catchClause)
    ? catchClause.getBlock()
    : undefined;
  if (block !== undefined && block.getStatements().length === 0) return true;
  return catchClause.getDescendants().some((node) => {
    if (enclosingFunction(node)?.getStart() !== ownerStart) return false;
    if (Node.isContinueStatement(node) || Node.isBreakStatement(node)) {
      return true;
    }
    return Node.isReturnStatement(node) &&
      isAbsenceFallback(node.getExpression());
  });
}

/** Find raw optional-read semantics that bypass the shared capability. */
function presenceBypassFindings(path: string, source: string): string[] {
  const parsed = parseModule(path, source);
  const findings: string[] = [];
  for (
    const statement of parsed.getDescendantsOfKind(SyntaxKind.TryStatement)
  ) {
    const catchClause = statement.getCatchClause();
    if (catchClause === undefined || !catchSuppressesFailure(catchClause)) {
      continue;
    }
    for (
      const call of statement.getTryBlock().getDescendantsOfKind(
        SyntaxKind.CallExpression,
      )
    ) {
      if (insideDenoTest(call)) continue;
      if (call.getFirstAncestorByKind(SyntaxKind.TryStatement) !== statement) {
        continue;
      }
      const operation = denoFilesystemRead(call);
      if (operation !== undefined) {
        findings.push(`${path}:${call.getStartLineNumber()} ${operation}`);
      }
    }
  }
  for (const call of parsed.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (insideDenoTest(call)) continue;
    const callee = call.getExpression();
    if (
      !Node.isPropertyAccessExpression(callee) || callee.getName() !== "catch"
    ) {
      continue;
    }
    const receiver = callee.getExpression();
    if (!Node.isCallExpression(receiver)) continue;
    const operation = denoFilesystemRead(receiver);
    const handler = call.getArguments()[0];
    const rethrows = handler !== undefined &&
      handler.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0;
    if (operation !== undefined && !rethrows) {
      findings.push(
        `${path}:${receiver.getStartLineNumber()} ${operation}.catch`,
      );
    }
  }
  return [...new Set(findings)].sort();
}

Deno.test("optional filesystem reads are owned by the presence capability", async () => {
  const files = await structuralGuardScope({
    guard: "tests/fs_presence_enrolment_test.ts#optional-read-ownership",
    universe: "authored-deno",
    narrow: {
      reason:
        "The capability itself must catch NotFound and implement the one named best-effort boundary.",
      include: (path) => path !== FS_PRESENCE_AUTHORITY,
    },
  });
  const findings = (
    await Promise.all(
      files.map(async (path) =>
        presenceBypassFindings(
          path,
          await Deno.readTextFile(join(REPO_ROOT, path)),
        )
      ),
    )
  ).flat().sort();
  assertEquals(
    findings,
    [],
    "a local helper or swallow-all probe owns optional filesystem semantics; " +
      "use src/shared/fs_presence.ts and name any best-effort consequence",
  );
});

Deno.test("presence ownership catches helpers whose names do not mention existence", () => {
  const source = `async function inspectCache(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}\n`;
  assertEquals(presenceBypassFindings("tools/cache.ts", source), [
    "tools/cache.ts:3 Deno.stat",
  ]);
});

Deno.test("presence ownership catches promise-level failure suppression", () => {
  const source = `export const load = (path: string): Promise<string> =>
  Deno.readTextFile(path).catch(() => "");\n`;
  assertEquals(presenceBypassFindings("tools/loader.ts", source), [
    "tools/loader.ts:2 Deno.readTextFile.catch",
  ]);
});
