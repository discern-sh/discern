/** Deno lint plugin rejecting unnamed synchronous and promise error swallowing. */

/// <reference lib="deno.unstable" />

import {
  BEST_EFFORT_BOUNDARIES,
  type BestEffortBoundary,
  type BestEffortBoundaryShape,
} from "../src/shared/best_effort.ts";

const PLUGIN_NAME = "discern-silent-catch";
const RULE_NAME = "no-silent-catch";
const DIRECT_BOUNDARY_MARKER =
  /\bdiscern-best-effort:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\b/g;

/** Registry shape accepted by focused synthetic tests. */
export type BestEffortBoundaryRegistry = Readonly<
  Record<string, BestEffortBoundary>
>;

/** Whether an unknown lint value is a traversable syntax node. */
function isNode(value: unknown): value is Deno.lint.Node {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && Array.isArray(record.range);
}

/** Return the parent attached by the lint runtime, if present. */
function parentNode(node: Deno.lint.Node): Deno.lint.Node | undefined {
  const parent = (node as unknown as Record<string, unknown>).parent;
  return isNode(parent) ? parent : undefined;
}

/** Return a statically named property from dot or bracket access. */
function memberName(node: Deno.lint.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  return node.property.type === "Literal" &&
      typeof node.property.value === "string"
    ? node.property.value
    : undefined;
}

/** Whether evaluating an expression is itself an obvious no-op. */
function isInertExpression(node: Deno.lint.Expression): boolean {
  switch (node.type) {
    case "Identifier":
    case "Literal":
    case "ThisExpression":
      return true;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
      return isInertExpression(node.expression);
    case "UnaryExpression":
      return node.operator !== "delete" && isInertExpression(node.argument);
    case "BinaryExpression":
      return node.left.type !== "PrivateIdentifier" &&
        isInertExpression(node.left) && isInertExpression(node.right);
    case "LogicalExpression":
      return isInertExpression(node.left) && isInertExpression(node.right);
    case "ConditionalExpression":
      return isInertExpression(node.test) &&
        isInertExpression(node.consequent) &&
        isInertExpression(node.alternate);
    case "SequenceExpression":
      return node.expressions.every(isInertExpression);
    case "TemplateLiteral":
      return node.expressions.every(isInertExpression);
    default:
      return false;
  }
}

/** Whether a call only wraps a fallback value without reporting the error. */
function isDiscardCall(node: Deno.lint.CallExpression): boolean {
  if (
    node.callee.type === "Identifier" &&
    ["Boolean", "Number", "String"].includes(node.callee.name)
  ) {
    return node.arguments.every((argument) =>
      argument.type !== "SpreadElement" && isInertExpression(argument)
    );
  }
  if (
    node.callee.type !== "MemberExpression" ||
    memberName(node.callee) !== "resolve" ||
    node.callee.object.type !== "Identifier" ||
    node.callee.object.name !== "Promise"
  ) return false;
  return node.arguments.length === 0 ||
    node.arguments.every((argument) =>
      argument.type !== "SpreadElement" && isDiscardExpression(argument)
    );
}

/** Whether an expression is an ordinary absence/discard sentinel. */
function isDiscardExpression(node: Deno.lint.Expression | null): boolean {
  if (node === null) return true;
  switch (node.type) {
    case "Identifier":
      return node.name === "undefined" || node.name === "_";
    case "Literal":
      return true;
    case "ArrayExpression":
      return node.elements.length === 0;
    case "ObjectExpression":
      return node.properties.length === 0;
    case "ConditionalExpression":
      return isDiscardExpression(node.consequent) &&
        isDiscardExpression(node.alternate);
    case "LogicalExpression":
      return isDiscardExpression(node.left) &&
        isDiscardExpression(node.right);
    case "SequenceExpression":
      return node.expressions.every(isDiscardExpression);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
      return isDiscardExpression(node.expression);
    case "TSNonNullExpression":
      return isDiscardExpression(node.expression);
    case "UnaryExpression":
      return node.operator === "void" && isInertExpression(node.argument);
    case "CallExpression":
      return isDiscardCall(node);
    default:
      return false;
  }
}

/** Whether a statement does nothing except discard or return absence. */
function isDiscardStatement(node: Deno.lint.Statement): boolean {
  switch (node.type) {
    case "BlockStatement":
      return node.body.every(isDiscardStatement);
    case "BreakStatement":
    case "ContinueStatement":
      return true;
    case "ExpressionStatement":
      return isDiscardExpression(node.expression) ||
        isInertExpression(node.expression);
    case "ReturnStatement":
      return isDiscardExpression(node.argument);
    case "VariableDeclaration":
      return node.declarations.every((declaration) =>
        declaration.init === null || isDiscardExpression(declaration.init)
      );
    case "IfStatement":
      return isDiscardStatement(node.consequent) &&
        (node.alternate === null || isDiscardStatement(node.alternate));
    default:
      return false;
  }
}

/** Whether a callback body only discards the rejection or returns absence. */
function handlerDiscards(
  handler:
    | Deno.lint.ArrowFunctionExpression
    | Deno.lint.FunctionDeclaration
    | Deno.lint.FunctionExpression,
): boolean {
  if (handler.body === null) return false;
  return handler.body.type === "BlockStatement"
    ? handler.body.body.every(isDiscardStatement)
    : isDiscardExpression(handler.body);
}

/** Stable authored name of the function surrounding a syntax site. */
function enclosingFunction(node: Deno.lint.Node): string {
  let current: Deno.lint.Node | undefined = parentNode(node);
  while (current !== undefined) {
    if (current.type === "FunctionDeclaration") {
      return current.id?.name ?? "<anonymous function>";
    }
    if (current.type === "FunctionExpression") {
      if (current.id !== null) return current.id.name;
      const parent = parentNode(current);
      if (
        parent?.type === "VariableDeclarator" &&
        parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }
      if (parent?.type === "Property" && !parent.computed) {
        if (parent.key.type === "Identifier") return parent.key.name;
        if (
          parent.key.type === "Literal" &&
          typeof parent.key.value === "string"
        ) return parent.key.value;
      }
    }
    if (current.type === "ArrowFunctionExpression") {
      const parent = parentNode(current);
      if (
        parent?.type === "VariableDeclarator" &&
        parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }
      if (parent?.type === "Property" && !parent.computed) {
        if (parent.key.type === "Identifier") return parent.key.name;
        if (
          parent.key.type === "Literal" &&
          typeof parent.key.value === "string"
        ) return parent.key.value;
      }
    }
    if (current.type === "MethodDefinition" && !current.computed) {
      if (current.key.type === "Identifier") return current.key.name;
      if (
        current.key.type === "Literal" &&
        typeof current.key.value === "string"
      ) return current.key.value;
    }
    current = parentNode(current);
  }
  return "<module>";
}

/** Normalize a lint filename for suffix matching against repo-relative paths. */
function filenameMatches(filename: string, path: string): boolean {
  const normalized = filename.replaceAll("\\", "/");
  return normalized === path || normalized.endsWith(`/${path}`);
}

/** Whether a catch clause protects an awaited operation. */
function catchShape(
  context: Deno.lint.RuleContext,
  node: Deno.lint.CatchClause,
  awaitRanges: readonly Deno.lint.Range[],
): BestEffortBoundaryShape {
  const owner = context.sourceCode.getAncestors(node)
    .filter((ancestor): ancestor is Deno.lint.TryStatement =>
      ancestor.type === "TryStatement"
    )
    .sort((left, right) =>
      (left.range[1] - left.range[0]) - (right.range[1] - right.range[0])
    )[0];
  if (owner === undefined) return "sync";
  return awaitRanges.some(([start, end]) =>
      start >= owner.block.range[0] && end <= owner.block.range[1]
    )
    ? "async"
    : "sync";
}

/** Whether this catch is one of the capability's own containment sites. */
function isCapabilityImplementationCatch(
  filename: string,
  node: Deno.lint.CatchClause,
): boolean {
  if (!filenameMatches(filename, "src/shared/best_effort.ts")) return false;
  const owner = enclosingFunction(node);
  return owner === "runBestEffort" || owner === "runBestEffortSync";
}

/** Extract exact direct-boundary IDs from comments inside one handler. */
function directBoundaryIds(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
): string[] {
  const ids: string[] = [];
  for (const comment of context.sourceCode.getCommentsInside(node)) {
    for (const match of comment.value.matchAll(DIRECT_BOUNDARY_MARKER)) {
      const id = match[1];
      if (id !== undefined) ids.push(id);
    }
  }
  return ids;
}

/** Explain why an exact direct exception does or does not match this site. */
function directBoundaryMismatch(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
  shape: BestEffortBoundaryShape,
  registry: BestEffortBoundaryRegistry,
): string | undefined {
  const ids = directBoundaryIds(context, node);
  if (ids.length === 0) {
    return "Handle or report this error, or route a side effect through bestEffort with a registered boundary ID.";
  }
  if (ids.length !== 1) {
    return "A direct silent-catch exception must name exactly one discern-best-effort boundary ID.";
  }
  const id = ids[0];
  if (id === undefined) return "The direct best-effort boundary ID is missing.";
  const boundary = registry[id];
  if (boundary === undefined) {
    return `Unknown best-effort boundary '${id}'; add its exact registry entry or remove the marker.`;
  }
  const owner = enclosingFunction(node);
  if (
    boundary.kind !== "direct" || boundary.shape !== shape ||
    !filenameMatches(context.filename, boundary.path) ||
    boundary.enclosingFunction !== owner
  ) {
    return `Best-effort boundary '${id}' does not match ${context.filename}#${owner} (${shape}).`;
  }
  return undefined;
}

/** Build the silent-catch plugin against an explicit registry for focused tests. */
export function silentCatchPlugin(
  registry: BestEffortBoundaryRegistry = BEST_EFFORT_BOUNDARIES,
): Deno.lint.Plugin {
  return {
    name: PLUGIN_NAME,
    rules: {
      [RULE_NAME]: {
        /** Reject obvious statement and promise rejection swallowing. */
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const normalizedFilename = context.filename.replaceAll("\\\\", "/");
          if (
            normalizedFilename.startsWith("tests/") ||
            normalizedFilename.includes("/tests/")
          ) return {};
          const functionValues = new Map<
            string,
            Deno.lint.ArrowFunctionExpression | Deno.lint.FunctionExpression
          >();
          const functionDeclarations = new Map<
            string,
            Deno.lint.FunctionDeclaration
          >();
          const promiseCatches: Deno.lint.CallExpression[] = [];
          const awaitRanges: Deno.lint.Range[] = [];

          const checkPromiseCatch = (
            node: Deno.lint.CallExpression,
          ): void => {
            if (node.callee.type !== "MemberExpression") return;
            const handlerIndex = memberName(node.callee) === "then" ? 1 : 0;
            const handlerArg = node.arguments[handlerIndex];
            if (
              handlerArg === undefined || handlerArg.type === "SpreadElement"
            ) {
              return;
            }
            let handler:
              | Deno.lint.ArrowFunctionExpression
              | Deno.lint.FunctionExpression
              | Deno.lint.FunctionDeclaration
              | undefined;
            if (
              handlerArg.type === "ArrowFunctionExpression" ||
              handlerArg.type === "FunctionExpression"
            ) {
              handler = handlerArg;
            } else if (handlerArg.type === "Identifier") {
              handler = functionValues.get(handlerArg.name) ??
                functionDeclarations.get(handlerArg.name);
            }
            if (handler === undefined || !handlerDiscards(handler)) return;
            const body = handler.body;
            if (body === null) return;
            const mismatch = directBoundaryMismatch(
              context,
              body,
              "async",
              registry,
            );
            if (mismatch === undefined) return;
            context.report({ node, message: mismatch });
          };

          return {
            VariableDeclarator(node: Deno.lint.VariableDeclarator): void {
              if (
                node.id.type !== "Identifier" || node.init === null ||
                (node.init.type !== "ArrowFunctionExpression" &&
                  node.init.type !== "FunctionExpression")
              ) return;
              functionValues.set(node.id.name, node.init);
            },
            FunctionDeclaration(node: Deno.lint.FunctionDeclaration): void {
              if (node.id !== null) {
                functionDeclarations.set(node.id.name, node);
              }
            },
            CatchClause(node: Deno.lint.CatchClause): void {
              if (isCapabilityImplementationCatch(context.filename, node)) {
                return;
              }
              if (!node.body.body.every(isDiscardStatement)) return;
              const mismatch = directBoundaryMismatch(
                context,
                node.body,
                catchShape(context, node, awaitRanges),
                registry,
              );
              if (mismatch === undefined) return;
              context.report({ node, message: mismatch });
            },
            AwaitExpression(node: Deno.lint.AwaitExpression): void {
              awaitRanges.push(node.range);
            },
            ForOfStatement(node: Deno.lint.ForOfStatement): void {
              if (node.await) awaitRanges.push(node.range);
            },
            CallExpression(node: Deno.lint.CallExpression): void {
              if (
                node.callee.type === "MemberExpression" &&
                ["catch", "then"].includes(memberName(node.callee) ?? "")
              ) promiseCatches.push(node);
            },
            "Program:exit"(): void {
              for (const node of promiseCatches) checkPromiseCatch(node);
            },
          };
        },
      },
    },
  };
}

export default silentCatchPlugin();
