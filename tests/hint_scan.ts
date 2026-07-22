/**
 * Shared scanners for the hint-registry guards. Like `vocab_scan.ts`, this is a
 * small TypeScript-aware lexer rather than a prose grep: comments and regexes are
 * skipped, literals retain their source line, and delimiter parents let the guard
 * distinguish a literal placed directly in `hints[]` from a registry id nested in
 * `fire(HINTS[...])`.
 */

type TokenKind = "identifier" | "string" | "punct";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly line: number;
  /** Token index of the syntactic delimiter containing this token. */
  readonly parent: number | undefined;
}

export interface InlineHintLiteral {
  readonly text: string;
  readonly line: number;
  readonly sink: "hints[]" | "FiredHint";
}

const REGEX_PREFIX_PUNCTUATION = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const REGEX_PREFIX_KEYWORDS = new Set([
  "case",
  "delete",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/** Tokenize enough TypeScript structure to classify the two prohibited sinks. */
function tokensOf(source: string): Token[] {
  const tokens: Token[] = [];
  const delimiters: number[] = [];
  let i = 0;
  let line = 1;

  const parent = (): number | undefined => delimiters.at(-1);
  const step = (): void => {
    if (source.charAt(i) === "\n") line++;
    i++;
  };
  const skipLineComment = (): void => {
    while (i < source.length && source.charAt(i) !== "\n") step();
  };
  const skipBlockComment = (): void => {
    step();
    step();
    while (
      i < source.length &&
      !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")
    ) step();
    if (i < source.length) {
      step();
      step();
    }
  };

  const skipQuoted = (quote: string): void => {
    step();
    while (i < source.length) {
      const ch = source.charAt(i);
      if (ch === "\\") {
        step();
        if (i < source.length) step();
        continue;
      }
      step();
      if (ch === quote) return;
      if (ch === "\n" && quote !== "`") return;
    }
  };

  const skipTemplate = (): void => {
    step();
    while (i < source.length) {
      const ch = source.charAt(i);
      if (ch === "\\") {
        step();
        if (i < source.length) step();
        continue;
      }
      if (ch === "`") {
        step();
        return;
      }
      if (ch === "$" && source.charAt(i + 1) === "{") {
        step();
        step();
        let depth = 1;
        while (i < source.length && depth > 0) {
          const inner = source.charAt(i);
          if (inner === "/" && source.charAt(i + 1) === "/") {
            skipLineComment();
            continue;
          }
          if (inner === "/" && source.charAt(i + 1) === "*") {
            skipBlockComment();
            continue;
          }
          if (inner === "'" || inner === '"') {
            skipQuoted(inner);
            continue;
          }
          if (inner === "`") {
            skipTemplate();
            continue;
          }
          if (inner === "{") depth++;
          if (inner === "}") depth--;
          step();
        }
        continue;
      }
      step();
    }
  };

  const regexPosition = (): boolean => {
    const previous = tokens.at(-1);
    if (previous === undefined) return true;
    if (previous.kind === "punct") {
      return REGEX_PREFIX_PUNCTUATION.has(previous.text);
    }
    return previous.kind === "identifier" &&
      REGEX_PREFIX_KEYWORDS.has(previous.text);
  };
  const skipRegex = (): void => {
    step();
    let inClass = false;
    while (i < source.length) {
      const ch = source.charAt(i);
      if (ch === "\\") {
        step();
        if (i < source.length) step();
        continue;
      }
      if (ch === "[") inClass = true;
      if (ch === "]") inClass = false;
      if (ch === "/" && !inClass) {
        step();
        while (/[a-z]/iu.test(source.charAt(i))) step();
        return;
      }
      if (ch === "\n") return;
      step();
    }
  };

  while (i < source.length) {
    const ch = source.charAt(i);
    if (/\s/u.test(ch)) {
      step();
      continue;
    }
    if (ch === "/" && source.charAt(i + 1) === "/") {
      skipLineComment();
      continue;
    }
    if (ch === "/" && source.charAt(i + 1) === "*") {
      skipBlockComment();
      continue;
    }
    if (ch === "/" && regexPosition()) {
      skipRegex();
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const start = i;
      const startLine = line;
      const container = parent();
      if (ch === "`") skipTemplate();
      else skipQuoted(ch);
      const end = i;
      tokens.push({
        kind: "string",
        text: source.slice(start + 1, Math.max(start + 1, end - 1)),
        line: startLine,
        parent: container,
      });
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch)) {
      const start = i;
      const startLine = line;
      while (/[A-Za-z0-9_$]/u.test(source.charAt(i))) step();
      tokens.push({
        kind: "identifier",
        text: source.slice(start, i),
        line: startLine,
        parent: parent(),
      });
      continue;
    }

    if (ch === ")" || ch === "]" || ch === "}") delimiters.pop();
    const index = tokens.length;
    tokens.push({ kind: "punct", text: ch, line, parent: parent() });
    step();
    if (ch === "(" || ch === "[" || ch === "{") delimiters.push(index);
  }
  return tokens;
}

function previousDirect(
  tokens: readonly Token[],
  before: number,
  parent: number | undefined,
): number | undefined {
  for (let i = before - 1; i >= 0; i--) {
    if (tokens[i]?.parent === parent) return i;
  }
  return undefined;
}

function propertyBefore(
  tokens: readonly Token[],
  valueIndex: number,
  parent: number | undefined,
): string | undefined {
  const colon = previousDirect(tokens, valueIndex, parent);
  if (colon === undefined || tokens[colon]?.text !== ":") return undefined;
  const name = previousDirect(tokens, colon, parent);
  const token = name === undefined ? undefined : tokens[name];
  return token?.kind === "identifier" ? token.text : undefined;
}

function assignmentTargetsHints(
  tokens: readonly Token[],
  operator: number,
  parent: number | undefined,
): boolean {
  const direct: number[] = [];
  for (let i = operator - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined || token.parent !== parent) continue;
    if (token.text === ";" || token.text === ",") break;
    direct.push(i);
  }
  direct.reverse();
  const declaration = direct.findIndex((i) =>
    ["const", "let", "var"].includes(tokens[i]?.text ?? "")
  );
  if (declaration >= 0) {
    const name = direct.slice(declaration + 1)
      .map((i) => tokens[i])
      .find((token) => token?.kind === "identifier");
    if (name?.text === "hints") return true;
  }
  const last = direct.at(-1);
  return last !== undefined && tokens[last]?.text === "hints";
}

function arrayTargetsHints(
  tokens: readonly Token[],
  open: number,
): boolean {
  const container = tokens[open]?.parent;
  for (let i = open - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined || token.parent !== container) continue;
    if (token.text === ";" || token.text === ",") return false;
    if (token.text === ":") {
      const name = previousDirect(tokens, i, container);
      if (name !== undefined && tokens[name]?.text === "hints") return true;
    }
    if (token.text === "=" && assignmentTargetsHints(tokens, i, container)) {
      return true;
    }
  }
  return false;
}

function callPushesHints(
  tokens: readonly Token[],
  open: number,
): boolean {
  const container = tokens[open]?.parent;
  const method = previousDirect(tokens, open, container);
  if (method === undefined || tokens[method]?.text !== "push") return false;
  const dot = previousDirect(tokens, method, container);
  if (dot === undefined || tokens[dot]?.text !== ".") return false;
  const receiver = previousDirect(tokens, dot, container);
  return receiver !== undefined && tokens[receiver]?.text === "hints";
}

function objectHasFiredHintFields(
  tokens: readonly Token[],
  open: number,
): boolean {
  const names = new Set<string>();
  for (let i = open + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.parent !== open || token.kind !== "identifier") continue;
    const colon = tokens[i + 1];
    if (colon?.parent === open && colon.text === ":") names.add(token.text);
  }
  return names.has("id") && names.has("text");
}

/** Find direct string literals at either registry-only construction boundary. */
export function inlineHintLiterals(source: string): InlineHintLiteral[] {
  const tokens = tokensOf(source);
  const findings: InlineHintLiteral[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.kind !== "string") continue;
    const parentIndex = token.parent;
    const parent = parentIndex === undefined ? undefined : tokens[parentIndex];

    let hintSink = false;
    if (
      parentIndex !== undefined && parent?.text === "[" &&
      arrayTargetsHints(tokens, parentIndex)
    ) {
      hintSink = true;
    } else if (
      parentIndex !== undefined && parent?.text === "(" &&
      callPushesHints(tokens, parentIndex)
    ) {
      hintSink = true;
    } else if (propertyBefore(tokens, i, parentIndex) === "hints") {
      hintSink = true;
    } else {
      const operator = previousDirect(tokens, i, parentIndex);
      if (
        operator !== undefined && tokens[operator]?.text === "=" &&
        assignmentTargetsHints(tokens, operator, parentIndex)
      ) {
        hintSink = true;
      }
    }
    if (hintSink) {
      findings.push({ text: token.text, line: token.line, sink: "hints[]" });
      continue;
    }

    if (
      parentIndex !== undefined && parent?.text === "{" &&
      objectHasFiredHintFields(tokens, parentIndex) &&
      ["id", "text"].includes(propertyBefore(tokens, i, parentIndex) ?? "")
    ) {
      findings.push({ text: token.text, line: token.line, sink: "FiredHint" });
    }
  }
  return findings;
}
