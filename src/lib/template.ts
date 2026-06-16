/**
 * Token substitution for the scaffold tree.
 *
 * Templates carry `{{name}}` tokens in their *contents* (only in `*.tmpl` files)
 * and, for one path token, in their *names* (`{{project_slug}}`). This module
 * owns the substitution contract: the closed set of known tokens, the rule for
 * unknown tokens (leave verbatim, report them so drift surfaces), and the
 * `.tmpl` suffix stripping that turns a template path into its target path.
 */

import { basename } from "@std/path";

/**
 * The complete, closed set of content tokens the kit substitutes. This is the
 * contract: no token outside this set is invented. `{{db}}` is deliberately
 * absent — it is a *runtime* token the worktree engine expands per-worktree, so
 * the installer must pass it through untouched.
 */
export type ContentTokenName =
  | "project_name"
  | "project_slug"
  | "branch_prefix"
  | "agents_array"
  | "gotchas_doc"
  | "scopes_neutral"
  | "scopes_web"
  | "scopes_previewable"
  | "kit_version";

/** The concrete token values resolved for one `init` run. */
export type TokenMap = Record<ContentTokenName, string>;

/** The single path token that may appear in a template file *name*. */
const PATH_TOKEN = "project_slug";

/** Match any `{{token}}` occurrence; the inner group is the bare token name. */
const TOKEN_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Result of substituting tokens into a string. */
export interface SubstitutionResult {
  /** The text with every known token replaced. */
  text: string;
  /** Names of tokens encountered that are not in the known map (left verbatim). */
  unknown: string[];
}

/**
 * Substitute known content tokens, leaving unknown `{{tokens}}` verbatim and
 * collecting their names so the caller can warn about drift. The `{{db}}`
 * token is treated as known-and-preserved (a runtime token), so it neither
 * substitutes nor counts as drift.
 */
export function substituteTokens(
  input: string,
  tokens: TokenMap,
): SubstitutionResult {
  const unknown = new Set<string>();
  const text = input.replace(TOKEN_PATTERN, (match, name: string) => {
    if (name === "db") {
      // Runtime token owned by the worktree engine: pass through untouched.
      return match;
    }
    if (Object.hasOwn(tokens, name)) {
      return tokens[name as ContentTokenName];
    }
    unknown.add(name);
    return match;
  });
  return { text, unknown: [...unknown] };
}

/** True when the path is a template file (`*.tmpl`). */
export function isTemplateFile(path: string): boolean {
  return path.endsWith(".tmpl");
}

/** True when the path is the special `.gitignore.fragment` appender. */
export function isGitignoreFragment(path: string): boolean {
  return basename(path) === ".gitignore.fragment";
}

/** True when the path is the special, deep-merged Claude settings template. */
export function isSettingsTemplate(path: string): boolean {
  return path.endsWith(".claude/settings.json.tmpl") ||
    path === ".claude/settings.json.tmpl";
}

/**
 * True when a *target* path must end up executable as part of the harness
 * contract: the dispatcher `bin/agent` and the top-level engine recipes (the
 * files `bin/agent` invokes). The engine's `lib/` sources and `*.awk` data are
 * deliberately not executable.
 *
 * This is OR'd with the source file's own exec bit so the bit survives even when
 * the source mode is unreliable — notably the `deno compile` embedded
 * filesystem, which flattens every bundled file to read-only and would
 * otherwise strip the bit the recipes need.
 */
export function isContractExecutable(targetRelPath: string): boolean {
  const path = targetRelPath.replaceAll("\\", "/");
  if (path === "bin/agent") {
    return true;
  }
  // A top-level engine recipe: directly under .icculus/engine/, not in lib/.
  if (path.startsWith(".icculus/engine/")) {
    const rest = path.slice(".icculus/engine/".length);
    return !rest.includes("/");
  }
  return false;
}

/**
 * Turn a template-relative path into its scaffolded target path: substitute the
 * single path token (`{{project_slug}}`) and strip a trailing `.tmpl`.
 * Path tokens never carry drift — only `project_slug` is permitted in a name —
 * so this returns the resolved string directly.
 */
export function resolveTargetPath(
  templateRelPath: string,
  slug: string,
): string {
  const withToken = templateRelPath.replace(
    TOKEN_PATTERN,
    (match, name: string) => (name === PATH_TOKEN ? slug : match),
  );
  return withToken.endsWith(".tmpl")
    ? withToken.slice(0, -".tmpl".length)
    : withToken;
}
