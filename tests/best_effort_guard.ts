/** Shared full-universe census for named deliberate error-discard boundaries. */

import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  BEST_EFFORT_BOUNDARIES,
  type BestEffortBoundary,
} from "../src/shared/best_effort.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

export interface BestEffortSource {
  readonly path: string;
  readonly source: string;
}

interface BoundarySite {
  readonly path: string;
  readonly line: number;
  readonly enclosingFunction: string;
  readonly shape: "sync" | "async";
}

const CAPABILITY_MODULE = "best_effort.ts";
const LEGACY_VALUE_WRAPPER = "bestEffortFs";
const DIRECT_MARKER = /\bdiscern-best-effort:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu;

/** Return the Git-derived production and repository-tooling source universe. */
export async function bestEffortSources(
  root: string = REPO_ROOT,
): Promise<BestEffortSource[]> {
  const files = await structuralGuardScope({
    guard: "tests/best_effort_guard.ts#production-error-boundaries",
    universe: "authored-deno",
    narrow: {
      reason:
        "Test modules plant rejected syntax; shipped code and repository tooling own the deliberate error-discard policy.",
      include: (path) => !path.startsWith("tests/"),
    },
  }, root);
  return await Promise.all(files.map(async (path) => ({
    path,
    source: await Deno.readTextFile(join(root, path)),
  })));
}

/** Parse one authored module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    compilerOptions: { noLib: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Stable authored name around one registered call or direct syntax site. */
function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.getName() ?? "<anonymous function>";
    }
    if (
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) ||
      Node.isSetAccessorDeclaration(ancestor)
    ) return ancestor.getName();
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const parent = ancestor.getParent();
      if (Node.isVariableDeclaration(parent)) return parent.getName();
      if (Node.isPropertyAssignment(parent)) return parent.getName();
      if (Node.isMethodDeclaration(parent)) return parent.getName();
    }
  }
  return "<module>";
}

/** Whether an import points directly at the one best-effort authority module. */
function isCapabilityImport(path: string): boolean {
  return path === CAPABILITY_MODULE || path.endsWith(`/${CAPABILITY_MODULE}`);
}

interface CapabilityNames {
  readonly async: Set<string>;
  readonly sync: Set<string>;
  readonly namespaces: Set<string>;
}

/** Resolve local import names for the two capability functions. */
function capabilityNames(sourceFile: SourceFile): CapabilityNames {
  const names: CapabilityNames = {
    async: new Set<string>(),
    sync: new Set<string>(),
    namespaces: new Set<string>(),
  };
  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!isCapabilityImport(declaration.getModuleSpecifierValue())) continue;
    const namespace = declaration.getNamespaceImport();
    if (namespace !== undefined) names.namespaces.add(namespace.getText());
    for (const named of declaration.getNamedImports()) {
      const imported = named.getName();
      const local = named.getAliasNode()?.getText() ?? imported;
      if (imported === "bestEffort") names.async.add(local);
      if (imported === "bestEffortSync") names.sync.add(local);
    }
  }
  return names;
}

/** Name a direct capability call and its sync/async shape. */
function capabilityShape(
  call: import("ts-morph").CallExpression,
  names: CapabilityNames,
): "sync" | "async" | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) {
    if (names.async.has(callee.getText())) return "async";
    if (names.sync.has(callee.getText())) return "sync";
    return undefined;
  }
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  if (!names.namespaces.has(callee.getExpression().getText())) return undefined;
  if (callee.getName() === "bestEffort") return "async";
  if (callee.getName() === "bestEffortSync") return "sync";
  return undefined;
}

/** Return a string-literal boundary ID without evaluating code. */
function literalBoundaryId(node: Node | undefined): string | undefined {
  if (
    node !== undefined &&
    (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
  ) return node.getLiteralValue();
  return undefined;
}

/** Collect identifier names from one parameter binding pattern. */
function bindingNames(node: Node): string[] {
  if (Node.isIdentifier(node)) return [node.getText()];
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element) =>
      Node.isBindingElement(element) ? bindingNames(element.getNameNode()) : []
    );
  }
  return [];
}

/** Whether an inline effect calls its owner's callback parameter as a wrapper. */
function forwardsEffectParameter(
  call: import("ts-morph").CallExpression,
  effect: Node,
): string | undefined {
  const owner = call.getFirstAncestor((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) || Node.isArrowFunction(ancestor)
  );
  if (
    owner === undefined ||
    (!Node.isFunctionDeclaration(owner) && !Node.isMethodDeclaration(owner) &&
      !Node.isFunctionExpression(owner) && !Node.isArrowFunction(owner))
  ) return undefined;
  const parameters = new Set(
    owner.getParameters().flatMap((parameter) =>
      bindingNames(parameter.getNameNode())
    ),
  );
  for (const nested of effect.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = nested.getExpression();
    if (Node.isIdentifier(callee) && parameters.has(callee.getText())) {
      return callee.getText();
    }
  }
  return undefined;
}

/** Return one line's number at a UTF-16 source offset. */
function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/** Determine the async/sync shape of a direct catch clause. */
function directCatchShape(
  catchClause: import("ts-morph").CatchClause,
): "sync" | "async" {
  const tryStatement = catchClause.getParentIfKind(SyntaxKind.TryStatement);
  const tryBlock = tryStatement?.getTryBlock();
  return tryBlock?.getDescendantsOfKind(
          SyntaxKind.AwaitExpression,
        ).length === 0 &&
      !tryBlock?.getDescendantsOfKind(SyntaxKind.ForOfStatement).some((node) =>
        node.isAwaited()
      )
    ? "sync"
    : "async";
}

/** Find the direct syntax handler containing a marker offset. */
function directSiteAt(
  path: string,
  sourceFile: SourceFile,
  offset: number,
): BoundarySite | undefined {
  const catches = sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)
    .filter((node) =>
      node.getBlock().getFullStart() <= offset &&
      node.getBlock().getEnd() >= offset
    );
  const catchClause =
    catches.sort((left, right) => left.getWidth() - right.getWidth())[0];
  if (catchClause !== undefined) {
    return {
      path,
      line: catchClause.getStartLineNumber(),
      enclosingFunction: enclosingFunction(catchClause),
      shape: directCatchShape(catchClause),
    };
  }
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const handlerIndex = callee.getName() === "then"
      ? 1
      : callee.getName() === "catch"
      ? 0
      : undefined;
    if (handlerIndex === undefined) continue;
    const handler = call.getArguments()[handlerIndex];
    if (
      handler !== undefined &&
      (Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)) &&
      handler.getFullStart() <= offset && handler.getEnd() >= offset
    ) {
      return {
        path,
        line: call.getStartLineNumber(),
        enclosingFunction: enclosingFunction(call),
        shape: "async",
      };
    }
  }
  return undefined;
}

/** Validate one registry entry's stable review metadata. */
function registryMetadataFindings(
  id: string,
  boundary: BestEffortBoundary,
): string[] {
  const findings: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    findings.push(`best-effort boundary '${id}' must use a kebab-case ID`);
  }
  if (!/^[^/]+(?:\/[^/]+)*\.[a-z0-9]+$/iu.test(boundary.path)) {
    findings.push(
      `best-effort boundary '${id}' needs a repository-relative path`,
    );
  }
  for (
    const [field, value, minimum] of [
      ["enclosingFunction", boundary.enclosingFunction, 1],
      ["operation", boundary.operation, 12],
      ["reason", boundary.reason, 12],
    ] as const
  ) {
    if (
      value.trim().length < minimum || /[\r\n]/u.test(value) ||
      (field === "enclosingFunction" && value.startsWith("<") &&
        value !== "<module>")
    ) {
      findings.push(
        `best-effort boundary '${id}' ${field} needs a specific one-line value`,
      );
    }
  }
  if (
    boundary.kind === "direct" &&
    boundary.observability.kind !== "unobservable"
  ) {
    findings.push(
      `best-effort boundary '${id}' is reported and therefore needs no direct silent-catch exception`,
    );
  }
  return findings;
}

/** Inspect calls, direct markers, metadata, and one-to-one enrollment. */
export function bestEffortFindings(
  sources: readonly BestEffortSource[],
  boundaries: Readonly<Record<string, BestEffortBoundary>> =
    BEST_EFFORT_BOUNDARIES,
): string[] {
  const findings: string[] = [];
  const calls = new Map<string, BoundarySite[]>();
  const directSites = new Map<string, BoundarySite[]>();
  for (const item of sources) {
    const parsed = parseModule(item.path, item.source);
    const names = capabilityNames(parsed);
    for (const declaration of parsed.getExportDeclarations()) {
      if (!isCapabilityImport(declaration.getModuleSpecifierValue() ?? "")) {
        continue;
      }
      findings.push(
        `${item.path}:${declaration.getStartLineNumber()} re-exports the best-effort capability; import the authority directly at each enrolled boundary`,
      );
    }
    for (const call of parsed.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeText = call.getExpression().getText();
      if (
        calleeText === LEGACY_VALUE_WRAPPER ||
        calleeText.endsWith(`.${LEGACY_VALUE_WRAPPER}`)
      ) {
        findings.push(
          `${item.path}:${call.getStartLineNumber()} calls value-producing ${LEGACY_VALUE_WRAPPER}; preserve failure explicitly or enroll an exact direct exception`,
        );
      }
      const shape = capabilityShape(call, names);
      if (shape === undefined) continue;
      const id = literalBoundaryId(call.getArguments()[0]);
      if (id === undefined) {
        findings.push(
          `${item.path}:${call.getStartLineNumber()} best-effort boundary ID must be a string literal`,
        );
        continue;
      }
      const site: BoundarySite = {
        path: item.path,
        line: call.getStartLineNumber(),
        enclosingFunction: enclosingFunction(call),
        shape,
      };
      const enrolled = calls.get(id) ?? [];
      enrolled.push(site);
      calls.set(id, enrolled);
      const boundary = boundaries[id];
      if (boundary === undefined) {
        findings.push(
          `${item.path}:${site.line} calls unknown best-effort boundary '${id}'; add the exact registry entry`,
        );
        continue;
      }
      if (
        boundary.kind !== "capability" || boundary.path !== site.path ||
        boundary.enclosingFunction !== site.enclosingFunction ||
        boundary.shape !== site.shape
      ) {
        findings.push(
          `${item.path}:${site.line} best-effort boundary '${id}' is ${site.enclosingFunction} (${site.shape}) but the registry names ${boundary.path}#${boundary.enclosingFunction} (${boundary.kind}/${boundary.shape})`,
        );
      }
      const effect = call.getArguments()[1];
      if (
        effect === undefined ||
        (!Node.isArrowFunction(effect) && !Node.isFunctionExpression(effect))
      ) {
        findings.push(
          `${item.path}:${site.line} best-effort boundary '${id}' needs an inline side-effect function`,
        );
      } else {
        const forwarded = forwardsEffectParameter(call, effect);
        if (forwarded !== undefined) {
          findings.push(
            `${item.path}:${site.line} best-effort boundary '${id}' forwards callback parameter '${forwarded}'; enroll the concrete caller instead`,
          );
        }
      }
      const reporter = call.getArguments()[2];
      const reported = boundary.observability.kind === "reported";
      if (reported !== (reporter !== undefined)) {
        findings.push(
          `${item.path}:${site.line} best-effort boundary '${id}' must ${
            reported ? "supply" : "omit"
          } its registered reporter`,
        );
      } else if (
        reporter !== undefined && !Node.isArrowFunction(reporter) &&
        !Node.isFunctionExpression(reporter)
      ) {
        findings.push(
          `${item.path}:${site.line} best-effort boundary '${id}' needs an inline reporter through ${
            boundary.observability.kind === "reported"
              ? boundary.observability.authority
              : "its authority"
          }`,
        );
      }
    }
    for (const match of item.source.matchAll(DIRECT_MARKER)) {
      const id = match[1];
      if (id === undefined) continue;
      const site = directSiteAt(item.path, parsed, match.index);
      if (site === undefined) {
        findings.push(
          `${item.path}:${
            lineAt(item.source, match.index)
          } best-effort marker '${id}' is not inside a catch or promise rejection handler`,
        );
        continue;
      }
      const enrolled = directSites.get(id) ?? [];
      enrolled.push(site);
      directSites.set(id, enrolled);
      const boundary = boundaries[id];
      if (boundary === undefined) {
        findings.push(
          `${item.path}:${site.line} names unknown direct best-effort boundary '${id}'; add the exact registry entry`,
        );
      } else if (
        boundary.kind !== "direct" || boundary.path !== site.path ||
        boundary.enclosingFunction !== site.enclosingFunction ||
        boundary.shape !== site.shape
      ) {
        findings.push(
          `${item.path}:${site.line} direct best-effort boundary '${id}' does not match its registry path, function, kind, and shape`,
        );
      }
    }
  }

  const ids = Object.keys(boundaries);
  if (ids.join("\n") !== [...ids].sort().join("\n")) {
    findings.push("BEST_EFFORT_BOUNDARIES must be sorted by stable ID");
  }
  for (const id of ids) {
    const boundary = boundaries[id];
    if (boundary === undefined) continue;
    findings.push(...registryMetadataFindings(id, boundary));
    const enrolled = boundary.kind === "capability"
      ? calls.get(id) ?? []
      : directSites.get(id) ?? [];
    if (enrolled.length === 0) {
      findings.push(
        `best-effort boundary '${id}' has no live ${
          boundary.kind === "capability"
            ? "capability call"
            : "direct syntax site"
        }; remove the stale entry`,
      );
    } else if (enrolled.length > 1) {
      findings.push(
        `best-effort boundary '${id}' has ${enrolled.length} live sites; use one stable ID per site`,
      );
    }
  }
  return findings.sort();
}

/** Verify the complete enrollment before returning its deterministic population. */
export function measureBestEffortBoundaries(
  sources: readonly BestEffortSource[],
  boundaries: Readonly<Record<string, BestEffortBoundary>> =
    BEST_EFFORT_BOUNDARIES,
): number {
  const findings = bestEffortFindings(sources, boundaries);
  if (findings.length > 0) {
    throw new Error(
      `best-effort boundary enrollment is invalid:\n${findings.join("\n")}`,
    );
  }
  return Object.keys(boundaries).length;
}
