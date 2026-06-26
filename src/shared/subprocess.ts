/**
 * The single home for spawning the external processes the engine drives.
 *
 * Every git invocation funnels through {@link runGit}, so the GIT_BIN override,
 * the captured-output decoding, and the "could not spawn" fallback are each
 * defined once rather than re-derived at each call site. With a single resolver
 * the GIT_BIN override is honored uniformly — at every git call site, not just
 * some. An architectural guard (tests/engine_subprocess_ssot_test.ts) holds
 * the line: a raw `new Deno.Command(gitBin()|"git", …)` anywhere else fails the
 * gate, pointing the author back here.
 */

/** The configured git binary (`GIT_BIN`, default `git`) — the one resolver. */
export function gitBin(): string {
  return Deno.env.get("GIT_BIN") ?? "git";
}

/**
 * The exit code reported when a command could not be spawned at all — the POSIX
 * "command not found" code. A caller treats it as an ordinary failed run.
 */
export const SPAWN_FAILED = 127;

/** A finished git run: success flag, exit code, and captured (decoded) stdout/stderr. */
export interface GitResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a git subcommand, capturing stdout+stderr. `cwd` runs git there (the
 * equivalent of `-C`). A missing or unrunnable git resolves to a failed run
 * (code {@link SPAWN_FAILED}) with an explanatory stderr rather than throwing, so
 * every caller handles "no git" as data. Honors GIT_BIN uniformly.
 */
export async function runGit(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<GitResult> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command(gitBin(), {
      args,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    return {
      success: false,
      code: SPAWN_FAILED,
      stdout: "",
      stderr: "git is not on PATH",
    };
  }
  const dec = new TextDecoder();
  return {
    success: output.success,
    code: output.code,
    stdout: dec.decode(output.stdout),
    stderr: dec.decode(output.stderr),
  };
}
