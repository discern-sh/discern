/**
 * Architectural guard: git output that lists file paths must be read
 * NUL-separated (`-z`). Line-oriented listings C-quote any "unusual" path —
 * non-ASCII bytes under git's default `core.quotePath`, plus double quotes,
 * backslashes, and control characters always — and a C-quoted path matches no
 * scope pattern, stats no file, and compares equal to nothing. That is the
 * defect class behind scope gates silently skipping non-ASCII filenames: one
 * call site forgets `-z` and every consumer downstream reads garbage.
 *
 * The canonical set is the source tree itself: every git argument array under
 * `src/**` that contains a path-listing flag (`--name-only`, `--name-status`,
 * `--numstat`, `ls-files`, or `status --porcelain*`) must carry `"-z"` in the
 * same array, so a new call site auto-enrols the moment it is written. Decode
 * the output with `src/shared/git_paths.ts`, the one NUL-record parser.
 *
 * Exempt: `git worktree list --porcelain` — its porcelain lists worktree
 * metadata (absolute worktree paths, printed verbatim), not tracked-file
 * paths, so `core.quotePath` never applies to it.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/** The quoted argument literals that make git print tracked-file paths. */
const PATH_LISTING_FLAGS = [
  '"--name-only"',
  '"--name-status"',
  '"--numstat"',
  '"--format=%(path)"',
  '"ls-files"',
  '"--porcelain"',
  '"--porcelain=v1"',
] as const;

/**
 * The `[...]` argument-array span enclosing `index`, or undefined when the
 * match is not inside an array literal (e.g. a doc comment). Bracket-counting
 * over raw source is deliberate: git argument arrays are flat string lists, so
 * nested brackets only appear as literal characters inside other arrays.
 */
function enclosingArray(text: string, index: number): string | undefined {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const ch = text[i];
    if (ch === "]") {
      depth++;
    } else if (ch === "[") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) {
    return undefined;
  }
  depth = 0;
  for (let i = index; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
      depth--;
    }
  }
  return undefined;
}

Deno.test("every git path-listing invocation in src/** passes -z", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(SRC, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) {
      continue;
    }
    const rel = relative(REPO_ROOT, entry.path);
    const text = await Deno.readTextFile(entry.path);
    for (const flag of PATH_LISTING_FLAGS) {
      let from = 0;
      while (true) {
        const at = text.indexOf(flag, from);
        if (at < 0) {
          break;
        }
        from = at + flag.length;
        const span = enclosingArray(text, at);
        if (span === undefined) {
          continue; // not an argument array (a comment or lone string)
        }
        if (span.includes('"worktree"')) {
          continue; // `worktree list --porcelain`: no tracked-file paths
        }
        if (!span.includes('"-z"')) {
          const line = text.slice(0, at).split("\n").length;
          offenders.push(`${rel}:${line} passes ${flag} without "-z"`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    'git path listings must be NUL-separated: add "-z" to the argument ' +
      "array and decode via src/shared/git_paths.ts — line-oriented output " +
      "C-quotes unusual paths, which silently defeats every downstream " +
      "consumer:\n  " + offenders.join("\n  "),
  );
});
