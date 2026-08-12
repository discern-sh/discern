/**
 * Deno lint plugin that keeps static discern-owned plan-step labels behind the
 * shared built-in registry. Configured identifiers remain dynamic expressions.
 */

/// <reference lib="deno.unstable" />

import { STEP_KINDS } from "../src/shared/result.ts";

const PLUGIN_NAME = "discern";
const RULE_NAME = "built-in-step-label-registry";
const STEP_KIND_SET = new Set<string>(STEP_KINDS);

/** Return an object property's non-computed identifier or string key. */
function propertyName(property: Deno.lint.Property): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (
    property.key.type === "Literal" &&
    typeof property.key.value === "string"
  ) {
    return property.key.value;
  }
  return undefined;
}

/** Find an ordinary property by name on an object literal. */
function namedProperty(
  node: Deno.lint.ObjectExpression,
  name: string,
): Deno.lint.Property | undefined {
  return node.properties.find((property): property is Deno.lint.Property =>
    property.type === "Property" && propertyName(property) === name
  );
}

/** Read a string literal, including a template literal without expressions. */
function staticString(node: Deno.lint.Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.cooked;
  }
  return undefined;
}

/** The repository's structural rule for built-in step-label enrollment. */
const plugin: Deno.lint.Plugin = {
  name: PLUGIN_NAME,
  rules: {
    [RULE_NAME]: {
      /** Reject inline static labels on objects that carry a real step kind. */
      create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
        return {
          ObjectExpression(node: Deno.lint.ObjectExpression): void {
            const kindProperty = namedProperty(node, "kind");
            const labelProperty = namedProperty(node, "label");
            if (kindProperty === undefined || labelProperty === undefined) {
              return;
            }
            const kind = staticString(kindProperty.value);
            const label = staticString(labelProperty.value);
            if (
              kind === undefined || !STEP_KIND_SET.has(kind) ||
              label === undefined
            ) {
              return;
            }
            context.report({
              node: labelProperty.value,
              message:
                `Static built-in step label '${label}' must come from BUILT_IN_STEP_LABELS. Configured identifiers must remain dynamic expressions.`,
            });
          },
        };
      },
    },
  },
};

export default plugin;
