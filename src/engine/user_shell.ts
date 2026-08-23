/** Resolve the interactive shell used when discern opens a worktree session. */

/** The environment read needed to resolve a user's configured shell. */
export interface UserShellEnvironment {
  get(name: string): string | undefined;
}

/** Resolve `$SHELL`, falling back to discern's existing default shell. */
export function userShell(
  env: UserShellEnvironment = Deno.env,
): string {
  const configured = env.get("SHELL")?.trim();
  return configured === undefined || configured === "" ? "/bin/sh" : configured;
}
