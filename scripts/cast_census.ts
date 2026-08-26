/**
 * Census TypeScript `as` expressions without treating every assertion as the
 * same risk.
 *
 * The advisory `type_assertions` metric counts complete assertion expressions:
 * a chain such as `value as unknown as Item` is one expression, not two. The
 * blocking `unsafe_type_assertions` metric counts only the syntax classes in
 * {@link UNSAFE_ASSERTION_KINDS}. The authority is ordered from specific chains
 * to the single `as any` form so every expression receives at most one unsafe
 * classification.
 */

import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";

interface AssertionSyntax {
  /** Asserted type text from the innermost assertion to the outermost. */
  readonly types: readonly string[];
}

interface UnsafeAssertionKindDefinition {
  readonly id: string;
  readonly description: string;
  readonly matches: (syntax: AssertionSyntax) => boolean;
}

/** The deterministic assertion syntax classes held by the falling Standard. */
export const UNSAFE_ASSERTION_KINDS = [
  {
    id: "as-any-as",
    description: "a chained assertion crosses through any",
    matches: ({ types }) => types.slice(0, -1).includes("any"),
  },
  {
    id: "as-unknown-as",
    description: "a chained assertion crosses through unknown",
    matches: ({ types }) => types.slice(0, -1).includes("unknown"),
  },
  {
    id: "as-any",
    description: "an assertion ends at any",
    matches: ({ types }) => types.at(-1) === "any",
  },
] as const satisfies readonly UnsafeAssertionKindDefinition[];

export type UnsafeAssertionKind = (typeof UNSAFE_ASSERTION_KINDS)[number]["id"];

export type AssertionKind = UnsafeAssertionKind | "as-const" | "typed";

/** One complete assertion expression at an actionable source location. */
export interface TypeAssertionFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: AssertionKind;
  readonly assertedTypes: readonly string[];
  readonly text: string;
}

/** Whether an `as` node is nested inside the same assertion chain. */
function isInnerAssertion(node: Node): boolean {
  const parent = node.getParent();
  return Node.isAsExpression(parent) && parent.getExpression() === node;
}

/** Read one complete `as` chain from its outermost expression. */
function assertedTypes(node: Node): string[] {
  if (!Node.isAsExpression(node)) return [];
  const types: string[] = [];
  let current: Node = node;
  while (Node.isAsExpression(current)) {
    types.unshift(current.getTypeNodeOrThrow().getText());
    current = current.getExpression();
  }
  return types;
}

/** Classify one complete assertion chain against the iterable authority. */
function assertionKind(types: readonly string[]): AssertionKind {
  const syntax = { types };
  for (const definition of UNSAFE_ASSERTION_KINDS) {
    if (definition.matches(syntax)) return definition.id;
  }
  return types.length === 1 && types[0] === "const" ? "as-const" : "typed";
}

/** Collect complete assertion expressions from one parsed source file. */
function findingsInSourceFile(
  file: string,
  sourceFile: SourceFile,
): TypeAssertionFinding[] {
  const findings: TypeAssertionFinding[] = [];
  for (
    const node of sourceFile.getDescendantsOfKind(SyntaxKind.AsExpression)
  ) {
    if (isInnerAssertion(node)) continue;
    const types = assertedTypes(node);
    const location = sourceFile.getLineAndColumnAtPos(node.getStart());
    findings.push({
      file,
      line: location.line,
      column: location.column,
      kind: assertionKind(types),
      assertedTypes: types,
      text: node.getText().split("\n", 1)[0]?.trim() ?? "",
    });
  }
  return findings;
}

/** Parse one source string for focused fixtures and syntax-class tests. */
export function typeAssertionsInSource(
  source: string,
  file = "fixture.ts",
): TypeAssertionFinding[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return findingsInSourceFile(file, project.createSourceFile(file, source));
}

/** Resolve the complete Git-derived authored-TypeScript census universe. */
export async function castCensusFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await structuralGuardScope({
    guard: "scripts/cast_census.ts#authored-type-assertions",
    universe: "authored-ts",
  }, root);
}

/** Scan every authored TypeScript file beneath one repository root. */
export async function typeAssertionsInFiles(
  root: string,
  files: readonly string[],
): Promise<TypeAssertionFinding[]> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const findings: TypeAssertionFinding[] = [];
  for (const file of files) {
    const source = await Deno.readTextFile(join(root, file));
    findings.push(
      ...findingsInSourceFile(file, project.createSourceFile(file, source)),
    );
  }
  return findings;
}

/** Render the advisory inventory and the blocking unsafe census. */
async function main(): Promise<void> {
  const findings = await typeAssertionsInFiles(
    REPO_ROOT,
    await castCensusFiles(),
  );
  const unsafeKinds: ReadonlySet<AssertionKind> = new Set<AssertionKind>(
    UNSAFE_ASSERTION_KINDS.map((definition) => definition.id),
  );
  const unsafe = findings.filter((finding) => unsafeKinds.has(finding.kind));
  for (const finding of unsafe) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} ${finding.kind} ` +
        `${finding.text}`,
    );
  }
  const asConst = findings.filter((finding) => finding.kind === "as-const")
    .length;
  const typed = findings.filter((finding) => finding.kind === "typed").length;
  console.error(
    `${findings.length} type assertion expressions: ${unsafe.length} unsafe, ` +
      `${asConst} as const, ${typed} ordinary typed.`,
  );
  console.log(`DISCERN_METRIC type_assertions ${findings.length}`);
  console.log(`DISCERN_METRIC unsafe_type_assertions ${unsafe.length}`);
}

if (import.meta.main) await main();
