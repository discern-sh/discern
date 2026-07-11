/**
 * The single home for spawning the external processes the engine drives: git and
 * operator-supplied shell commands.
 *
 * Every git invocation funnels through {@link runGit} and every buffered shell
 * command through {@link runShell}, so the GIT_BIN override, the `sh -c`
 * invocation, the empty-command `:` no-op ({@link shellCommand}), output decoding,
 * and the "could not spawn" fallback ({@link SPAWN_FAILED}, whose stderr carries
 * the REAL spawn error via {@link describeSpawnError}) are each defined once. With
 * a single git resolver the GIT_BIN override is honored at every call site.
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

/**
 * Turn a caught spawn failure into a legible stderr line that names the REAL
 * cause — never a fabricated one. `Deno.Command().output()` throws distinct,
 * informative errors (a missing cwd is `Failed to spawn '<bin>': No such cwd
 * '<dir>'`; an absent executable is `Failed to spawn '<bin>': entity not
 * found`), so we surface that message verbatim rather than assuming one story.
 * When the executable itself is genuinely missing we append an actionable hint
 * naming it; a missing cwd or a permissions error keeps its own true message so
 * a user debugging a deleted-worktree failure is not sent hunting a PATH
 * problem that does not exist. `label` names what we tried to run (e.g. the git
 * binary, or `sh`) for the fallback when an error carries no message.
 */
export function describeSpawnError(error: unknown, label: string): string {
  const message = error instanceof Error && error.message !== ""
    ? error.message
    : `could not spawn ${label}`;
  // Deno phrases an absent executable as "entity not found"; that — and only
  // that — is the case where a PATH/install hint is the right next step.
  const executableMissing = error instanceof Deno.errors.NotFound &&
    /entity not found/i.test(message);
  return executableMissing
    ? `${message} (is ${label} installed and on your PATH?)`
    : message;
}

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
 * resolves to a failed run (code {@link SPAWN_FAILED}) whose stderr names the REAL
 * spawn failure ({@link describeSpawnError} — a missing cwd, a permissions error, or
 * an absent binary, each with its own message) rather than throwing, so every caller
 * handles "could not run git" as data. Honors GIT_BIN uniformly.
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
  } catch (error) {
    return {
      success: false,
      code: SPAWN_FAILED,
      stdout: "",
      stderr: describeSpawnError(error, gitBin()),
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
 * spawn failure resolves to {@link SPAWN_FAILED} rather than throwing, its stderr
 * carrying the REAL cause ({@link describeSpawnError}) rather than being swallowed
 * to nothing. For live streaming with cancellation use the gate job runner
 * (engine/jobs/command.ts); for logger-routed setup steps use runShellRouted
 * (engine/worktree/shell.ts).
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
  } catch (error) {
    return {
      success: false,
      code: SPAWN_FAILED,
      stdout: EMPTY,
      stderr: new TextEncoder().encode(describeSpawnError(error, "sh")),
    };
  }
}

/** Whitespace as the POSIX shell tokenizer sees it. */
function isShellSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/** Characters that make a word's runtime value (or the command structure)
 * unknowable without executing the shell: expansions, substitutions, grouping,
 * separators, redirections, globs, comments, escapes. Encountering one unquoted
 * means {@link leadingCommandWord} cannot answer confidently — it returns
 * `undefined` (skip the probe) rather than a word `sh` would never execute. */
const SHELL_SPECIAL = new Set([..."`$(){};&|<>*?[]#~!\\"]);

/** A POSIX environment-assignment prefix: `NAME=` with a valid variable name. */
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The leading command word `sh -c` would actually execute for an operator
 * command — the word {@link commandExists} can probe — or `undefined` when
 * there is nothing to probe or no confident answer exists.
 *
 * An operator command is shell syntax, not argv: splitting on whitespace turns
 * `CI=1 npm test` into a probe for `CI=1` and `"./my tool" run` into one for
 * `"./my` — false "command not found" verdicts for commands the gate runs
 * fine. So this extractor speaks just enough POSIX shell:
 *
 *   - leading `NAME=value` environment assignments are skipped (the shell
 *     applies them; the word after them is the command);
 *   - single/double quotes are resolved, so a quoted path with spaces probes
 *     as one word;
 *   - anything dynamic or compound ({@link SHELL_SPECIAL}) makes the leading
 *     word unknowable without running the shell — `undefined`, so a caller
 *     skips the probe instead of failing a healthy install.
 *
 * Words after the first are never inspected: probing only the leading command
 * of a piped/`&&`-chained string is the callers' documented, advisory scope.
 */
export function leadingCommandWord(command: string): string | undefined {
  let i = 0;
  while (true) {
    while (i < command.length && isShellSpace(command[i] ?? "")) {
      i++;
    }
    if (i >= command.length) {
      return undefined;
    }
    let word = "";
    /** Literal characters seen before any quote — an assignment's `NAME=` must
     * be unquoted (`"FOO"=bar` is a command named `FOO=bar`, not a prefix). */
    let unquotedPrefix = "";
    let sawQuote = false;
    while (i < command.length && !isShellSpace(command[i] ?? "")) {
      const char = command[i] ?? "";
      if (char === "'") {
        const close = command.indexOf("'", i + 1);
        if (close === -1) {
          return undefined; // unterminated — not parseable
        }
        word += command.slice(i + 1, close);
        sawQuote = true;
        i = close + 1;
        continue;
      }
      if (char === '"') {
        let j = i + 1;
        let closed = false;
        while (j < command.length) {
          const inner = command[j] ?? "";
          if (inner === "\\") {
            const escaped = command[j + 1];
            if (escaped === undefined) {
              return undefined;
            }
            word += escaped;
            j += 2;
            continue;
          }
          if (inner === "$" || inner === "`") {
            return undefined; // expands at runtime — unknowable
          }
          if (inner === '"') {
            closed = true;
            j++;
            break;
          }
          word += inner;
          j++;
        }
        if (!closed) {
          return undefined;
        }
        sawQuote = true;
        i = j;
        continue;
      }
      if (SHELL_SPECIAL.has(char)) {
        return undefined;
      }
      if (!sawQuote) {
        unquotedPrefix += char;
      }
      word += char;
      i++;
    }
    if (ENV_ASSIGNMENT_RE.test(unquotedPrefix)) {
      continue; // the shell's prefix, not the command — keep looking
    }
    return word === "" || word === ":" ? undefined : word;
  }
}

/**
 * Whether `word` resolves as a runnable command — on PATH, a shell builtin, or a
 * path — via the shell's own `command -v`. `word` is passed as a positional
 * argument, not interpolated into the script, so a surprising value cannot break
 * out of the probe. Pass `cwd` when validating a project-relative command so the
 * probe uses the same resolved root as its eventual execution. Extract the word
 * to probe from an operator command string with {@link leadingCommandWord},
 * never by splitting on whitespace.
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
