/**
 * Deno lint plugin requiring JSDoc immediately before every function
 * declaration in the authored TypeScript universe.
 */

/// <reference lib="deno.unstable" />

const PLUGIN_NAME = "discern";
const RULE_NAME = "require-function-docblock";

/** Return the syntax node whose leading comments document `node`. */
function documentationAnchor(
  node: Deno.lint.FunctionDeclaration,
): Deno.lint.Node {
  const parent = node.parent;
  if (
    (parent.type === "ExportDefaultDeclaration" ||
      parent.type === "ExportNamedDeclaration") &&
    parent.declaration === node
  ) {
    return parent;
  }
  return node;
}

/** Whether `comment` is Deno metadata that must hug the declaration. */
function isLintDirective(
  comment: Deno.lint.LineComment | Deno.lint.BlockComment,
): boolean {
  return comment.type === "Line" &&
    /^\s*deno-lint-ignore(?:-file)?\b/.test(comment.value);
}

/** Whether `node` has leading JSDoc before any Deno lint directives. */
function hasFunctionDocblock(
  context: Deno.lint.RuleContext,
  node: Deno.lint.FunctionDeclaration,
): boolean {
  const anchor = documentationAnchor(node);
  const comments = context.sourceCode.getCommentsBefore(anchor);
  let cursor = anchor.range[0];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment === undefined) return false;
    if (
      context.sourceCode.text.slice(comment.range[1], cursor).trim().length > 0
    ) {
      return false;
    }
    if (isLintDirective(comment)) {
      cursor = comment.range[0];
      continue;
    }
    return comment.type === "Block" && comment.value.startsWith("*");
  }
  return false;
}

/** The repository's project-specific lint rules. */
const plugin: Deno.lint.Plugin = {
  name: PLUGIN_NAME,
  rules: {
    [RULE_NAME]: {
      /** Enforce the function-declaration documentation invariant. */
      create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
        return {
          FunctionDeclaration(node: Deno.lint.FunctionDeclaration): void {
            if (hasFunctionDocblock(context, node)) return;
            const name = node.id?.name ?? "default export";
            context.report({
              node,
              message:
                `Function '${name}' must have a JSDoc block immediately above its declaration.`,
            });
          },
        };
      },
    },
  },
};

export default plugin;
