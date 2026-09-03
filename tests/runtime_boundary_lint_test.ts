/** Architectural guard against trusting decoded runtime JSON by assertion. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

type BoundaryRule = "asserted-json-boundary" | "declared-json-return";

interface BoundarySite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly rule: BoundaryRule;
  readonly line: number;
}

interface BoundaryException {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly rule: BoundaryRule;
  readonly reason: string;
}

/**
 * Exact exceptions for complete manual projections or intentionally opaque
 * payloads. Each entry must describe why acquiring the declared type is safe;
 * removed or reshaped sites make the registration stale and fail this test.
 */
const BOUNDARY_EXCEPTIONS: readonly BoundaryException[] = [
  {
    path: "scripts/release_smoke.ts",
    enclosingFunction: "resultEnvelope",
    rule: "declared-json-return",
    reason:
      "The function proves a non-array record and the one green field it consumes before returning the broad record type.",
  },
  {
    path: "scripts/site_local_design_system.ts",
    enclosingFunction: "readJsonObject",
    rule: "asserted-json-boundary",
    reason:
      "The preceding null, array, and object checks completely establish the asserted JsonObject alias.",
  },
  {
    path: "src/engine/continuations/store.ts",
    enclosingFunction: "parseRecord",
    rule: "asserted-json-boundary",
    reason:
      "The parser proves the root record, rejects foreign keys, validates its metadata, and deliberately preserves payload as unknown.",
  },
  {
    path: "src/engine/desk/tip_state.ts",
    enclosingFunction: "parseState",
    rule: "asserted-json-boundary",
    reason:
      "The parser validates every state and entry field before constructing a fresh TipSeenState rather than returning the asserted value.",
  },
  {
    path: "src/engine/gate/diagnostics.ts",
    enclosingFunction: "extractSarif",
    rule: "asserted-json-boundary",
    reason:
      "The assertion follows the object check and claims only Record<string, unknown>; SARIF identity and runs are checked before return.",
  },
  {
    path: "src/engine/gate/diagnostics.ts",
    enclosingFunction: "extractSarif",
    rule: "declared-json-return",
    reason:
      "The returned broad record has already passed object, runs-array, and unmistakable SARIF identity checks.",
  },
  {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "inspectLastGateRun",
    rule: "asserted-json-boundary",
    reason:
      "The record assertion enables per-field checks; the function constructs LastGateRun only after validating every consumed field.",
  },
  {
    path: "src/engine/gate/proof.ts",
    enclosingFunction: "parseMeasurements",
    rule: "asserted-json-boundary",
    reason:
      "The object is destructured only into unknown values, then dedicated validators earn every field of the constructed measurements.",
  },
  {
    path: "src/engine/gate/proof_notes.ts",
    enclosingFunction: "parseProofNote",
    rule: "asserted-json-boundary",
    reason:
      "The root is proven an object, the assertion reads one unknown discriminator, and existing Zod schemas validate both result arms.",
  },
  {
    path: "src/engine/gate/temp_artifact_sweep.ts",
    enclosingFunction: "readState",
    rule: "asserted-json-boundary",
    reason:
      "The broad record cast follows the object check and each field is validated before a new sweep-state value is constructed.",
  },
  {
    path: "src/engine/logbook/schema.ts",
    enclosingFunction: "parseLogbookLine",
    rule: "asserted-json-boundary",
    reason:
      "The assertion reads only an unknown schema discriminator after the object check; the complete event schema validates accepted rows.",
  },
  {
    path: "src/engine/worktree/effort_grant.ts",
    enclosingFunction: "parseEffortGrant",
    rule: "asserted-json-boundary",
    reason:
      "The parser proves the root record and validates both fields before constructing a new branch-bound grant.",
  },
  {
    path: "src/engine/worktree/retired_paths.ts",
    enclosingFunction: "parseRecord",
    rule: "asserted-json-boundary",
    reason:
      "The parser proves the root record, rejects foreign keys, validates every field, and returns a freshly constructed record.",
  },
  {
    path: "src/lib/providers.ts",
    enclosingFunction: "readJsonObject",
    rule: "declared-json-return",
    reason:
      "The isObject type predicate completely establishes the broad Record<string, unknown> return type before the return.",
  },
  {
    path: "src/lib/worktree_hooks.ts",
    enclosingFunction: "readJsonStdin",
    rule: "asserted-json-boundary",
    reason:
      "The preceding null, array, and object checks completely establish the asserted broad hook-payload record.",
  },
  {
    path: "src/shared/setup_machinery_evidence.ts",
    enclosingFunction: "parseEvidence",
    rule: "asserted-json-boundary",
    reason:
      "The root and every nested entry field are checked before the function constructs sorted setup evidence.",
  },
  {
    path: "src/shared/setup_messages.ts",
    enclosingFunction: "deriveProjectNameRecommendation",
    rule: "asserted-json-boundary",
    reason:
      "The root-shape guard precedes the broad record cast and the only consumed property is independently checked as a non-empty string.",
  },
];

/** Parse one module without resolving its dependency graph. */
function parseModule(path: string, source: string): SourceFile {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(path, source, { overwrite: true });
}

/** Identifier-like property text, including JSON["parse"]. */
function propertyName(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node)) return node.getLiteralValue();
  return undefined;
}

/** Whether an expression is the built-in JSON.parse function itself. */
function isJsonParseReference(node: Node): boolean {
  if (Node.isPropertyAccessExpression(node)) {
    return node.getExpression().getText() === "JSON" &&
      node.getName() === "parse";
  }
  if (Node.isElementAccessExpression(node)) {
    return node.getExpression().getText() === "JSON" &&
      propertyName(node.getArgumentExpression()) === "parse";
  }
  return false;
}

/** Unwrap syntax that changes only TypeScript's view of a runtime value. */
function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) || Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) || Node.isAwaitExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** Stable authored name for the nearest function boundary. */
function enclosingFunction(node: Node): string {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.getName() ?? "<anonymous function>";
    }
    if (
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) ||
      Node.isSetAccessorDeclaration(ancestor)
    ) {
      return ancestor.getName();
    }
    if (
      Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)
    ) {
      const parent = ancestor.getParent();
      if (Node.isVariableDeclaration(parent)) return parent.getName();
      if (Node.isPropertyAssignment(parent)) return parent.getName();
    }
  }
  return "<module>";
}

/** Numeric identity for the nearest lexical function (module scope is -1). */
function lexicalScope(node: Node): number {
  for (const ancestor of node.getAncestors()) {
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor) ||
      Node.isSetAccessorDeclaration(ancestor) ||
      Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)
    ) {
      return ancestor.getStart();
    }
  }
  return -1;
}

/** Explicit return annotation on one function-like node. */
function returnTypeText(node: Node): string | undefined {
  if (
    Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isArrowFunction(node) || Node.isFunctionExpression(node)
  ) {
    return node.getReturnTypeNode()?.getText();
  }
  return undefined;
}

/** Return annotation of the function that owns a return statement. */
function enclosingReturnType(node: Node): string | undefined {
  for (const ancestor of node.getAncestors()) {
    const text = returnTypeText(ancestor);
    if (text !== undefined) return text;
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) || Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor)
    ) return undefined;
  }
  return undefined;
}

/** A type annotation that deliberately keeps the decoded value untrusted. */
function isUnknownReturn(typeText: string | undefined): boolean {
  if (typeText === undefined) return true;
  const compact = typeText.replaceAll(/\s+/g, "");
  return compact === "unknown" || compact === "any" ||
    compact === "Promise<unknown>" || compact === "Promise<any>";
}

/** Collect local aliases of JSON.parse so spelling changes do not evade it. */
function jsonParseAliases(sourceFile: SourceFile): Set<string> {
  const aliases = new Set<string>();
  for (
    const declaration of sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )
  ) {
    const initializer = declaration.getInitializer();
    if (initializer !== undefined && isJsonParseReference(initializer)) {
      aliases.add(declaration.getName());
    }
  }
  return aliases;
}

/** Whether a call invokes JSON.parse directly or through a local alias. */
function isJsonParseCall(node: Node, aliases: ReadonlySet<string>): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = unwrapExpression(node.getExpression());
  return isJsonParseReference(expression) ||
    (Node.isIdentifier(expression) && aliases.has(expression.getText()));
}

/** Stable local name for a function declaration or variable-bound function. */
function functionName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node)) return node.getName();
  if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) {
    return undefined;
  }
  const parent = node.getParent();
  return Node.isVariableDeclaration(parent) ? parent.getName() : undefined;
}

/** Parsed-value local names by lexical function, propagated through aliases. */
function parsedLocals(
  sourceFile: SourceFile,
  aliases: ReadonlySet<string>,
): ReadonlyMap<number, ReadonlySet<string>> {
  const byScope = new Map<number, Set<string>>();
  const namesFor = (node: Node): Set<string> => {
    const scope = lexicalScope(node);
    const existing = byScope.get(scope);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    byScope.set(scope, created);
    return created;
  };
  const assignments: Array<
    { readonly name: string; readonly value: Node; readonly owner: Node }
  > = [];
  for (
    const declaration of sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )
  ) {
    const initializer = declaration.getInitializer();
    if (initializer !== undefined) {
      assignments.push({
        name: declaration.getName(),
        value: initializer,
        owner: declaration,
      });
    }
  }
  for (
    const assignment of sourceFile.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )
  ) {
    if (assignment.getOperatorToken().getText() !== "=") continue;
    const left = assignment.getLeft();
    if (!Node.isIdentifier(left)) continue;
    assignments.push({
      name: left.getText(),
      value: assignment.getRight(),
      owner: assignment,
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      const names = namesFor(assignment.owner);
      const value = unwrapExpression(assignment.value);
      const originates = isJsonParseCall(value, aliases) ||
        (Node.isIdentifier(value) && names.has(value.getText()));
      if (originates && !names.has(assignment.name)) {
        names.add(assignment.name);
        changed = true;
      }
    }
  }
  return byScope;
}

/** Whether an expression originates at JSON.parse in its lexical function. */
function isParsedExpression(
  node: Node,
  aliases: ReadonlySet<string>,
  locals: ReadonlyMap<number, ReadonlySet<string>>,
  decoders: ReadonlySet<string> = new Set(),
): boolean {
  const expression = unwrapExpression(node);
  if (isJsonParseCall(expression, aliases)) return true;
  if (
    Node.isCallExpression(expression) &&
    Node.isIdentifier(expression.getExpression()) &&
    decoders.has(expression.getExpression().getText())
  ) return true;
  return Node.isIdentifier(expression) &&
    (locals.get(lexicalScope(node))?.has(expression.getText()) ?? false);
}

/** Local helpers that intentionally preserve JSON as unknown for a caller. */
function unknownJsonDecoders(
  sourceFile: SourceFile,
  aliases: ReadonlySet<string>,
  locals: ReadonlyMap<number, ReadonlySet<string>>,
): Set<string> {
  const decoders = new Set<string>();
  for (
    const candidate of [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ]
  ) {
    if (!isUnknownReturn(returnTypeText(candidate))) continue;
    const name = functionName(candidate);
    if (name === undefined) continue;
    const returnsParsed = candidate.getDescendantsOfKind(
      SyntaxKind.ReturnStatement,
    ).some((returned) => {
      const expression = returned.getExpression();
      return expression !== undefined &&
        isParsedExpression(expression, aliases, locals);
    });
    if (returnsParsed) decoders.add(name);
  }
  return decoders;
}

/** Find assertion and typed-return trust jumps in one authored module. */
function boundarySites(path: string, source: string): BoundarySite[] {
  if (path.startsWith("tests/")) return [];
  const parsed = parseModule(path, source);
  const aliases = jsonParseAliases(parsed);
  const locals = parsedLocals(parsed, aliases);
  const decoders = unknownJsonDecoders(parsed, aliases, locals);
  const sites: BoundarySite[] = [];
  for (
    const assertion of [
      ...parsed.getDescendantsOfKind(SyntaxKind.AsExpression),
      ...parsed.getDescendantsOfKind(SyntaxKind.TypeAssertionExpression),
    ]
  ) {
    const parent = assertion.getParent();
    if (Node.isAsExpression(parent) || Node.isTypeAssertion(parent)) continue;
    const typeNode = assertion.getTypeNode();
    if (typeNode === undefined) continue;
    const assertedType = typeNode.getText().replaceAll(/\s+/g, "");
    if (assertedType === "unknown" || assertedType === "any") continue;
    if (
      !isParsedExpression(assertion.getExpression(), aliases, locals, decoders)
    ) {
      continue;
    }
    sites.push({
      path,
      enclosingFunction: enclosingFunction(assertion),
      rule: "asserted-json-boundary",
      line: assertion.getStartLineNumber(),
    });
  }
  for (
    const returned of parsed.getDescendantsOfKind(SyntaxKind.ReturnStatement)
  ) {
    const expression = returned.getExpression();
    if (expression === undefined) continue;
    if (Node.isAsExpression(expression) || Node.isTypeAssertion(expression)) {
      continue;
    }
    if (isUnknownReturn(enclosingReturnType(returned))) continue;
    if (!isParsedExpression(expression, aliases, locals, decoders)) continue;
    sites.push({
      path,
      enclosingFunction: enclosingFunction(returned),
      rule: "declared-json-return",
      line: returned.getStartLineNumber(),
    });
  }
  for (
    const arrow of parsed.getDescendantsOfKind(SyntaxKind.ArrowFunction)
  ) {
    const body = arrow.getBody();
    if (Node.isBlock(body) || isUnknownReturn(returnTypeText(arrow))) continue;
    if (Node.isAsExpression(body) || Node.isTypeAssertion(body)) continue;
    if (!isParsedExpression(body, aliases, locals, decoders)) continue;
    sites.push({
      path,
      enclosingFunction: enclosingFunction(body),
      rule: "declared-json-return",
      line: body.getStartLineNumber(),
    });
  }
  return sites;
}

/** Stable registration key: line numbers remain diagnostic-only. */
function siteKey(
  value: Pick<BoundarySite, "path" | "enclosingFunction" | "rule">,
): string {
  return `${value.path}#${value.enclosingFunction}#${value.rule}`;
}

/** Report unsafe sites plus malformed, duplicate, and stale exceptions. */
function boundaryFindings(
  sites: readonly BoundarySite[],
  exceptions: readonly BoundaryException[],
): string[] {
  const findings: string[] = [];
  const registered = new Map<string, BoundaryException>();
  for (const exception of exceptions) {
    const key = siteKey(exception);
    if (
      exception.reason.trim().length < 24 || /[\r\n]/u.test(exception.reason)
    ) {
      findings.push(`${key}: reason must be a specific one-line explanation`);
    }
    if (registered.has(key)) {
      findings.push(`${key}: duplicate runtime-boundary exception`);
    } else {
      registered.set(key, exception);
    }
  }
  const liveKeys = new Set(sites.map(siteKey));
  for (const key of registered.keys()) {
    if (!liveKeys.has(key)) findings.push(`${key}: stale boundary exception`);
  }
  for (const site of sites) {
    if (!registered.has(siteKey(site))) {
      findings.push(
        `${site.path}:${site.line} ${site.rule} in ${site.enclosingFunction}`,
      );
    }
  }
  return findings.sort();
}

Deno.test("runtime-boundary lint rejects unrelated future trust assertions", () => {
  // Keep the inert negative fixture outside the live-source raw-parse count.
  const directParse = ["JSON", "parse"].join(".");
  const planted = boundarySites(
    "unrelated_tools/future_ingest.ts",
    `interface ImportedFact { value: number }
const interpret = JSON.parse;
function hydrate(payload: string): ImportedFact {
  return interpret(payload) as unknown as ImportedFact;
}
function recover(payload: string): ImportedFact {
  const candidate: unknown = ${directParse}(payload);
  return candidate;
}
`,
  );
  assertEquals(boundaryFindings(planted, []), [
    "unrelated_tools/future_ingest.ts:4 asserted-json-boundary in hydrate",
    "unrelated_tools/future_ingest.ts:8 declared-json-return in recover",
  ]);
});

Deno.test("runtime-boundary exceptions become stale with their sites", () => {
  assertEquals(
    boundaryFindings([], [{
      path: "src/retired_reader.ts",
      enclosingFunction: "readRetiredState",
      rule: "asserted-json-boundary",
      reason:
        "Every consumed property was checked before this exact assertion.",
    }]),
    [
      "src/retired_reader.ts#readRetiredState#asserted-json-boundary: stale boundary exception",
    ],
  );
});

Deno.test("authored runtime JSON validates before acquiring a declared type", async () => {
  const files = await structuralGuardScope({
    guard: "tests/runtime_boundary_lint_test.ts#validated-runtime-json",
    universe: "authored-deno",
  });
  const sites = (
    await Promise.all(files.map(async (path) =>
      boundarySites(
        path,
        await Deno.readTextFile(join(REPO_ROOT, path)),
      )
    ))
  ).flat();
  assertEquals(
    boundaryFindings(sites, BOUNDARY_EXCEPTIONS),
    [],
    "runtime JSON crossed into a declared type without validation; decode it " +
      "with src/shared/runtime_decode.ts, or register an exact exception only " +
      "after complete manual projection",
  );
});
