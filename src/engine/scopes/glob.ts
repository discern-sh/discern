/**
 * The scope-glob matcher: does a changed path match one `[scopes.<name>].paths`
 * entry? Four pattern kinds, tested in the SAME branch order as the shell
 * `path_matches_pattern` — a segment pattern (`/ui/`) both starts and ends with a
 * slash, so it must be tested BEFORE the trailing-slash prefix kind (`src/`),
 * which would otherwise swallow it.
 */

/**
 * True when `path` matches the single glob `pat`. Pattern kinds:
 *   "src/**" / "src/"   prefix    — path starts with "src/"
 *   "/ui/"              segment   — path contains "/ui/"
 *   "*.view"            suffix    — path ends with ".view"
 *   "routes/web.php"    exact     — path equals it
 */
export function pathMatchesPattern(path: string, pat: string): boolean {
  if (pat === "") {
    return false;
  }
  if (pat.endsWith("/**")) {
    return path.startsWith(pat.slice(0, -2)); // "src/**" → prefix "src/"
  }
  if (pat.length >= 2 && pat.startsWith("/") && pat.endsWith("/")) {
    return path.includes(pat); // "/ui/" → segment-contains
  }
  if (pat.endsWith("/")) {
    return path.startsWith(pat); // "src/" → prefix
  }
  if (pat.startsWith("*.")) {
    return path.endsWith(pat.slice(1)); // "*.view" → suffix ".view"
  }
  return path === pat; // no glob marker → exact match
}
