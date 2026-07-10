/**
 * NUL-separated git path decoding — the ONE place git's file-listing output is
 * parsed. Line-oriented git output C-quotes any "unusual" path (non-ASCII
 * bytes under the default `core.quotePath`, plus double quotes, backslashes,
 * and control characters always), and a C-quoted path matches no scope
 * pattern, stats no file, and compares equal to nothing. So every invocation
 * that lists tracked paths passes `-z` and decodes through these helpers;
 * `tests/git_path_quoting_test.ts` enforces the flag at every call site.
 */

/**
 * Split `-z` (NUL-separated) git output into its records, dropping empties —
 * the decoder for single-field listings (`diff --name-only -z`,
 * `ls-files -z`). Records are verbatim paths: no trimming, no unquoting.
 */
export function splitNulRecords(stdout: string): string[] {
  return stdout.split("\0").filter((r) => r !== "");
}

/** One `git status --porcelain=v1 -z` entry. */
export interface PorcelainEntry {
  /** The two-character `XY` status code (e.g. `" M"`, `"??"`, `"R "`). */
  status: string;
  /** The working-tree path — for a rename/copy, the NEW (target) path. */
  path: string;
  /** The origin path of a rename/copy entry, when git reports one. */
  origPath?: string;
}

/**
 * Parse `git status --porcelain=v1 -z` output. Each record is `XY <path>`;
 * a rename/copy record (`R`/`C` in either status column) is followed by ONE
 * extra NUL-terminated field, the origin path — consumed here so it can never
 * masquerade as a separate entry.
 */
export function parsePorcelainZ(stdout: string): PorcelainEntry[] {
  const tokens = stdout.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token === "") {
      continue;
    }
    const status = token.slice(0, 2);
    const path = token.slice(3);
    let origPath: string | undefined;
    if (/[RC]/.test(status)) {
      i++; // the next field is the rename/copy origin, not an entry
      origPath = tokens[i];
    }
    if (path === "") {
      continue; // malformed record — never emit an empty path
    }
    entries.push(
      origPath !== undefined && origPath !== ""
        ? { status, path, origPath }
        : { status, path },
    );
  }
  return entries;
}
