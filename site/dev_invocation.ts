/**
 * The one shared reading of a preview task's `deno run` invocation. It stays
 * free of site imports so a tool that only needs the parse — the linked
 * design-system preview — loads without the site's own package graph.
 */

/** One `deno run` invocation inside a task command: sandbox flags plus entry. */
export interface DenoRunInvocation {
  /** The `--allow-*` / `--deny-*` permission flags, in command order. */
  readonly permissionFlags: readonly string[];
  /** The first non-flag token after `deno run` — the entry module path. */
  readonly entry: string;
}

/**
 * Extract the first `deno run` invocation from a task command, or undefined
 * when the command runs no module. The one shared reading of a preview task's
 * permission surface: the sufficiency guard replays these flags against a real
 * worktree, and the linked design-system preview derives its server sandbox
 * from the same parse, so a permission fix in `deno.json` reaches both.
 */
export function denoRunInvocation(
  command: string,
): DenoRunInvocation | undefined {
  const tokens = command.split(/\s+/).filter((token) => token !== "");
  const run = tokens.findIndex((token, index) =>
    token === "deno" && tokens[index + 1] === "run"
  );
  if (run === -1) return undefined;
  const permissionFlags: string[] = [];
  for (let index = run + 2; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.startsWith("-")) {
      if (/^--(?:allow|deny)-/.test(token)) permissionFlags.push(token);
      continue;
    }
    return { permissionFlags, entry: token };
  }
  return undefined;
}
