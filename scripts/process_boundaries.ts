/**
 * Structural census for production process output and termination.
 *
 * The Git-derived authored-TypeScript universe is narrowed to `src/` because
 * this contract governs the shipped product process, not standalone repository
 * tooling. Every direct primitive must bind one-to-one to its exact registry row.
 */

import { join } from "@std/path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  PROCESS_EXIT_BOUNDARIES,
  PROCESS_OUTPUT_BOUNDARIES,
  type ProcessExitBoundary,
  processExitBoundaryCount,
  type ProcessOutputBoundary,
  processOutputBoundaryCount,
  type ProcessOutputChannel,
} from "../src/shared/process_boundaries.ts";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";

/** One direct process-output call discovered from syntax. */
export interface DirectProcessOutputSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly line: number;
  readonly column: number;
  readonly operation: string;
  readonly channel: ProcessOutputChannel;
}

/** One direct process-exit call discovered from syntax. */
export interface DirectProcessExitSite {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly line: number;
  readonly column: number;
  readonly operation: "Deno.exit";
}

/** Parsed findings from one or more production sources. */
export interface DirectProcessSites {
  readonly output: readonly DirectProcessOutputSite[];
  readonly exits: readonly DirectProcessExitSite[];
}

type Alias =
  | { readonly kind: "console" }
  | { readonly kind: "deno" }
  | {
    readonly kind: "stream";
    readonly channel: ProcessOutputChannel;
  }
  | {
    readonly kind: "output-method";
    readonly operation: string;
    readonly channel: ProcessOutputChannel;
  }
  | { readonly kind: "exit-method" };

/** Nearest function name that binds a call to one exact registry operation. */
function enclosingFunctionName(node: Node): string {
  const owner = node.getAncestors().find((ancestor) => {
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isConstructorDeclaration(ancestor)
    ) {
      return true;
    }
    if (
      Node.isFunctionExpression(ancestor) && ancestor.getName() !== undefined
    ) {
      return true;
    }
    const parent = ancestor.getParent();
    return (Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor)) &&
      (Node.isVariableDeclaration(parent) ||
        Node.isPropertyAssignment(parent));
  });
  if (owner === undefined) return "<module>";
  if (Node.isConstructorDeclaration(owner)) return "constructor";
  if (Node.isFunctionDeclaration(owner) || Node.isMethodDeclaration(owner)) {
    return owner.getName() ?? "<module>";
  }
  if (Node.isFunctionExpression(owner)) {
    const ownName = owner.getName();
    if (ownName !== undefined) return ownName;
  }
  const assignedTo = owner.getParent();
  if (
    Node.isVariableDeclaration(assignedTo) ||
    Node.isPropertyAssignment(assignedTo)
  ) {
    return assignedTo.getName();
  }
  return "<module>";
}

/** Static member name from dot or string-literal bracket access. */
function memberName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;
  const argument = node.getArgumentExpression();
  return argument !== undefined && Node.isStringLiteral(argument)
    ? argument.getLiteralValue()
    : undefined;
}

/** Object side of dot or element access. */
function memberObject(node: Node): Node | undefined {
  return Node.isPropertyAccessExpression(node) ||
      Node.isElementAccessExpression(node)
    ? node.getExpression()
    : undefined;
}

/** Extend a resolved object alias through one static member access. */
function memberAlias(base: Alias, property: string): Alias | undefined {
  if (base.kind === "deno") {
    if (property === "stdout" || property === "stderr") {
      return { kind: "stream", channel: property };
    }
    if (property === "exit") return { kind: "exit-method" };
    return undefined;
  }
  if (base.kind === "console") {
    return {
      kind: "output-method",
      operation: `console.${property}`,
      channel: property === "error" || property === "warn"
        ? "stderr"
        : "stdout",
    };
  }
  if (
    base.kind === "stream" &&
    (property === "write" || property === "writeSync")
  ) {
    return {
      kind: "output-method",
      operation: `Deno.${base.channel}.${property}`,
      channel: base.channel,
    };
  }
  return undefined;
}

/** Resolve a root, alias, member, or stdout/stderr conditional. */
function resolveAlias(node: Node, aliases: ReadonlyMap<string, Alias>):
  | Alias
  | undefined {
  if (Node.isIdentifier(node)) {
    if (node.getText() === "console") return { kind: "console" };
    if (node.getText() === "Deno") return { kind: "deno" };
    return aliases.get(node.getText());
  }
  if (Node.isConditionalExpression(node)) {
    const whenTrue = resolveAlias(node.getWhenTrue(), aliases);
    const whenFalse = resolveAlias(node.getWhenFalse(), aliases);
    if (
      whenTrue?.kind === "stream" && whenFalse?.kind === "stream" &&
      whenTrue.channel !== whenFalse.channel
    ) {
      return { kind: "stream", channel: "stdout-or-stderr" };
    }
    return whenTrue?.kind === whenFalse?.kind &&
        JSON.stringify(whenTrue) === JSON.stringify(whenFalse)
      ? whenTrue
      : undefined;
  }
  const object = memberObject(node);
  const property = memberName(node);
  if (object === undefined || property === undefined) return undefined;
  const base = resolveAlias(object, aliases);
  return base === undefined ? undefined : memberAlias(base, property);
}

/** Add aliases declared through identifiers or object destructuring. */
function collectAliases(sourceFile: SourceFile): Map<string, Alias> {
  const aliases = new Map<string, Alias>();
  const declarations = sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const initializer = declaration.getInitializer();
      if (initializer === undefined) continue;
      const base = resolveAlias(initializer, aliases);
      if (base === undefined) continue;
      const name = declaration.getNameNode();
      if (Node.isIdentifier(name)) {
        if (aliases.has(name.getText())) continue;
        aliases.set(name.getText(), base);
        changed = true;
        continue;
      }
      if (!Node.isObjectBindingPattern(name)) continue;
      for (const element of name.getElements()) {
        if (!Node.isBindingElement(element)) continue;
        const local = element.getNameNode();
        if (!Node.isIdentifier(local) || aliases.has(local.getText())) continue;
        const propertyNode = element.getPropertyNameNode();
        const property = propertyNode === undefined
          ? local.getText()
          : Node.isIdentifier(propertyNode) ||
              Node.isStringLiteral(propertyNode)
          ? propertyNode.getText().replace(/^['"]|['"]$/gu, "")
          : undefined;
        if (property === undefined) continue;
        const alias = memberAlias(base, property);
        if (alias === undefined) continue;
        aliases.set(local.getText(), alias);
        changed = true;
      }
    }
  }
  return aliases;
}

/** Find direct output and exit calls in one parsed module. */
function directProcessSitesInSourceFile(
  path: string,
  sourceFile: SourceFile,
): DirectProcessSites {
  const aliases = collectAliases(sourceFile);
  const output: DirectProcessOutputSite[] = [];
  const exits: DirectProcessExitSite[] = [];
  for (
    const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
  ) {
    const callee = resolveAlias(call.getExpression(), aliases);
    if (callee?.kind !== "output-method" && callee?.kind !== "exit-method") {
      continue;
    }
    const location = sourceFile.getLineAndColumnAtPos(call.getStart());
    const common = {
      path,
      enclosingFunction: enclosingFunctionName(call),
      line: location.line,
      column: location.column,
    };
    if (callee.kind === "output-method") {
      output.push({
        ...common,
        operation: callee.operation,
        channel: callee.channel,
      });
    } else {
      exits.push({ ...common, operation: "Deno.exit" });
    }
  }
  return { output, exits };
}

/** Parse one source string for focused and planted tests. */
export function directProcessSitesInSource(
  source: string,
  path = "src/fixture.ts",
): DirectProcessSites {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return directProcessSitesInSourceFile(
    path,
    project.createSourceFile(path, source),
  );
}

/** Git-derived product source universe; standalone tooling is intentionally out. */
export async function productionProcessBoundaryFiles(
  root: string = REPO_ROOT,
): Promise<string[]> {
  return await structuralGuardScope({
    guard: "scripts/process_boundaries.ts#production-process-boundaries",
    universe: "authored-ts",
    narrow: {
      reason:
        "The process egress and termination contract governs the shipped src tree; standalone tooling owns its own presentation process.",
      include: (path) => path.startsWith("src/"),
    },
  }, root);
}

/** Scan a declared set of source files. */
export async function directProcessSitesInFiles(
  root: string,
  files: readonly string[],
): Promise<DirectProcessSites> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const sites = await Promise.all(files.map(async (path) => {
    const source = await Deno.readTextFile(join(root, path));
    return directProcessSitesInSourceFile(
      path,
      project.createSourceFile(path, source),
    );
  }));
  return {
    output: sites.flatMap((found) => found.output),
    exits: sites.flatMap((found) => found.exits),
  };
}

/** Exact key shared by one output site and its registry row. */
function outputKey(
  value: Pick<
    DirectProcessOutputSite | ProcessOutputBoundary,
    "path" | "enclosingFunction" | "operation" | "channel"
  >,
): string {
  return [
    value.path,
    value.enclosingFunction,
    value.operation,
    value.channel,
  ].join("\0");
}

/** Exact key shared by one exit site and its registry row. */
function exitKey(
  value: Pick<
    DirectProcessExitSite | ProcessExitBoundary,
    "path" | "enclosingFunction" | "operation"
  >,
): string {
  return [value.path, value.enclosingFunction, value.operation].join("\0");
}

/** Generic bidirectional parity over a count-sensitive exact key. */
function parityFindings<TActual, TBoundary>(
  kind: "output" | "exit",
  actual: readonly TActual[],
  registered: Readonly<Record<string, TBoundary>>,
  keyOfActual: (value: TActual) => string,
  keyOfBoundary: (value: TBoundary) => string,
  renderActual: (value: TActual) => string,
): string[] {
  const remaining = new Map<string, string[]>();
  for (const [id, boundary] of Object.entries(registered)) {
    const key = keyOfBoundary(boundary);
    remaining.set(key, [...(remaining.get(key) ?? []), id]);
  }
  const findings: string[] = [];
  for (const site of actual) {
    const key = keyOfActual(site);
    const ids = remaining.get(key) ?? [];
    const id = ids.shift();
    if (id === undefined) {
      findings.push(`unregistered process ${kind} at ${renderActual(site)}`);
    }
    remaining.set(key, ids);
  }
  for (const ids of remaining.values()) {
    for (const id of ids) {
      findings.push(`stale process ${kind} boundary '${id}'`);
    }
  }
  return findings.sort();
}

/** Unknown and stale direct-output boundary findings. */
export function processOutputBoundaryFindings(
  actual: readonly DirectProcessOutputSite[],
  registered: Readonly<Record<string, ProcessOutputBoundary>> =
    PROCESS_OUTPUT_BOUNDARIES,
): string[] {
  return parityFindings(
    "output",
    actual,
    registered,
    outputKey,
    outputKey,
    (site) =>
      `${site.path}:${site.line}:${site.column} inside ${site.enclosingFunction} (${site.operation})`,
  );
}

/** Unknown and stale direct-exit boundary findings. */
export function processExitBoundaryFindings(
  actual: readonly DirectProcessExitSite[],
  registered: Readonly<Record<string, ProcessExitBoundary>> =
    PROCESS_EXIT_BOUNDARIES,
): string[] {
  return parityFindings(
    "exit",
    actual,
    registered,
    exitKey,
    exitKey,
    (site) =>
      `${site.path}:${site.line}:${site.column} inside ${site.enclosingFunction}`,
  );
}

/** Validate stable ids and review metadata before comparing syntax. */
export function processBoundaryMetadataFindings(): string[] {
  const findings: string[] = [];
  const validate = (
    kind: "output" | "exit",
    rows: Readonly<Record<string, ProcessOutputBoundary | ProcessExitBoundary>>,
  ): void => {
    const ids = Object.keys(rows);
    if (ids.join("\0") !== [...ids].sort().join("\0")) {
      findings.push(`process ${kind} boundary ids must be sorted`);
    }
    for (const [id, row] of Object.entries(rows)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
        findings.push(`process ${kind} boundary '${id}' needs a kebab-case id`);
      }
      if (!row.path.startsWith("src/") || !row.path.endsWith(".ts")) {
        findings.push(
          `process ${kind} boundary '${id}' needs an exact src TypeScript path`,
        );
      }
      for (
        const [field, value] of [
          ["enclosingFunction", row.enclosingFunction],
          ["operation", row.operation],
          ["reason", row.reason],
          [
            kind === "output" ? "purpose" : "exitPurpose",
            "purpose" in row ? row.purpose : row.exitPurpose,
          ],
        ] as const
      ) {
        const minimum = field === "enclosingFunction" ? 1 : 8;
        if (value.trim().length < minimum || /[\r\n]/u.test(value)) {
          findings.push(
            `process ${kind} boundary '${id}' ${field} needs a specific one-line value`,
          );
        }
      }
    }
  };
  validate("output", PROCESS_OUTPUT_BOUNDARIES);
  validate("exit", PROCESS_EXIT_BOUNDARIES);
  return findings;
}

/** Refuse registry drift before returning the live exact populations. */
export async function validateProcessBoundaries(
  root: string = REPO_ROOT,
): Promise<DirectProcessSites> {
  const actual = await directProcessSitesInFiles(
    root,
    await productionProcessBoundaryFiles(root),
  );
  const findings = [
    ...processBoundaryMetadataFindings(),
    ...processOutputBoundaryFindings(actual.output),
    ...processExitBoundaryFindings(actual.exits),
  ];
  if (findings.length > 0) {
    throw new Error(
      "production process boundaries diverged from their exact registries:\n  " +
        findings.join("\n  "),
    );
  }
  return actual;
}

/** Validate and print both falling registry censuses. */
async function main(): Promise<void> {
  await validateProcessBoundaries();
  for (const [id, boundary] of Object.entries(PROCESS_OUTPUT_BOUNDARIES)) {
    console.error(
      `${id}: ${boundary.path}#${boundary.enclosingFunction} ${boundary.operation} — ${boundary.purpose}`,
    );
  }
  for (const [id, boundary] of Object.entries(PROCESS_EXIT_BOUNDARIES)) {
    console.error(
      `${id}: ${boundary.path}#${boundary.enclosingFunction} — ${boundary.exitPurpose}`,
    );
  }
  console.log(
    `DISCERN_METRIC process_output_boundaries ${processOutputBoundaryCount()}`,
  );
  console.log(
    `DISCERN_METRIC process_exit_boundaries ${processExitBoundaryCount()}`,
  );
}

if (import.meta.main) await main();
