/** Project-relative path resolution for reads and writes with different risk. */

import { basename, isAbsolute, join, relative } from "@std/path";
import { bestEffortFs, lstatIfExists } from "./fs_presence.ts";

const INVALID_PORTABLE_PUNCTUATION = /[<>:"\\|?*]/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const WINDOWS_RESERVED_SEGMENT_PATTERN =
  "(?:[cC][oO][nN]|[pP][rR][nN]|[aA][uU][xX]|[nN][uU][lL]|" +
  "[cC][oO][mM][1-9]|[lL][pP][tT][1-9])";
const PORTABLE_SEGMENT_PATTERN =
  String.raw`(?!(?:\.{1,2}|\.[gG][iI][tT])(?:/|$))` +
  `(?!(?:${WINDOWS_RESERVED_SEGMENT_PATTERN})(?:\\.|/|$))` +
  String.raw`[^<>:"\\|?*\u0000-\u001F/]*` +
  String.raw`[^<>:"\\|?*\u0000-\u001F/. ]`;
const HARMLESS_LEADING_DOT_PREFIXES = String.raw`(?:\./)*`;

/** Raw config spelling for a portable project-relative file path. Leading `./`
 * prefixes are accepted because config parsing removes them before use. */
export const PROJECT_RELATIVE_FILE_INPUT_RE = new RegExp(
  `^(?!.*\\s$)${HARMLESS_LEADING_DOT_PREFIXES}` +
    `(?![~\\s])${PORTABLE_SEGMENT_PATTERN}` +
    `(?:/${PORTABLE_SEGMENT_PATTERN})*$`,
);

/** Raw config spelling for a portable project-relative directory path. It adds
 * one optional trailing slash to the file-path input spellings. */
export const PROJECT_RELATIVE_DIRECTORY_INPUT_RE = new RegExp(
  `^(?!.*\\s/?$)${HARMLESS_LEADING_DOT_PREFIXES}` +
    `(?![~\\s])${PORTABLE_SEGMENT_PATTERN}` +
    `(?:/${PORTABLE_SEGMENT_PATTERN})*/?$`,
);

/** Remove every harmless leading `./` prefix from a configured file path. */
export function normalizeProjectRelativeFilePath(value: string): string {
  return value.replace(/^(?:\.\/)+/, "");
}

/** Canonicalize a configured directory path without erasing unsafe interior
 * spellings: remove leading `./` prefixes and at most one trailing slash. */
export function normalizeProjectRelativeDirectoryPath(value: string): string {
  return normalizeProjectRelativeFilePath(value).replace(/\/$/, "");
}

/** Why one path is not a canonical portable project-relative path. */
export function projectRelativePathIssue(value: string): string | undefined {
  if (value === "") return "the path is empty";
  if (value.trim() !== value) {
    return "leading or trailing whitespace is not canonical";
  }
  if (
    value.startsWith("/") || /^[A-Za-z]:/.test(value) ||
    value.startsWith("~")
  ) {
    return "the path must be relative to the project";
  }
  if (value.includes("\\")) return "use forward slashes";
  if (value !== value.normalize("NFC")) {
    return "use Unicode NFC normalization";
  }
  if (
    INVALID_PORTABLE_PUNCTUATION.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 0x20)
  ) {
    return "the path contains a character that is not portable";
  }

  const segments = value.split("/");
  if (
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    return "empty, dot, and parent-directory segments are not canonical";
  }
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    return "Git administration files are outside this path boundary";
  }
  for (const segment of segments) {
    if (
      segment.endsWith(".") || segment.endsWith(" ") ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      return `the path segment ${JSON.stringify(segment)} is not portable`;
    }
  }
  return undefined;
}

/** Refuse a non-canonical project-relative path with a caller-specific label. */
export function assertProjectRelativePath(
  value: string,
  label: string,
): void {
  const issue = projectRelativePathIssue(value);
  if (issue !== undefined) {
    throw new Error(
      `invalid ${label} path ${JSON.stringify(value)}: ${issue}`,
    );
  }
}

/** Whether `candidate` resolves inside `root` (or is `root` itself). */
function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return !(
    isAbsolute(rel) || rel === ".." || rel.split(/[\\/]/).at(0) === ".."
  );
}

/**
 * Resolve one existing path below `root` for a tolerant read. Existing symbolic
 * links may participate when their final target remains inside the project.
 * Missing, unreadable, stale, or escaping paths return undefined.
 */
export async function resolveContainedProjectReadPath(
  root: string,
  value: string,
): Promise<string | undefined> {
  if (projectRelativePathIssue(value) !== undefined) {
    return undefined;
  }
  return await bestEffortFs(async () => {
    const realRoot = await Deno.realPath(root);
    const resolved = await Deno.realPath(join(realRoot, value));
    return isContained(realRoot, resolved) ? resolved : undefined;
  }, {
    onFailure: undefined,
    reason:
      "A missing, stale, unreadable, or escaping optional read path is not safe to consume.",
  });
}

/**
 * Resolve one canonical write path below `root`, refusing every existing
 * symbolic-link component. Refusing even an in-project link keeps the declared
 * path identical to the file the write reaches.
 */
export async function resolveContainedProjectWritePath(
  root: string,
  value: string,
  label: string,
): Promise<string> {
  assertProjectRelativePath(value, label);
  const realRoot = await Deno.realPath(root);
  let resolved = realRoot;
  const segments = value.split("/");
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === undefined) {
      throw new Error(`invalid ${label} path ${JSON.stringify(value)}`);
    }
    const candidate = join(resolved, segment);
    const info = await lstatIfExists(candidate);
    if (info === undefined) {
      resolved = join(resolved, ...segments.slice(index));
      break;
    }
    if (info.isSymlink) {
      throw new Error(
        `invalid ${label} path ${
          JSON.stringify(value)
        }: remove the symbolic link before discern writes this file`,
      );
    }
    const canonical = await Deno.realPath(candidate);
    const canonicalBasename = basename(canonical).normalize("NFC");
    if (canonicalBasename !== segment.normalize("NFC")) {
      throw new Error(
        `invalid ${label} path ${
          JSON.stringify(value)
        }: existing path segment ${
          JSON.stringify(canonicalBasename)
        } does not use the configured spelling ${
          JSON.stringify(segment.normalize("NFC"))
        }`,
      );
    }
    resolved = canonical;
  }

  if (!isContained(realRoot, resolved)) {
    throw new Error(
      `invalid ${label} path ${JSON.stringify(value)}: it leaves the project`,
    );
  }
  return resolved;
}
