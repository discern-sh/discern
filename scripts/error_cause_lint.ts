/**
 * Deno lint plugin preserving causal chains when a catch creates a replacement
 * error from the value it caught.
 */

/// <reference lib="deno.unstable" />

const PLUGIN_NAME = "discern-error-cause";
const RULE_NAME = "require-wrapped-error-cause";

/** Whether an unknown value is an ESTree node exposed by Deno lint. */
function isNode(value: unknown): value is Deno.lint.Node {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && Array.isArray(record.range);
}

/** Return the parent attached by the lint runtime, if this node has one. */
function parentNode(node: Deno.lint.Node): Deno.lint.Node | undefined {
  const parent = (node as unknown as Record<string, unknown>).parent;
  return isNode(parent) ? parent : undefined;
}

/** Whether an identifier is a value reference rather than a static property key. */
function isValueReference(node: Deno.lint.Identifier): boolean {
  const parent = node.parent;
  if (parent.type === "MemberExpression") {
    return parent.object === node || parent.computed;
  }
  if (parent.type === "Property" && parent.key === node) {
    return parent.computed || parent.shorthand;
  }
  return true;
}

/** Name a property key without evaluating computed expressions. */
function staticPropertyName(property: Deno.lint.Property): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (
    property.key.type === "Literal" && typeof property.key.value === "string"
  ) {
    return property.key.value;
  }
  return undefined;
}

/** Whether `node` is the value of a direct `{ cause: ... }` option. */
function isCauseReference(
  node: Deno.lint.Identifier,
  replacement: Deno.lint.NewExpression,
): boolean {
  let current: Deno.lint.Node | undefined = parentNode(node);
  while (current !== undefined) {
    if (current === replacement) return false;
    if (
      current.type === "Property" && staticPropertyName(current) === "cause"
    ) {
      const object = parentNode(current);
      return object?.type === "ObjectExpression" &&
        parentNode(object) === replacement;
    }
    current = parentNode(current);
  }
  return false;
}

/** Whether a constructor denotes the built-in or a named error subtype. */
function isErrorConstructor(callee: Deno.lint.Expression): boolean {
  if (callee.type === "Identifier") return callee.name.endsWith("Error");
  if (callee.type !== "MemberExpression") return false;
  const property = callee.property;
  if (!callee.computed && property.type === "Identifier") {
    return property.name.endsWith("Error");
  }
  return property.type === "Literal" && typeof property.value === "string" &&
    property.value.endsWith("Error");
}

interface ActiveReplacement {
  readonly caughtName: string;
  readonly node: Deno.lint.NewExpression;
  hasCause: boolean;
  referencesCaught: boolean;
}

/** The repository's causal-chain lint rule. */
const plugin: Deno.lint.Plugin = {
  name: PLUGIN_NAME,
  rules: {
    [RULE_NAME]: {
      /** Require a cause whenever a replacement error consumes a caught value. */
      create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
        const catchBindings: Array<string | undefined> = [];
        const replacements: ActiveReplacement[] = [];
        return {
          CatchClause(node: Deno.lint.CatchClause): void {
            catchBindings.push(
              node.param?.type === "Identifier" ? node.param.name : undefined,
            );
          },
          "CatchClause:exit"(): void {
            catchBindings.pop();
          },
          NewExpression(node: Deno.lint.NewExpression): void {
            if (!isErrorConstructor(node.callee)) return;
            const caughtName = catchBindings.findLast((name) =>
              name !== undefined
            );
            if (caughtName === undefined) return;
            replacements.push({
              caughtName,
              hasCause: false,
              node,
              referencesCaught: false,
            });
          },
          Identifier(node: Deno.lint.Identifier): void {
            const replacement = replacements.at(-1);
            if (
              replacement === undefined ||
              node.name !== replacement.caughtName || !isValueReference(node)
            ) return;
            replacement.referencesCaught = true;
            if (isCauseReference(node, replacement.node)) {
              replacement.hasCause = true;
            }
          },
          "NewExpression:exit"(node: Deno.lint.NewExpression): void {
            const replacement = replacements.at(-1);
            if (replacement?.node !== node) return;
            replacements.pop();
            if (!replacement.referencesCaught || replacement.hasCause) return;
            context.report({
              node,
              message:
                `An error built from caught '${replacement.caughtName}' must preserve it with { cause: ${replacement.caughtName} }.`,
            });
          },
        };
      },
    },
  },
};

export default plugin;
