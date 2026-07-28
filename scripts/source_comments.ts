/**
 * Comment extraction for authored JavaScript and TypeScript source.
 *
 * Repo-wide comment checks share this lexer so comment-looking text inside
 * strings, template bodies, regular expressions, and block comments does not
 * become a false line-comment finding. Template expressions re-enter code
 * state, including nested templates, so comments inside `${...}` stay visible.
 */

/** One JavaScript/TypeScript comment, with delimiters removed. */
export interface SourceComment {
  /** The comment syntax Deno parsed. */
  kind: "line" | "block";
  /** 1-based line on which the comment begins. */
  startLine: number;
  /** Physical comment lines, with delimiters removed. */
  lines: string[];
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/**
 * Whether a slash sits where JavaScript permits a regular-expression literal.
 * This lexical distinction keeps `//` and backticks inside a regex from
 * changing the surrounding comment scan.
 */
function startsRegexLiteral(src: string, slash: number): boolean {
  let i = slash - 1;
  while (i >= 0 && /\s/.test(src[i] ?? "")) i--;
  if (i < 0) return true;
  const previous = src[i] ?? "";
  if ("([{:;,=!?&|+-*%^~".includes(previous)) return true;
  if (previous === ">" && src[i - 1] === "=") return true;
  if (!/[A-Za-z0-9_$]/.test(previous)) return false;
  let start = i;
  while (start > 0 && /[A-Za-z0-9_$]/.test(src[start - 1] ?? "")) start--;
  return REGEX_PREFIX_KEYWORDS.has(src.slice(start, i + 1));
}

/**
 * Extract line and block comments from JavaScript or TypeScript source.
 *
 * Consecutive `//` lines form one unit so checks that read prose can match
 * across a wrapped line. Each physical line remains separate for checks whose
 * directives are line-scoped.
 */
export function extractSourceComments(src: string): SourceComment[] {
  const out: SourceComment[] = [];
  let i = 0;
  let line = 1;
  let startLine = 1;
  let lines: string[] = [];
  let buf = "";
  const templateExpressionDepths: number[] = [];
  const n = src.length;
  type State =
    | "code"
    | "line"
    | "block"
    | "single"
    | "double"
    | "template"
    | "regex"
    | "regex-class";
  let state: State = "code";

  const pushLine = (): void => {
    lines.push(buf);
    buf = "";
  };
  const emit = (kind: SourceComment["kind"]): void => {
    if (lines.some((value) => value.trim().length > 0)) {
      out.push({ kind, startLine, lines });
    }
    lines = [];
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") {
        state = "line";
        startLine = line;
        buf = "";
        lines = [];
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        state = "block";
        startLine = line;
        buf = "";
        lines = [];
        i += 2;
        continue;
      }
      if (c === "/" && startsRegexLiteral(src, i)) {
        state = "regex";
        i++;
        continue;
      }
      if (c === '"') {
        state = "double";
        i++;
        continue;
      }
      if (c === "'") {
        state = "single";
        i++;
        continue;
      }
      if (c === "`") {
        state = "template";
        i++;
        continue;
      }
      if (c === "{") {
        const depth = templateExpressionDepths.at(-1);
        if (depth !== undefined) {
          templateExpressionDepths[templateExpressionDepths.length - 1] =
            depth + 1;
        }
        i++;
        continue;
      }
      if (c === "}") {
        const depth = templateExpressionDepths.at(-1);
        if (depth === 1) {
          templateExpressionDepths.pop();
          state = "template";
        } else if (depth !== undefined) {
          templateExpressionDepths[templateExpressionDepths.length - 1] =
            depth - 1;
        }
        i++;
        continue;
      }
      if (c === "\n") line++;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        pushLine();
        line++;
        // Coalesce a run of consecutive line comments into one prose unit.
        let j = i + 1;
        while (j < n && (src[j] === " " || src[j] === "\t")) j++;
        if (src[j] === "/" && src[j + 1] === "/") {
          i = j + 2;
          continue;
        }
        emit("line");
        state = "code";
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        pushLine();
        emit("block");
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") {
        pushLine();
        line++;
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (state === "template") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        state = "code";
        i++;
        continue;
      }
      if (c === "$" && d === "{") {
        templateExpressionDepths.push(1);
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") line++;
      i++;
      continue;
    }

    // Quoted and regex literals consume escapes before their delimiters.
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (state === "regex") {
      if (c === "[") state = "regex-class";
      if (c === "/") state = "code";
      if (c === "\n") {
        state = "code";
        line++;
      }
      i++;
      continue;
    }
    if (state === "regex-class") {
      if (c === "]") state = "regex";
      if (c === "\n") {
        state = "code";
        line++;
      }
      i++;
      continue;
    }
    if (state === "double" && c === '"') {
      state = "code";
      i++;
      continue;
    }
    if (state === "single" && c === "'") {
      state = "code";
      i++;
      continue;
    }
    if (c === "\n") line++;
    i++;
  }

  if (state === "line") {
    pushLine();
    emit("line");
  } else if (state === "block") {
    pushLine();
    emit("block");
  }
  return out;
}
