/**
 * Deno lint plugin requiring informative JSDoc immediately before every
 * function declaration in the authored Deno source universe.
 */

/// <reference lib="deno.unstable" />

const PLUGIN_NAME = "discern";
const RULE_NAME = "require-function-docblock";

const GENERIC_DOCUMENTATION_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "because",
  "by",
  "check",
  "compute",
  "create",
  "determine",
  "do",
  "does",
  "for",
  "from",
  "get",
  "gets",
  "given",
  "in",
  "input",
  "into",
  "is",
  "it",
  "its",
  "make",
  "makes",
  "named",
  "of",
  "on",
  "or",
  "output",
  "process",
  "produce",
  "provide",
  "provided",
  "read",
  "resolve",
  "result",
  "results",
  "return",
  "returns",
  "run",
  "set",
  "the",
  "this",
  "to",
  "value",
  "values",
  "whether",
  "with",
  "write",
].map(normalizeWord));

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

/** Find `node`'s attached JSDoc before any Deno lint directives. */
function functionDocblock(
  context: Deno.lint.RuleContext,
  node: Deno.lint.FunctionDeclaration,
): Deno.lint.BlockComment | undefined {
  const anchor = documentationAnchor(node);
  const comments = context.sourceCode.getCommentsBefore(anchor);
  let cursor = anchor.range[0];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment === undefined) return undefined;
    if (
      context.sourceCode.text.slice(comment.range[1], cursor).trim().length > 0
    ) {
      return undefined;
    }
    if (isLintDirective(comment)) {
      cursor = comment.range[0];
      continue;
    }
    return comment.type === "Block" && comment.value.startsWith("*")
      ? comment
      : undefined;
  }
  return undefined;
}

/** Normalize simple inflections so identifier and prose tokens compare fairly. */
function normalizeWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length > 4 && lower.endsWith("ies")) {
    return `${lower.slice(0, -3)}y`;
  }
  if (
    lower.length > 3 && lower.endsWith("s") &&
    !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is")
  ) {
    return lower.slice(0, -1);
  }
  return lower;
}

/** Split prose or a spaced identifier into normalized searchable words. */
function words(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).map(normalizeWord);
}

/** Split a camel-, Pascal-, snake-, or kebab-cased identifier into words. */
function identifierWords(name: string): Set<string> {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return new Set(words(spaced));
}

/** Extract prose before the first JSDoc tag from an attached block. */
function jsdocSummary(comment: Deno.lint.BlockComment): string {
  const lines = comment.value.replace(/^\*/, "").split("\n").map((line) =>
    line.replace(/^\s*\*\s?/, "").trim()
  );
  const firstTag = lines.findIndex((line) => line.startsWith("@"));
  return lines.slice(0, firstTag === -1 ? undefined : firstTag).join(" ");
}

/** Whether the summary contains a concrete term not recoverable from the name. */
function addsInformationBeyondName(
  comment: Deno.lint.BlockComment,
  name: string,
): boolean {
  const nameWords = identifierWords(name);
  return words(jsdocSummary(comment)).some((word) =>
    !GENERIC_DOCUMENTATION_WORDS.has(word) && !nameWords.has(word)
  );
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
            const name = node.id?.name ?? "default export";
            const docblock = functionDocblock(context, node);
            if (docblock === undefined) {
              context.report({
                node,
                message:
                  `Function '${name}' must have a JSDoc block immediately above its declaration.`,
              });
              return;
            }
            if (addsInformationBeyondName(docblock, name)) return;
            context.report({
              node,
              message:
                `Function '${name}' has JSDoc that only paraphrases its name. Describe its behavior, contract, or reason for existing.`,
            });
          },
        };
      },
    },
  },
};

export default plugin;
