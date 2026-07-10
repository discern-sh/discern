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
 * True when `path` matches the single glob `pat`. Legacy kinds first:
 *   "src/**" / "src/"   prefix    — path starts with "src/"
 *   "/ui/"              segment   — path contains "/ui/" (no wildcards)
 *   "*.view"            suffix    — path ends with ".view", at ANY depth
 *   "routes/web.php"    exact     — path equals it
 * Everything else containing a glob metacharacter matches as a standard glob
 * with `**` for any depth (`src/**\/*.ts`, `src/*`, `**\/*.md`, `{a,b}/**`).
 * A leading `/` anchors at the repo root — where every changed path is
 * already relative to — so `/**` matches the whole tree.
 */
export function pathMatchesPattern(path: string, pat: string): boolean {
  if (pat === "") {
    return false;
  }
  if (pat.endsWith("/**") && !GLOB_META.test(pat.slice(0, -3))) {
    const prefix = pat.slice(0, -2).replace(/^\//, ""); // "src/**" → "src/"
    return prefix === "" || path.startsWith(prefix); // "/**" → the whole tree
  }
  if (
    pat.length >= 2 && pat.startsWith("/") && pat.endsWith("/") &&
    !GLOB_META.test(pat)
  ) {
    return path.includes(pat); // "/ui/" → segment-contains
  }
  if (pat.endsWith("/") && !GLOB_META.test(pat)) {
    return path.startsWith(pat); // "src/" → prefix
  }
  if (/^\*\.[^*?[\]{}/]+$/.test(pat)) {
    return path.endsWith(pat.slice(1)); // "*.view" → suffix ".view"
  }
  if (GLOB_META.test(pat)) {
    return compiledGlob(pat.replace(/^\//, "")).test(path); // standard glob
  }
  return path === pat; // no glob marker → exact match
}
