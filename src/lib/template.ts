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
 * The complete, closed set of content tokens the kit substitutes, written
 * `{{name}}`. This is the contract: no token outside this set is invented; an
 * unknown `{{token}}` is left verbatim and reported as drift. The worktree
 * engine's *runtime* tokens use a DIFFERENT delimiter — `@db@`, `@site@`, … (see
 * `engine/worktree/tokens.ts`) — so they never collide with these and need no special
 * pass-through here.
 */
export type ContentTokenName =
  | "project_name"
  | "project_slug"
  | "branch_prefix"
  | "agents_array"
  | "map_dir"
  | "gotchas_doc"
  | "scopes_neutral"
  | "scopes_instructions"
  | "artifact_provenance_marker"
  | "kit_version";

/** The concrete token values resolved for one `setup` run. */
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
 * collecting their names so the caller can warn about drift. The worktree
 * engine's runtime tokens use the `@…@` delimiter, so they are simply not
 * `{{…}}` matches here — no special-case is needed to preserve them.
 */
export function substituteTokens(
  input: string,
  tokens: TokenMap,
): SubstitutionResult {
  const unknown = new Set<string>();
  const text = input.replace(TOKEN_PATTERN, (match, name: string) => {
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
