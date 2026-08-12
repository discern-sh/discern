/**
 * Shared subprocess mechanics for the ordinary Git commands and
 * operator-supplied shell commands the engine drives.
 *
 * Every ordinary Git invocation funnels through {@link runGit} and every
 * buffered shell command through {@link runShell}. The GIT_BIN resolver,
 * `sh -c` invocation, empty-command `:` no-op ({@link shellCommand}), and
 * "could not spawn" vocabulary ({@link SPAWN_FAILED} and
 * {@link describeSpawnError}) stay shared. Discern-authored commits are the one
 * narrower Git-spawn exception: the attributed commit boundary owns that
 * command, and this generic runner refuses the subcommand before invoking Git.
 *
 * Two specialised shell spawners live outside this module by necessity and are
 * named in the guard: the gate's streaming, cancellable job runner
 * (engine/jobs/command.ts) and the logger-routed setup-step runner
 * (engine/worktree/shell.ts), which reserves its parent's stdout for a machine
 * result. An architectural guard (tests/engine_subprocess_ssot_test.ts) fails the
 * gate on an unregistered raw Git or `sh -c` spawn, pointing ordinary calls
 * back here and commits to their attributed boundary.
 */

import { selfShimPath } from "./self_shim.ts";

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
  /** Exact stdout bytes when the shared runner produced this result. Optional
   * for injected test doubles and legacy callers that construct a result. */
  stdoutBytes?: Uint8Array | undefined;
  stderr: string;
  /** True when the caller's explicit wall-clock bound killed the process. */
  timedOut?: boolean | undefined;
}

/** Diagnostic returned when generic Git execution reaches for commit authority. */
export const GIT_COMMIT_BOUNDARY_ERROR =
  "`git commit` must use discern's attributed commit boundary " +
  "(commitDiscernChanges()).";

/** Diagnostic returned when inline config tries to introduce a Git alias. */
export const GIT_ALIAS_BOUNDARY_ERROR =
  "Git alias configuration cannot run through the generic Git runner. " +
  "Call the Git subcommand directly.";

type GitConfigSource = "config" | "config-env" | "other";

/** Global Git options whose next argv member is data, not the subcommand. */
const GIT_GLOBAL_VALUE_OPTIONS = new Map<string, GitConfigSource>([
  ["-C", "other"],
  ["-c", "config"],
  ["--git-dir", "other"],
  ["--work-tree", "other"],
  ["--namespace", "other"],
  ["--super-prefix", "other"],
  ["--config-env", "config-env"],
]);

/** Equals-form global options whose suffix is data, not the subcommand. */
const GIT_GLOBAL_EQUALS_OPTIONS = [
  ["--git-dir=", "other"],
  ["--work-tree=", "other"],
  ["--namespace=", "other"],
  ["--super-prefix=", "other"],
  ["--config-env=", "config-env"],
  ["--exec-path=", "other"],
] as const satisfies readonly (readonly [string, GitConfigSource])[];

/** Global query options that exit before Git dispatches any subcommand. */
const GIT_TERMINAL_GLOBAL_OPTIONS = new Set([
  "-v",
  "--version",
  "-h",
  "--help",
  "--exec-path",
  "--html-path",
  "--man-path",
  "--info-path",
]);

interface GitInvocation {
  readonly subcommand: string;
  readonly subcommandIndex: number;
  readonly inlineConfigKeys: readonly string[];
}

/** Whether one status argv already selects how untracked paths are shown. */
function hasUntrackedStatusPolicy(args: readonly string[]): boolean {
  return args.some((arg) =>
    arg === "-u" || arg.startsWith("-u") ||
    arg === "--untracked-files" || arg.startsWith("--untracked-files=")
  );
}

/** Whether one status argv already selects how submodule changes are shown. */
function hasSubmoduleStatusPolicy(args: readonly string[]): boolean {
  return args.some((arg) =>
    arg === "--ignore-submodules" || arg.startsWith("--ignore-submodules=")
  );
}

/** The case-insensitive config key before its `=value` or `=environment`. */
function gitConfigKey(value: string): string {
  const separator = value.indexOf("=");
  return (separator === -1 ? value : value.slice(0, separator))
    .trim()
    .toLowerCase();
}

/**
 * Resolve Git's actual subcommand after its global options. Values belonging to
 * `-C`, `-c`, and the long path/config options are data: a ref or directory
 * named `commit` there must not acquire commit authority by accident.
 */
function gitInvocation(args: readonly string[]): GitInvocation | undefined {
  const inlineConfigKeys: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined || arg === "--") return undefined;
    if (
      GIT_TERMINAL_GLOBAL_OPTIONS.has(arg) ||
      arg.startsWith("--list-cmds=")
    ) {
      return undefined;
    }

    const valueSource = GIT_GLOBAL_VALUE_OPTIONS.get(arg);
    if (valueSource !== undefined) {
      const value = args[index + 1];
      if (value === undefined) return undefined;
      if (valueSource !== "other") {
        inlineConfigKeys.push(gitConfigKey(value));
      }
      index += 2;
      continue;
    }

    if (arg.startsWith("-c") && arg.length > 2) {
      inlineConfigKeys.push(gitConfigKey(arg.slice(2)));
      index += 1;
      continue;
    }
    if (arg.startsWith("-C") && arg.length > 2) {
      index += 1;
      continue;
    }

    const equalsOption = GIT_GLOBAL_EQUALS_OPTIONS.find(([prefix]) =>
      arg.startsWith(prefix)
    );
    if (equalsOption !== undefined) {
      const [prefix, source] = equalsOption;
      if (source === "config-env") {
        inlineConfigKeys.push(gitConfigKey(arg.slice(prefix.length)));
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      index += 1;
      continue;
    }
    return {
      subcommand: arg,
      subcommandIndex: index,
      inlineConfigKeys,
    };
  }
  return undefined;
}

/**
 * Apply the generic Git funnel's configuration invariants to one argv.
 *
 * A configured alias is neutralized for every real subcommand. `git status`
 * additionally receives Git's ordinary visibility defaults as explicit CLI
 * options unless its caller selected another policy. This keeps
 * `status.showUntrackedFiles` and `diff.ignoreSubmodules` from changing a
 * machine-read safety predicate. Explicit caller options remain authoritative.
 */
export function configInvariantGitArgs(args: readonly string[]): string[] {
  const invocation = gitInvocation(args);
  if (invocation === undefined) {
    return [...args];
  }
  const tail = args.slice(invocation.subcommandIndex + 1);
  const pathspecSeparator = tail.indexOf("--");
  const subcommandOptions = pathspecSeparator === -1
    ? tail
    : tail.slice(0, pathspecSeparator);
  const defaults = invocation.subcommand === "status"
    ? [
      ...(!hasUntrackedStatusPolicy(subcommandOptions)
        ? ["--untracked-files=normal"]
        : []),
      ...(!hasSubmoduleStatusPolicy(subcommandOptions)
        ? ["--ignore-submodules=none"]
        : []),
    ]
    : [];
  return [
    ...args.slice(0, invocation.subcommandIndex),
    "-c",
    `alias.${invocation.subcommand}=`,
    invocation.subcommand,
    ...defaults,
    ...tail,
  ];
}

/** Options for {@link discernMergeArgs}. */
export interface DiscernMergeOptions {
  /** Require a fast-forward instead of permitting a merge commit. */
  readonly ffOnly?: boolean;
  /** Suppress Git's routine merge output. */
  readonly quiet?: boolean;
}

/**
 * Git argv for a discern-owned branch merge.
 *
 * The current branch's `branch.<name>.mergeOptions` is cleared for this call,
 * then the intended topology is stated on the command line. Ambient
 * `merge.ff` and per-branch options therefore cannot add a merge commit, force
 * an ff-only refusal, squash, or leave a successful merge uncommitted.
 */
export function discernMergeArgs(
  currentBranch: string,
  source: string,
  opts: DiscernMergeOptions = {},
): string[] {
  return [
    "-c",
    `branch.${currentBranch}.mergeOptions=`,
    "-c",
    "merge.ff=true",
    "merge",
    opts.ffOnly === true ? "--ff-only" : "--ff",
    "--commit",
    "--no-squash",
    "--no-edit",
    ...(opts.quiet === true ? ["--quiet"] : []),
    source,
  ];
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
  opts: {
    cwd: string;
    env?: Record<string, string>;
    /** Bytes supplied to commands whose protocol is defined on stdin. */
    stdin?: string;
    /** Optional caller-owned wall-clock bound. Omitted for ordinary Git calls. */
    timeoutMs?: number;
  },
): Promise<GitResult> {
  const invocation = gitInvocation(args);
  if (invocation?.subcommand === "commit") {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: GIT_COMMIT_BOUNDARY_ERROR,
    };
  }
  if (
    invocation?.inlineConfigKeys.some((key) => key.startsWith("alias.")) ??
      false
  ) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: GIT_ALIAS_BOUNDARY_ERROR,
    };
  }
  // A configured alias is another spelling for an arbitrary command. The same
  // normalization pins machine-read status visibility at this shared funnel.
  const safeArgs = configInvariantGitArgs(args);
  let output: Deno.CommandOutput;
  let timedOut = false;
  try {
    const command = new Deno.Command(gitBin(), {
      args: safeArgs,
      cwd: opts.cwd,
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      stdin: opts.stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
    });
    if (opts.stdin === undefined) {
      if (opts.timeoutMs === undefined) {
        output = await command.output();
      } else {
        const child = command.spawn();
        const outputPromise = child.output();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const winner = await Promise.race([
          outputPromise.then((value) => ({ kind: "output" as const, value })),
          new Promise<{ kind: "timeout" }>((resolveTimeout) => {
            timer = setTimeout(
              () => resolveTimeout({ kind: "timeout" }),
              Math.max(0, opts.timeoutMs ?? 0),
            );
          }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
        if (winner.kind === "output") {
          output = winner.value;
        } else {
          timedOut = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // It may have exited at the same instant the timer won.
          }
          output = await outputPromise;
        }
      }
    } else {
      const child = command.spawn();
      const outputPromise = child.output();
      const writer = child.stdin.getWriter();
      let inputError: unknown;
      try {
        await writer.write(new TextEncoder().encode(opts.stdin));
        await writer.close();
      } catch (error) {
        inputError = error;
        try {
          await writer.abort(error);
        } catch {
          // The child may already have closed its input after reporting its own
          // more specific failure. Preserve that process result below.
        }
      } finally {
        writer.releaseLock();
      }
      output = await outputPromise;
      if (inputError !== undefined && output.success) {
        throw inputError;
      }
    }
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
    success: output.success && !timedOut,
    code: timedOut ? 124 : output.code,
    stdout: dec.decode(output.stdout),
    stdoutBytes: output.stdout,
    stderr: dec.decode(output.stderr),
    ...(timedOut ? { timedOut: true } : {}),
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
      // `discern` in an operator command resolves to the running engine,
      // whatever the ambient PATH holds (self_shim.ts).
      env: { ...opts.env, PATH: await selfShimPath(opts.cwd, opts.env?.PATH) },
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
 * probe uses the same resolved root as its eventual execution. The probe runs
 * with the same self-shim PATH the operator-command runners use (self_shim.ts),
 * so its verdict on a `discern …` command matches what execution would do.
 * Extract the word to probe from an operator command string with
 * {@link leadingCommandWord}, never by splitting on whitespace.
 */
export async function commandExists(
  word: string,
  opts: { cwd?: string } = {},
): Promise<boolean> {
  try {
    const out = await new Deno.Command("sh", {
      args: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", word],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      env: { PATH: await selfShimPath(opts.cwd) },
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}
