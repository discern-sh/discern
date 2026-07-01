/**
 * The single home for spawning the external processes the engine drives: git and
 * operator-supplied shell commands.
 *
 * Every git invocation funnels through {@link runGit} and every buffered shell
 * command through {@link runShell}, so the GIT_BIN override, the `sh -c`
 * invocation, the empty-command `:` no-op ({@link shellCommand}), output decoding,
 * and the "could not spawn" fallback ({@link SPAWN_FAILED}) are each defined once.
 * With a single git resolver the GIT_BIN override is honored at every call site.
 *
 * Two specialised shell spawners live outside this module by necessity and are
 * named in the guard: the gate's streaming, cancellable job runner
 * (engine/jobs/command.ts) and the logger-routed setup-step runner
 * (engine/worktree/shell.ts), which reserves its parent's stdout for a machine
 * result. An architectural guard (tests/engine_subprocess_ssot_test.ts) fails the
 * gate on a raw git or `sh -c` spawn anywhere else, pointing the author back here.
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
 * Run a git subcommand, capturing stdout+stderr. `cwd` is the required directory
 * git runs in (the equivalent of `-C`), so the checkout a git call targets is part
 * of the contract, never inherited from ambient process state; `env` is forwarded
 * to the spawn (merged over the parent environment) so a caller can pin git's config
 * resolution hermetically without mutating the process. A missing or unrunnable git
 * resolves to a failed run (code {@link SPAWN_FAILED}) with an explanatory stderr
 * rather than throwing, so every caller handles "no git" as data. Honors GIT_BIN
 * uniformly.
 */
export async function runGit(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): Promise<GitResult> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command(gitBin(), {
      args,
      cwd: opts.cwd,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
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

/**
 * Normalize an operator command for `sh -c`: an empty or whitespace-only command
 * becomes the POSIX `:` no-op (exit 0). The single definition of the engine's "no
 * command" convention, shared by every shell spawner.
 */
export function shellCommand(command: string): string {
  return command.trim() === "" ? ":" : command;
}

/** A finished buffered shell run: success flag, exit code, captured stdout/stderr. */
export interface ShellResult {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

const EMPTY = new Uint8Array();

/**
 * Run an operator command string through `sh -c` to completion, capturing its
 * stdout and stderr. `sh -c` preserves shell features (`&&`, pipes, globs,
 * `$(…)`) that parsing to argv would break; an empty command is the `:` no-op; a
 * spawn failure resolves to {@link SPAWN_FAILED} rather than throwing. For live
 * streaming with cancellation use the gate job runner (engine/jobs/command.ts);
 * for logger-routed setup steps use runShellRouted (engine/worktree/shell.ts).
 */
export async function runShell(
  command: string,
  opts: { cwd: string; env?: Record<string, string> },
): Promise<ShellResult> {
  try {
    const output = await new Deno.Command("sh", {
      args: ["-c", shellCommand(command)],
      cwd: opts.cwd,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      success: output.success,
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr,
    };
  } catch {
    return { success: false, code: SPAWN_FAILED, stdout: EMPTY, stderr: EMPTY };
  }
}

/**
 * Whether `word` resolves as a runnable command — on PATH, a shell builtin, or a
 * path — via the shell's own `command -v`. `word` is passed as a positional
 * argument, not interpolated into the script, so a surprising value cannot break
 * out of the probe. Pass `cwd` when validating a project-relative command so the
 * probe uses the same resolved root as its eventual execution.
 */
export async function commandExists(
  word: string,
  opts: { cwd?: string } = {},
): Promise<boolean> {
  try {
    const out = await new Deno.Command("sh", {
      args: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", word],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}
