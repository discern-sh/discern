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
 * `ls-files -z`, `ls-tree -z --name-only`). Records are verbatim paths:
 * no trimming, no unquoting.
 */
export function splitNulRecords(stdout: string): string[] {
  return stdout.split("\0").filter((r) => r !== "");
}

/** Git's directory suffix is record metadata; it is never an empty filename component. */
export function gitPathRecord(
  label: string,
): { kind: "file" | "directory"; path: string } {
  return label.endsWith("/")
    ? { kind: "directory", path: label.slice(0, -1) }
    : { kind: "file", path: label };
}

/** One `git check-attr --stdin -z <attribute>` output triple. */
export interface GitAttributeRecord {
  readonly path: string;
  readonly attribute: string;
  readonly value: string;
}

/**
 * Parse Git's NUL-delimited attribute protocol without trimming path bytes.
 * Unlike a single-field listing, the value field is allowed to be empty, so
 * this decoder validates the trailing terminator and consumes exact triples.
 */
export function parseCheckAttrZ(
  stdout: string,
): GitAttributeRecord[] | undefined {
  const fields = stdout.split("\0");
  if (fields.at(-1) !== "") return undefined;
  fields.pop();
  if (fields.length % 3 !== 0) return undefined;
  const records: GitAttributeRecord[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index];
    const attribute = fields[index + 1];
    const value = fields[index + 2];
    if (
      path === undefined || path === "" || attribute === undefined ||
      attribute === "" || value === undefined
    ) {
      return undefined;
    }
    records.push({ path, attribute, value });
  }
  return records;
}

/** One effective `git config --null --show-origin --show-scope --get` record. */
export interface ScopedGitConfigValue {
  readonly scope: string;
  readonly origin: string;
  readonly value: string;
}

/** Parse the exact three-field effective-config protocol used by doctor. */
export function parseScopedGitConfigValueZ(
  stdout: string,
): ScopedGitConfigValue | undefined {
  const fields = stdout.split("\0");
  if (fields.length !== 4 || fields[3] !== "") return undefined;
  const scope = fields[0];
  const origin = fields[1];
  const value = fields[2];
  if (
    scope === undefined || scope === "" || origin === undefined ||
    origin === "" || value === undefined
  ) {
    return undefined;
  }
  return { scope, origin, value };
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
