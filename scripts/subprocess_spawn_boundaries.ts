/**
 * Structural census and parity check for direct subprocess constructors.
 *
 * The scan covers the complete Git-derived authored-TypeScript universe except
 * test harnesses, whose child processes are test infrastructure rather than
 * production or repository tooling. Every actual constructor must match one
 * exact row in `SUBPROCESS_SPAWN_BOUNDARIES`, and every row must still name an
 * actual constructor. The command refuses drift before emitting the Standard.
 */

import { join } from "@std/path";
import {
  type NewExpression,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import {
  registeredSpawnBoundaryCount,
  SUBPROCESS_SPAWN_BOUNDARIES,
  type SubprocessSpawnBoundary,
} from "../tests/spawn_surfaces.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";

/** One direct subprocess constructor discovered from syntax. */
export interface DirectSpawnSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly line: number;
  readonly column: number;
  readonly binary: string;
}

/** Stable enclosing name for one function-like ancestor, when it has one. */
function functionLikeName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) return node.getName();
  if (Node.isMethodDeclaration(node)) return node.getName();
  if (Node.isFunctionExpression(node) && node.getName() !== undefined) {
    return node.getName();
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) return parent.getName();
    if (Node.isPropertyAssignment(parent)) return parent.getName();
  }
  return undefined;
}

/** Nearest stable named function, or `<module>` for top-level construction. */
export function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    const name = functionLikeName(ancestor);
    if (name !== undefined) return name;
  }
  return "<module>";
}

/** Resolve local initializer aliases without depending on variable spelling. */
export function resolveSpawnExpression(
  node: Node | undefined,
  depth = 0,
): Node | undefined {
  if (node === undefined || depth > 12) return undefined;
  if (Node.isParenthesizedExpression(node)) {
    return resolveSpawnExpression(node.getExpression(), depth + 1);
  }
  if (Node.isIdentifier(node)) {
    const declaration = node.getSymbol()?.getDeclarations()[0];
    if (declaration !== undefined && Node.isVariableDeclaration(declaration)) {
      return resolveSpawnExpression(declaration.getInitializer(), depth + 1);
    }
  }
  return node;
}

/** Direct constructors, including locally aliased Deno.Command bindings. */
export function subprocessConstructors(source: SourceFile): NewExpression[] {
  return source.getDescendantsOfKind(SyntaxKind.NewExpression).filter(
    (node) => {
      const expression = resolveSpawnExpression(node.getExpression());
      return expression?.getText() === "Deno.Command" ||
        (expression !== undefined &&
          Node.isElementAccessExpression(expression) &&
          expression.getExpression().getText() === "Deno" &&
          expression.getArgumentExpression()?.getText().replaceAll(
              /["']/g,
              "",
            ) === "Command");
    },
  );
}

/** Direct `new Deno.Command` sites in one parsed source file. */
function directSpawnSitesInSourceFile(
  path: string,
  sourceFile: SourceFile,
): DirectSpawnSite[] {
  const sites: DirectSpawnSite[] = [];
  for (
    const node of subprocessConstructors(sourceFile)
  ) {
    const location = sourceFile.getLineAndColumnAtPos(node.getStart());
    sites.push({
      path,
      enclosingFunction: enclosingFunction(node),
      line: location.line,
      column: location.column,
      binary: node.getArguments()[0]?.getText() ?? "<missing>",
    });
  }
  return sites;
}

/** Parse one source string for focused and planted tests. */
export function directSpawnSitesInSource(
  source: string,
  path = "fixture.ts",
): DirectSpawnSite[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return directSpawnSitesInSourceFile(
    path,
    project.createSourceFile(path, source),
  );
}

/**
 * The production-and-tooling universe: all authored TypeScript outside test
 * harnesses. A future top-level tooling root joins automatically.
 */
export async function productionAndToolingSpawnFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await structuralGuardScope({
    guard:
      "scripts/subprocess_spawn_boundaries.ts#production-and-tooling-spawns",
    universe: "authored-ts",
    narrow: {
      reason:
        "The subprocess boundary registry governs production and repository tooling; tests own their harness children.",
      include: (path) => !path.startsWith("tests/"),
    },
  }, root);
}

/** Scan direct subprocess constructors in a declared source set. */
export async function directSpawnSitesInFiles(
  root: string,
  files: readonly string[],
): Promise<DirectSpawnSite[]> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const sites: DirectSpawnSite[] = [];
  for (const path of files) {
    const source = await Deno.readTextFile(join(root, path));
    sites.push(
      ...directSpawnSitesInSourceFile(
        path,
        project.createSourceFile(path, source),
      ),
    );
  }
  return sites;
}

/** Match currency shared by syntax findings and registry rows. */
function boundaryKey(
  boundary: Pick<SubprocessSpawnBoundary, "path" | "enclosingFunction">,
): string {
  return `${boundary.path}\0${boundary.enclosingFunction}`;
}

/**
 * Bidirectional parity diagnostics. Duplicate constructors inside one function
 * remain count-sensitive; manually authored operation text distinguishes their
 * registry rows for review even though syntax cannot infer that prose.
 */
export function spawnBoundaryParityFindings(
  actual: readonly DirectSpawnSite[],
  registered: readonly SubprocessSpawnBoundary[],
): string[] {
  const remaining = new Map<string, SubprocessSpawnBoundary[]>();
  for (const boundary of registered) {
    const key = boundaryKey(boundary);
    remaining.set(key, [...(remaining.get(key) ?? []), boundary]);
  }
  const findings: string[] = [];
  for (const site of actual) {
    const key = boundaryKey(site);
    const matches = remaining.get(key) ?? [];
    if (matches.length === 0) {
      findings.push(
        `unregistered subprocess constructor at ${site.path}:${site.line}:${site.column} inside ${site.enclosingFunction}`,
      );
      continue;
    }
    matches.shift();
    remaining.set(key, matches);
  }
  for (const boundaries of remaining.values()) {
    for (const boundary of boundaries) {
      findings.push(
        `stale subprocess boundary ${boundary.path}#${boundary.enclosingFunction} (${boundary.operation})`,
      );
    }
  }
  return findings.sort();
}

/** Scan and refuse registry drift before returning the live exception count. */
export async function validateSubprocessSpawnBoundaries(
  root: string = REPO_ROOT,
): Promise<DirectSpawnSite[]> {
  const actual = await directSpawnSitesInFiles(
    root,
    await productionAndToolingSpawnFiles(root),
  );
  const findings = spawnBoundaryParityFindings(
    actual,
    SUBPROCESS_SPAWN_BOUNDARIES,
  );
  if (findings.length > 0) {
    throw new Error(
      "direct subprocess boundaries diverged from tests/spawn_surfaces.ts:\n  " +
        findings.join("\n  "),
    );
  }
  return actual;
}

/** Validate and print the falling registry census. */
async function main(): Promise<void> {
  await validateSubprocessSpawnBoundaries();
  for (
    const boundary of SUBPROCESS_SPAWN_BOUNDARIES.filter((entry) =>
      entry.role === "registered-boundary"
    )
  ) {
    console.error(
      `${boundary.path}#${boundary.enclosingFunction} ${boundary.operation} — ${boundary.reason}`,
    );
  }
  const count = registeredSpawnBoundaryCount();
  console.error(
    `${count} registered subprocess spawn boundaries outside the shared capability.`,
  );
  console.log(`DISCERN_METRIC subprocess_spawn_boundaries ${count}`);
}

if (import.meta.main) await main();
