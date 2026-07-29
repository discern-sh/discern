/**
 * YAML-style depth indentation for `discern.toml` — the second half of the
 * canonical convention `formatTomlText` applies. The embedded formatter
 * normalizes structure and flattens every line to column 0; this pass then
 * re-indents by table depth so the long, comment-dense config reads as the
 * hierarchy it is:
 *
 *     [worktree]
 *       app = "sh scripts/dev.sh"
 *
 *       [worktree.resources.db]
 *         per = "worktree"
 *
 * TOML gives leading whitespace no meaning, so the pass is purely visual: the
 * document parses identically before and after (the tests hold parse-equality
 * over every fixture). The rules:
 *
 *   - a `[header]` (or `[[header]]`) is indented one step per dotted level
 *     above the root; the entries below it sit one step deeper again.
 *   - a full-line comment takes the indent of the next structural line, so a
 *     paragraph documenting a section sits at that section's level.
 *   - a multi-line string's interior is string CONTENT — copied verbatim.
 *   - a multi-line value's continuation lines derive their indent from bracket
 *     depth, not from the whitespace they arrived with — which is what makes
 *     the pass idempotent on its own output, with or without the embedded
 *     formatter in front of it.
 */

type StringMode = "none" | "ml-basic" | "ml-literal";

/**
 * Tracks the only two pieces of cross-line TOML state that change what a line
 * IS: whether we are inside a multi-line string, and how many value brackets
 * (`[` arrays, `{` inline tables) are open. Quotes, escapes, and comments are
 * consumed within each line so brackets inside them never count.
 */
class LineScanner {
  mode: StringMode = "none";
  valueDepth = 0;

  scan(line: string): void {
    let i = 0;
    while (i < line.length) {
      if (this.mode === "ml-basic") {
        const ch = line[i];
        if (ch === "\\") {
          i += 2; // an escaped char (or a line-continuation backslash at EOL)
          continue;
        }
        if (ch === '"') {
          const q = quoteRun(line, i, '"');
          // With three or more quotes the LAST three close the string and the
          // leading q-3 are content, so the whole run is consumed either way.
          if (q >= 3) {
            this.mode = "none";
          }
          i += q;
          continue;
        }
        i++;
        continue;
      }
      if (this.mode === "ml-literal") {
        if (line[i] === "'") {
          const q = quoteRun(line, i, "'");
          if (q >= 3) {
            this.mode = "none";
          }
          i += q;
          continue;
        }
        i++;
        continue;
      }
      const ch = line[i];
      if (ch === "#") {
        return; // comment to end of line
      }
      if (ch === '"') {
        const q = quoteRun(line, i, '"');
        if (q >= 3) {
          this.mode = "ml-basic";
          i += 3; // the rest of the run is string content
          continue;
        }
        if (q === 2) {
          i += 2; // empty single-line string
          continue;
        }
        i = skipBasicString(line, i + 1);
        continue;
      }
      if (ch === "'") {
        const q = quoteRun(line, i, "'");
        if (q >= 3) {
          this.mode = "ml-literal";
          i += 3;
          continue;
        }
        if (q === 2) {
          i += 2;
          continue;
        }
        i = skipLiteralString(line, i + 1);
        continue;
      }
      if (ch === "[" || ch === "{") {
        this.valueDepth++;
      } else if (ch === "]" || ch === "}") {
        this.valueDepth = Math.max(0, this.valueDepth - 1);
      }
      i++;
    }
  }
}

/** Length of the run of `quote` characters starting at `line[i]`. */
function quoteRun(line: string, i: number, quote: '"' | "'"): number {
  let q = 0;
  while (line[i + q] === quote) {
    q++;
  }
  return q;
}

/** Index just past a single-line basic string opened before `i` (escape-aware). */
function skipBasicString(line: string, i: number): number {
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    i++;
    if (ch === '"') {
      return i;
    }
  }
  return i;
}

/** Index just past a single-line literal string opened before `i`. */
function skipLiteralString(line: string, i: number): number {
  while (i < line.length && line[i] !== "'") {
    i++;
  }
  return i < line.length ? i + 1 : i;
}

/**
 * A header's depth: dotted levels above the root (`[jobs]` → 0, `[jobs.fix]` →
 * 1). Dots inside quoted key segments are key content, not levels.
 */
function headerDepth(trimmed: string): number {
  let i = trimmed.startsWith("[[") ? 2 : 1;
  let dots = 0;
  let quote: '"' | "'" | null = null;
  for (; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote !== null) {
      if (quote === '"' && ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "]") {
      break;
    } else if (ch === ".") {
      dots++;
    }
  }
  return dots;
}

type LineShape =
  | { kind: "verbatim" } // multi-line string interior, incl. its closing line
  | { kind: "blank" }
  | { kind: "structural"; indent: number } // header, entry, or continuation
  | { kind: "comment"; fallback: number };

/**
 * Re-indent TOML text by table depth. `text` follows the document-wide LF
 * convention the embedded formatter emits; `indentWidth` is one depth step.
 */
export function indentToml(text: string, indentWidth = 2): string {
  const lines = text.split("\n");
  const scanner = new LineScanner();
  const shapes: LineShape[] = [];
  let bodyIndent = 0;

  for (const line of lines) {
    const startMode = scanner.mode;
    const startDepth = scanner.valueDepth;
    scanner.scan(line);
    if (startMode !== "none") {
      shapes.push({ kind: "verbatim" });
      continue;
    }
    const trimmed = line.trim();
    if (startDepth > 0) {
      // Continuation of a multi-line value: nest by bracket depth, closers one
      // step back so `]` aligns with the line that opened it.
      const closer = trimmed.startsWith("]") || trimmed.startsWith("}");
      const relative = (startDepth - (closer ? 1 : 0)) * indentWidth;
      shapes.push({ kind: "structural", indent: bodyIndent + relative });
      continue;
    }
    if (trimmed === "") {
      shapes.push({ kind: "blank" });
      continue;
    }
    if (trimmed.startsWith("#")) {
      shapes.push({ kind: "comment", fallback: bodyIndent });
      continue;
    }
    if (trimmed.startsWith("[")) {
      const depth = headerDepth(trimmed);
      shapes.push({ kind: "structural", indent: depth * indentWidth });
      bodyIndent = (depth + 1) * indentWidth;
      continue;
    }
    shapes.push({ kind: "structural", indent: bodyIndent });
  }

  return lines
    .map((line, i) => {
      const shape = shapes[i];
      if (shape === undefined || shape.kind === "verbatim") {
        return line;
      }
      if (shape.kind === "blank") {
        return "";
      }
      const indent = shape.kind === "structural"
        ? shape.indent
        : nextStructuralIndent(shapes, i) ?? shape.fallback;
      return " ".repeat(indent) + line.trimStart();
    })
    .join("\n");
}

/** The indent of the first structural line after `i`, skipping blanks and
 * other comments — so a comment paragraph sits level with what it documents. */
function nextStructuralIndent(
  shapes: readonly LineShape[],
  i: number,
): number | undefined {
  for (let j = i + 1; j < shapes.length; j++) {
    const shape = shapes[j];
    if (shape === undefined) {
      return undefined;
    }
    if (shape.kind === "structural") {
      return shape.indent;
    }
    if (shape.kind !== "blank" && shape.kind !== "comment") {
      return undefined;
    }
  }
  return undefined;
}
