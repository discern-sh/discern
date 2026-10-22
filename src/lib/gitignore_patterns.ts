/**
 * Git's ignore-pattern semantics for one root `.gitignore`, without a Git process.
 *
 * discern's managed block re-includes the integration files a project's own root
 * rules would otherwise exclude. The exceptions must follow from tracked content
 * alone, so every checkout renders the same block, and they are recomputed while
 * refresh is planned, inside `status` and the gate. That rules out asking Git: Git
 * would also apply this machine's global and clone-local excludes, and spawn a
 * process per plan. This module answers the narrower question purely, following
 * gitignore(5) with case-sensitive matching: which pattern, if any, excludes a
 * path. `tests/gitignore_patterns_test.ts` holds it to Git's own `check-ignore`.
 */

/** One parsed pattern from a root `.gitignore`. */
export interface IgnorePattern {
  /** The line as written, for diagnostics. */
  readonly text: string;
  /** 1-based line number in the file. */
  readonly line: number;
  readonly negated: boolean;
  readonly dirOnly: boolean;
  /** A pattern with a slash before its end matches from the root; one without
   * matches a basename at any depth. */
  readonly anchored: boolean;
  readonly regex: RegExp;
}

/** What excludes a path: the deciding pattern, and the excluded directory when
 * an ancestor's exclusion is the cause. */
export interface IgnoreVerdict {
  readonly pattern: IgnorePattern;
  readonly excludedDirectory?: string | undefined;
}

/**
 * Parse `.gitignore` lines into patterns, skipping blanks, comments, and any
 * pattern this matcher cannot translate (POSIX character classes). Skipping
 * can only make discern add fewer exceptions, never hide a file.
 */
export function parseIgnorePatterns(
  lines: readonly string[],
): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];
  for (const [index, raw] of lines.entries()) {
    const pattern = parseIgnorePattern(raw, index + 1);
    if (pattern !== undefined) patterns.push(pattern);
  }
  return patterns;
}

/** Parse one line, or `undefined` for a blank, a comment, or untranslatable syntax. */
function parseIgnorePattern(
  raw: string,
  line: number,
): IgnorePattern | undefined {
  let body = trimUnescapedTrailingSpaces(raw.replace(/\r$/u, ""));
  if (body === "" || body.startsWith("#")) return undefined;
  const negated = body.startsWith("!");
  if (negated) body = body.slice(1);
  if (body.startsWith("\\!") || body.startsWith("\\#")) body = body.slice(1);
  const dirOnly = body.endsWith("/") && !body.endsWith("\\/");
  if (dirOnly) body = body.replace(/\/+$/u, "");
  const anchored = body.includes("/");
  body = body.replace(/^\/+/u, "");
  if (body === "") return undefined;
  const source = wildmatchSource(body);
  if (source === undefined) return undefined;
  return {
    text: raw.trim(),
    line,
    negated,
    dirOnly,
    anchored,
    regex: new RegExp(`^${source}$`, "u"),
  };
}

/** Drop trailing spaces Git ignores, keeping one escaped with a backslash. */
function trimUnescapedTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === " " && line[end - 2] !== "\\") end--;
  return line.slice(0, end);
}

/** Translate wildmatch syntax into a regular-expression source. */
function wildmatchSource(glob: string): string | undefined {
  let out = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index] ?? "";
    if (char === "\\") {
      index++;
      out += escapeRegex(glob[index] ?? "\\");
    } else if (char === "*") {
      const run = /^\*+/u.exec(glob.slice(index))?.[0].length ?? 1;
      const before = index === 0 || glob[index - 1] === "/";
      const after = index + run === glob.length || glob[index + run] === "/";
      if (run >= 2 && before && after) {
        if (index + run === glob.length) {
          // Trailing `/**` (or a whole-pattern `**`): everything inside.
          out += ".*";
        } else {
          // `**/` leading or between slashes: zero or more directories.
          out += "(?:.*/)?";
          index++;
        }
      } else {
        out += "[^/]*";
      }
      index += run - 1;
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const close = classEnd(glob, index);
      if (close === undefined) {
        out += "\\[";
        continue;
      }
      const inner = glob.slice(index + 1, close);
      if (inner.includes("[:")) return undefined;
      const negate = inner.startsWith("!") || inner.startsWith("^");
      const members = (negate ? inner.slice(1) : inner).replace(
        /[\\\]^]/gu,
        (special) => `\\${special}`,
      );
      out += `[${negate ? "^/" : ""}${members}]`;
      index = close;
    } else {
      out += escapeRegex(char);
    }
  }
  return out;
}

/** The index closing a bracket expression that opens at `open`, if any. */
function classEnd(glob: string, open: number): number | undefined {
  let index = open + 1;
  if (glob[index] === "!" || glob[index] === "^") index++;
  if (glob[index] === "]") index++;
  const close = glob.indexOf("]", index);
  return close === -1 ? undefined : close;
}

/** Escape one literal character for a regular expression. */
function escapeRegex(char: string): string {
  return /[.*+?^${}()|[\]\\/]/u.test(char) ? `\\${char}` : char;
}

/** The last pattern matching `path`, or `undefined`. */
function lastMatch(
  patterns: readonly IgnorePattern[],
  path: string,
  isDirectory: boolean,
): IgnorePattern | undefined {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  let decided: IgnorePattern | undefined;
  for (const pattern of patterns) {
    if (pattern.dirOnly && !isDirectory) continue;
    if (pattern.regex.test(pattern.anchored ? path : basename)) {
      decided = pattern;
    }
  }
  return decided;
}

/**
 * Whether `patterns` exclude the file `path`, and why. Git never looks inside an
 * excluded directory, so an excluded ancestor decides before the file's own
 * patterns, and no later negation of the file can re-include it.
 */
export function ignoreVerdict(
  patterns: readonly IgnorePattern[],
  path: string,
): IgnoreVerdict | undefined {
  const parts = path.split("/");
  for (let depth = 1; depth < parts.length; depth++) {
    const directory = parts.slice(0, depth).join("/");
    const decided = lastMatch(patterns, directory, true);
    if (decided !== undefined && !decided.negated) {
      return { pattern: decided, excludedDirectory: directory };
    }
  }
  const decided = lastMatch(patterns, path, false);
  return decided !== undefined && !decided.negated
    ? { pattern: decided }
    : undefined;
}

/**
 * The fewest rules that, appended after `lines`, re-include every one of `paths`
 * while everything else the rules excluded stays excluded. An excluded folder is
 * re-included, then its contents are excluded again, so only the named files come
 * back. Paths the rules already admit need nothing.
 */
export function reincludingRules(
  lines: readonly string[],
  paths: readonly string[],
): string[] {
  const rules: string[] = [];
  const patterns = parseIgnorePatterns(lines);
  const add = (rule: string): void => {
    if (rules.includes(rule)) return;
    rules.push(rule);
    const parsed = parseIgnorePattern(rule, lines.length + rules.length);
    if (parsed !== undefined) patterns.push(parsed);
  };
  for (const path of paths) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join("/");
      const decided = lastMatch(patterns, directory, true);
      if (decided !== undefined && !decided.negated) {
        add(`!/${literalRule(directory)}/`);
        add(`/${literalRule(directory)}/*`);
      }
    }
    if (ignoreVerdict(patterns, path) !== undefined) {
      add(`!/${literalRule(path)}`);
    }
  }
  return rules;
}

/** Escape a literal path so Git reads none of its characters as glob syntax. */
function literalRule(path: string): string {
  return path.replace(/[*?[\\]/gu, (special) => `\\${special}`).replace(
    /^([#!])/u,
    "\\$1",
  );
}
