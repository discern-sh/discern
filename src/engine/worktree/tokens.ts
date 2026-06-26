/**
 * The adapter-token convention: runtime tokens substituted into a worktree's
 * resource commands.
 *
 * Project-supplied resource commands in `[worktree.resources.<name>]`
 * (`create`/`destroy`/`ensure`) carry RUNTIME tokens that are substituted with
 * values derived from THIS worktree's identity before the command runs. They use
 * the `@…@` delimiter — distinct from the installer's `{{…}}` content tokens
 * (already substituted at init) — so the two layers never collide:
 *
 *   @db@            the database-name-safe identity      (worktree-name --db)
 *   @site@          the dev-server site/host name        (worktree-name --site)
 *   @port@          the deterministic per-worktree port  (worktree-name --port)
 *   @worktree@      the worktree's base handle, slug-id  (worktree-name --worktree)
 *   @resource@      this resource's handle, slug-id-name (worktree-name --resource <name>)
 *   @project_slug@  the project slug                     (config project.slug)
 *   @dir@           the worktree root                    (the checkout's abs path)
 *
 * `@resource@` is bound to the resource whose command is running, so it is only
 * meaningful inside a resource's own `create`/`destroy`/`ensure`; in
 * `[worktree.setup].steps` (which run outside any single resource) it resolves to
 * the empty string.
 *
 * A token's value is resolved only when that token actually appears, so a command
 * naming no tokens triggers no resolution work. Replacement is a plain
 * string-by-string substitution (no regex), so a value containing any
 * metacharacter is inserted verbatim, and a value that itself contains the token
 * never loops.
 */

/** The adapter tokens, in resolution order. */
export const WORKTREE_TOKENS = [
  "db",
  "site",
  "port",
  "project_slug",
  "dir",
  "worktree",
  "resource",
] as const;

/** One of the recognised adapter token names. */
export type WorktreeToken = (typeof WORKTREE_TOKENS)[number];

/**
 * Lazily resolves a token to its string value. Called at most once per token per
 * expansion, and only for tokens actually present in the command. A resolver may
 * return a Promise (db/site/port shell out to identity resolution).
 */
export type TokenResolver = (
  token: WorktreeToken,
) => string | Promise<string>;

/**
 * Replace every literal occurrence of `find` in `input` with `repl`. Pure
 * string scanning (no regex) so `repl` is inserted verbatim, and a `repl` that
 * contains `find` is not re-scanned (no infinite loop).
 */
export function replaceAll(input: string, find: string, repl: string): string {
  if (find === "") {
    return input;
  }
  let out = "";
  let rest = input;
  while (true) {
    const idx = rest.indexOf(find);
    if (idx < 0) {
      return out + rest;
    }
    out += rest.slice(0, idx) + repl;
    rest = rest.slice(idx + find.length);
  }
}

/**
 * Substitute every adapter token present in `command` and return the result. An
 * empty command is a clean no-op (returns `""`). For each token, its value is
 * resolved (via `resolve`) only if the `@token@` placeholder appears, then all
 * occurrences are replaced.
 */
export async function expandTokens(
  command: string,
  resolve: TokenResolver,
): Promise<string> {
  if (command === "") {
    return "";
  }
  let out = command;
  for (const token of WORKTREE_TOKENS) {
    const placeholder = `@${token}@`;
    if (out.includes(placeholder)) {
      const value = await resolve(token);
      out = replaceAll(out, placeholder, value);
    }
  }
  return out;
}
