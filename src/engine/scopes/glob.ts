/**
 * The scope-glob matcher: does a changed path match one `[scopes.<name>].paths`
 * entry? Four legacy pattern kinds are tested first, in a fixed branch order: a
 * segment pattern (`/ui/`) both starts and ends with a slash, so it must be
 * tested BEFORE the trailing-slash prefix kind (`src/`), which would otherwise
 * swallow it. Any other pattern carrying a glob metacharacter is a STANDARD
 * glob, compiled and matched against the whole path — so `src/**\/*.ts`,
 * `src/*`, or `{a,b}/**` select a scope instead of silently degrading to a
 * literal comparison that can never match. Only a pattern with no glob marker
 * at all is an exact path.
 *
 * Every kind lives once in {@link PATTERN_KINDS}, an ORDERED registry
 * {@link pathMatchesPattern} dispatches through: a kind's `recognizes` predicate
 * (which pattern shapes it claims) and its `match` body are defined together, so
 * the branch cascade can't drift from the list a guard iterates. Add a kind to
 * the registry and the contract guard (`tests/scopes_glob_test.ts`) enrols it
 * automatically.
 */

import { globToRegExp } from "@std/path/posix/glob-to-regexp";

/** A character that marks a pattern as a glob rather than a literal path. */
const GLOB_META = /[*?[\]{}]/;

/** Compiled standard globs, cached: a config declares few patterns, but each is
 * matched against every changed path. */
const COMPILED = new Map<string, RegExp>();

function compiledGlob(pat: string): RegExp {
  let re = COMPILED.get(pat);
  if (re === undefined) {
    re = globToRegExp(pat, { extended: true, globstar: true });
    COMPILED.set(pat, re);
  }
  return re;
}

/**
 * One pattern kind: how {@link pathMatchesPattern} recognizes a pattern as this
 * kind, and how it then decides whether a path matches. `recognizes` and `match`
 * are a pair — the condition that selected the kind and the body that runs — so
 * a kind is defined in exactly one place.
 */
export interface PatternKind {
  /** The kind's label, for diagnostics and the contract guard. */
  readonly name: string;
  /** True when `pat` is written in this kind's shape. Tested in registry order. */
  readonly recognizes: (pat: string) => boolean;
  /** Whether `path` matches `pat`, given `pat` is already recognized as this kind. */
  readonly match: (path: string, pat: string) => boolean;
}

/**
 * The pattern kinds, in the fixed dispatch order {@link pathMatchesPattern}
 * walks. Order is load-bearing: a `/ui/` segment also ends with a slash, so the
 * segment kind must precede the trailing-slash prefix kind, and both must
 * precede the catch-all standard-glob kind. Each `recognizes`/`match` pair
 * captures one kind's whole contract:
 *   "src/**" / "src/"   prefix    — path starts with "src/"
 *   "/ui/"              segment   — "ui" is a directory segment, at ANY depth
 *   "*.view"            suffix    — path ends with ".view", at ANY depth
 *   glob metacharacter  standard  — compiled glob, `**` for any depth
 *   "routes/web.php"    exact     — path equals it (no glob marker at all)
 * A leading `/` anchors at the repo root — where every changed path is already
 * relative to — so `/**` matches the whole tree and `/ui/` reaches a
 * first-segment directory.
 */
export const PATTERN_KINDS: readonly PatternKind[] = [
  {
    name: "prefix-globstar", // "src/**"
    recognizes: (pat) =>
      pat.endsWith("/**") && !GLOB_META.test(pat.slice(0, -3)),
    match: (path, pat) => {
      const prefix = pat.slice(0, -2).replace(/^\//, ""); // "src/**" → "src/"
      return prefix === "" || path.startsWith(prefix); // "/**" → the whole tree
    },
  },
  {
    name: "segment", // "/ui/"
    recognizes: (pat) =>
      pat.length >= 2 && pat.startsWith("/") && pat.endsWith("/") &&
      !GLOB_META.test(pat),
    // "ui" is a directory segment at ANY depth, the repo root included. Paths
    // are root-relative with no leading slash, so prepend one: "ui/x" becomes
    // "/ui/x", letting a first-segment directory satisfy the pattern exactly as
    // a nested one does.
    match: (path, pat) => ("/" + path).includes(pat),
  },
  {
    name: "prefix", // "src/"
    recognizes: (pat) => pat.endsWith("/") && !GLOB_META.test(pat),
    match: (path, pat) => path.startsWith(pat),
  },
  {
    name: "suffix", // "*.view"
    recognizes: (pat) => /^\*\.[^*?[\]{}/]+$/.test(pat),
    match: (path, pat) => path.endsWith(pat.slice(1)), // suffix ".view"
  },
  {
    name: "standard-glob", // "src/**/*.ts", "{a,b}/**", "?at.ts"
    recognizes: (pat) => GLOB_META.test(pat),
    match: (path, pat) => compiledGlob(pat.replace(/^\//, "")).test(path),
  },
  {
    name: "exact", // "routes/web.php"
    recognizes: () => true, // catch-all: no glob marker → literal path
    match: (path, pat) => path === pat,
  },
] as const;

/**
 * True when `path` matches the single glob `pat`, dispatching through
 * {@link PATTERN_KINDS} in order — the first kind whose `recognizes` claims
 * `pat` decides the match. The empty pattern matches nothing.
 */
export function pathMatchesPattern(path: string, pat: string): boolean {
  if (pat === "") {
    return false;
  }
  for (const kind of PATTERN_KINDS) {
    if (kind.recognizes(pat)) {
      return kind.match(path, pat);
    }
  }
  return false; // unreachable: the exact kind's recognizer is a catch-all.
}

/**
 * Which pattern kind {@link pathMatchesPattern} classifies `pat` as — the first
 * registry entry whose `recognizes` claims it, or `undefined` for the empty
 * pattern (which no kind claims). Exported so the contract guard can enumerate
 * every kind and exercise each at every path position.
 */
export function classifyPattern(pat: string): PatternKind | undefined {
  if (pat === "") {
    return undefined;
  }
  return PATTERN_KINDS.find((kind) => kind.recognizes(pat));
}
