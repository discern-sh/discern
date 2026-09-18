import { assertOutsideCommonPublication } from "./operation_execution_boundary.ts";
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

import type { GitAdminPathRunner } from "./git_admin_paths.ts";
import { operationLockChildEnv } from "./operation_lock_context.ts";
import { spawnedByEnv } from "./invocation_context.ts";
import {
  selfShimDir as resolveSelfShimDir,
  selfShimPath as resolveSelfShimPath,
} from "./self_shim.ts";
import { quiesceProcessGroup, signalProcessGroup } from "./process_group.ts";
import { bestEffort, bestEffortSync } from "./best_effort.ts";
import { detachPromise } from "./promise_effects.ts";
import {
  type Scheduler,
  SYSTEM_SCHEDULER,
  type TimeoutHandle,
} from "./scheduler.ts";
import {
  GIT_TOPOLOGY_SUBCOMMANDS,
  invalidateGitDiscovery,
} from "./git_discovery.ts";

/** Bind Git-admin path queries to the canonical generic Git subprocess runner. */
const selfShimGitRunner: GitAdminPathRunner = async (cwd, args) =>
  await runGit(args, { cwd });

/** Resolve the running engine's shim directory through the canonical Git runner. */
export async function selfShimDir(root?: string): Promise<string> {
  return await resolveSelfShimDir(root, selfShimGitRunner);
}

/** Build an operator-command PATH through the canonical Git runner and self-shim. */
export async function selfShimPath(
  root?: string,
  base?: string,
): Promise<string> {
  return await resolveSelfShimPath(root, base, selfShimGitRunner);
}

/** The configured git binary (`GIT_BIN`, default `git`) — the one resolver. */
export function gitBin(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): string {
  return env.get("GIT_BIN") ?? "git";
}

/**
 * Git variables that can retarget a command away from its requested `cwd`.
 *
 * Git exports several of these to hooks. discern may legitimately run inside
 * an owner hook, but every Git operation still belongs to the repository named
 * by its caller. Identity, configuration, and tracing variables remain intact;
 * only repository-location state is removed at the child boundary.
 */
export const GIT_REPOSITORY_LOCATION_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
] as const;

/** Build a complete child environment without ambient Git repository routing. */
export function gitChildEnvironment(
  overrides: Readonly<Record<string, string>> = {},
  parent: Pick<typeof Deno.env, "toObject"> = Deno.env,
): Record<string, string> {
  const environment = { ...parent.toObject(), ...overrides };
  for (const variable of GIT_REPOSITORY_LOCATION_ENVIRONMENT) {
    delete environment[variable];
  }
  return environment;
}

export interface GitChildEnvironmentPlan {
  /** Clear and replace the complete environment when the host can enumerate it. */
  readonly clearEnv: boolean;
  /** Safe overrides, or the complete sanitized environment when clearEnv is true. */
  readonly env: Record<string, string>;
}

export type GitEnvironmentPermissionFallback =
  | "refuse"
  | "isolated-read-only";

/**
 * Plan a Git child's environment in both full and narrowly permissioned Deno
 * hosts. Ordinary callers refuse when the host cannot enumerate inherited
 * values. An explicitly isolated read-only caller may instead clear the whole
 * environment; that mode cannot redirect Git and cannot suppress a hook
 * because its enrolled commands never run one.
 */
export function gitChildEnvironmentPlan(
  overrides: Readonly<Record<string, string>> = {},
  permissionFallback: GitEnvironmentPermissionFallback = "refuse",
  parent: Pick<typeof Deno.env, "get" | "toObject"> = Deno.env,
): GitChildEnvironmentPlan {
  // Optional enumeration must not request a wider grant in an interactive host.
  if (
    permissionFallback === "refuse" ||
    Deno.permissions.querySync({ name: "env" }).state === "granted"
  ) {
    try {
      return {
        clearEnv: true,
        env: gitChildEnvironment(overrides, parent),
      };
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotCapable) &&
        !(error instanceof Deno.errors.PermissionDenied)
      ) {
        throw error;
      }
      if (permissionFallback === "refuse") throw error;
    }
  }

  const safeOverrides = { ...overrides };
  for (const variable of GIT_REPOSITORY_LOCATION_ENVIRONMENT) {
    delete safeOverrides[variable];
  }
  return { clearEnv: true, env: safeOverrides };
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
   * for injected test doubles and existing callers that construct a result. */
  stdoutBytes?: Uint8Array | undefined;
  stderr: string;
  /** Exact stderr bytes when the shared runner produced this result. */
  stderrBytes?: Uint8Array | undefined;
  /** True when the caller's explicit wall-clock bound killed the process. */
  timedOut?: boolean | undefined;
  /** True when the caller's explicit combined output bound killed the process. */
  outputLimitExceeded?: boolean | undefined;
}

/** Diagnostic returned when generic Git execution reaches for commit authority. */
export const GIT_COMMIT_BOUNDARY_ERROR =
  "`git commit` must use discern's attributed commit boundary " +
  "(commitDiscernChanges()).";

/** Diagnostic returned when inline config tries to introduce a Git alias. */
export const GIT_ALIAS_BOUNDARY_ERROR =
  "Git alias configuration cannot run through the generic Git runner. " +
  "Call the Git subcommand directly.";

/** Git subcommands that can choose or initiate transport outside the clone. */
export const DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS = [
  "clone",
  "fetch",
  "fetch-pack",
  "ls-remote",
  "maintenance",
  "pull",
  "push",
  "receive-pack",
  "send-pack",
  "submodule",
  "upload-pack",
] as const;

/** Diagnostic returned when discern code reaches for Git transport. */
export const GIT_TRANSPORT_BOUNDARY_ERROR =
  "discern's Git boundary is local-only; remote transport remains an explicit owner command.";

/** Git reads that neither mutate repository state nor invoke owner hooks. */
export const ISOLATED_GIT_READ_SUBCOMMANDS = [
  "cat-file",
  "ls-tree",
  "merge-base",
  "rev-parse",
  "show",
] as const;

/** Diagnostic returned when an isolated narrow host reaches beyond safe reads. */
export const GIT_ISOLATED_READ_BOUNDARY_ERROR =
  "An isolated Git host may run only its registered read-only subcommands.";

/** Exit code used when a caller-owned output ceiling terminates Git. */
export const GIT_OUTPUT_LIMIT_EXCEEDED = 125;

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

/** Whether one parsed Git invocation can initiate remote transport. */
function isTransportInvocation(
  invocation: GitInvocation,
  args: readonly string[],
): boolean {
  if (
    (DISCERN_FORBIDDEN_GIT_TRANSPORT_SUBCOMMANDS as readonly string[])
      .includes(invocation.subcommand)
  ) {
    return true;
  }
  const subcommandArgs = args.slice(invocation.subcommandIndex + 1);
  if (
    invocation.subcommand === "remote" &&
    subcommandArgs.some((arg) => arg === "update")
  ) {
    return true;
  }
  return invocation.subcommand === "archive" &&
    subcommandArgs.some((arg) =>
      arg === "--remote" || arg.startsWith("--remote=")
    );
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

interface CapturedCommandOutput {
  readonly success: boolean;
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

interface OutputBudget {
  remaining: number;
  exceeded: boolean;
}

/**
 * Read one child stream while retaining no more than the shared byte ceiling.
 * With a `sink`, arriving bytes are handed over instead of retained and never
 * count against the budget; the caller owns their memory.
 */
async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  budget: OutputBudget,
  terminate: () => void,
  signal: AbortSignal,
  sink?: (chunk: Uint8Array) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let retained = 0;
  const reader = stream.getReader();
  const cancel = (): void => {
    detachPromise(
      "subprocess-output-reader-cancel-detach",
      () =>
        bestEffort("subprocess-output-reader-cancel", async () => {
          await reader.cancel();
        }),
      globalThis.reportError,
    );
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (budget.exceeded) continue;
      if (sink !== undefined) {
        sink(value);
        continue;
      }
      const accepted = Math.min(value.length, budget.remaining);
      if (accepted > 0) {
        chunks.push(value.slice(0, accepted));
        retained += accepted;
        budget.remaining -= accepted;
      }
      if (accepted < value.length) {
        budget.exceeded = true;
        terminate();
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const output = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** Write optional protocol input without owning the caller's process globals. */
async function writeChildInput(
  child: Deno.ChildProcess,
  input: string | undefined,
): Promise<unknown> {
  if (input === undefined) return undefined;
  const writer = child.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    return undefined;
  } catch (error) {
    await bestEffort("subprocess-input-abort", async () => {
      await writer.abort(error);
    });
    return error;
  } finally {
    writer.releaseLock();
  }
}

/** Capture a child under optional time and combined stdout/stderr ceilings. */
async function boundedChildOutput(
  child: Deno.ChildProcess,
  opts: {
    readonly stdin?: string | undefined;
    readonly timeoutMs?: number | undefined;
    readonly maxOutputBytes: number;
    /** Stop descendants in the detached child group after its leader settles. */
    readonly quiesceDescendants?: boolean | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly scheduler: Scheduler;
    /** Receive stdout as it arrives instead of retaining it. */
    readonly stdoutSink?: ((chunk: Uint8Array) => void) | undefined;
  },
): Promise<{
  output: CapturedCommandOutput;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  inputError?: unknown;
}> {
  let timedOut = false;
  let terminated = false;
  const captureAbort = new AbortController();
  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    if (
      !(opts.quiesceDescendants && signalProcessGroup(child.pid, "SIGKILL"))
    ) {
      bestEffortSync("subprocess-bounded-child-kill", () => {
        child.kill("SIGKILL");
      });
    }
    // Closing the two capture pipes prevents an escaped descendant that
    // inherited them from turning a killed producer into an unbounded drain.
    captureAbort.abort();
  };
  const budget: OutputBudget = {
    remaining: Number.isFinite(opts.maxOutputBytes)
      ? Math.max(0, Math.floor(opts.maxOutputBytes))
      : 0,
    exceeded: false,
  };
  opts.signal?.addEventListener("abort", terminate, { once: true });
  if (opts.signal?.aborted) terminate();
  let timer: TimeoutHandle | undefined;
  if (opts.timeoutMs !== undefined) {
    timer = opts.scheduler.scheduleTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(0, opts.timeoutMs));
  }
  const inputPromise = writeChildInput(child, opts.stdin);
  const stdoutPromise = readBoundedStream(
    child.stdout,
    budget,
    terminate,
    captureAbort.signal,
    opts.stdoutSink,
  );
  const stderrPromise = readBoundedStream(
    child.stderr,
    budget,
    terminate,
    captureAbort.signal,
  );
  try {
    const status = await child.status;
    if (opts.quiesceDescendants) {
      await quiesceProcessGroup(child.pid, opts.scheduler);
    }
    const [stdout, stderr, inputError] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      inputPromise,
    ]);
    return {
      output: { success: status.success, code: status.code, stdout, stderr },
      timedOut,
      outputLimitExceeded: budget.exceeded,
      ...(inputError !== undefined ? { inputError } : {}),
    };
  } catch (error) {
    terminate();
    await child.status;
    await Promise.allSettled([stdoutPromise, stderrPromise, inputPromise]);
    throw error;
  } finally {
    if (timer !== undefined) opts.scheduler.cancelTimeout(timer);
    opts.signal?.removeEventListener("abort", terminate);
  }
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
 * of the contract, never inherited from ambient process state. `env` augments the
 * inherited environment after repository-location variables are removed, so a
 * caller can pin Git's configuration resolution without retargeting the command.
 * A missing or unrunnable git
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
    /** Explicit binary seam for parallel-safe tests; ordinary callers omit it. */
    bin?: string;
    /** Bytes supplied to commands whose protocol is defined on stdin. */
    stdin?: string;
    /** Optional caller-owned wall-clock bound. Omitted for ordinary Git calls. */
    timeoutMs?: number;
    /** Cancel this invocation and settle its owned process group before returning. */
    signal?: AbortSignal;
    /** Optional caller-owned combined stdout/stderr ceiling. */
    maxOutputBytes?: number;
    /**
     * Receive stdout bytes as they arrive instead of retaining them. Sunk
     * bytes never count against `maxOutputBytes`, and the returned `stdout`
     * and `stdoutBytes` are empty. The sink must not throw; a consumer that
     * cannot accept further bytes aborts `signal` instead.
     */
    stdoutSink?: (chunk: Uint8Array) => void;
    /**
     * Run Git in an isolated process group and stop hook/background descendants
     * before returning. Lifecycle callers set this when later teardown relies
     * on every command-owned writer having settled.
     */
    quiesceDescendants?: boolean;
    /** Timer lifecycle for explicit process bounds and descendant grace. */
    scheduler?: Scheduler;
    /** Clear all inherited state only for an enrolled read-only narrow host. */
    environmentPermissionFallback?: GitEnvironmentPermissionFallback;
  },
): Promise<GitResult> {
  opts.signal?.throwIfAborted();
  const invocation = gitInvocation(args);
  if (invocation?.subcommand === "commit") {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: GIT_COMMIT_BOUNDARY_ERROR,
    };
  }
  if (invocation !== undefined && isTransportInvocation(invocation, args)) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: GIT_TRANSPORT_BOUNDARY_ERROR,
    };
  }
  if (
    opts.environmentPermissionFallback === "isolated-read-only" &&
    (invocation === undefined ||
      !(ISOLATED_GIT_READ_SUBCOMMANDS as readonly string[]).includes(
        invocation.subcommand,
      ))
  ) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: GIT_ISOLATED_READ_BOUNDARY_ERROR,
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
  const binary = opts.bin ?? gitBin();
  const scheduler = opts.scheduler ?? SYSTEM_SCHEDULER;
  let output: CapturedCommandOutput;
  let timedOut = false;
  let outputLimitExceeded = false;
  try {
    const environment = gitChildEnvironmentPlan(
      opts.env,
      opts.environmentPermissionFallback,
    );
    const command = new Deno.Command(binary, {
      args: safeArgs,
      cwd: opts.cwd,
      clearEnv: environment.clearEnv,
      env: { ...environment.env, ...spawnedByEnv() },
      stdin: opts.stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      detached: (opts.quiesceDescendants ?? false) &&
        Deno.build.os !== "windows",
    });
    if (opts.quiesceDescendants ?? false) {
      const bounded = await boundedChildOutput(command.spawn(), {
        ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        maxOutputBytes: opts.maxOutputBytes ?? Number.MAX_SAFE_INTEGER,
        quiesceDescendants: true,
        signal: opts.signal,
        scheduler,
        stdoutSink: opts.stdoutSink,
      });
      output = bounded.output;
      timedOut = bounded.timedOut;
      outputLimitExceeded = bounded.outputLimitExceeded;
      if (bounded.inputError !== undefined && output.success) {
        throw bounded.inputError;
      }
    } else if (
      opts.stdin === undefined && opts.timeoutMs === undefined &&
      opts.maxOutputBytes === undefined && opts.signal === undefined &&
      opts.stdoutSink === undefined
    ) {
      output = await command.output();
    } else if (
      opts.maxOutputBytes !== undefined || opts.signal !== undefined ||
      opts.stdoutSink !== undefined
    ) {
      const bounded = await boundedChildOutput(command.spawn(), {
        ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        maxOutputBytes: opts.maxOutputBytes ?? Number.MAX_SAFE_INTEGER,
        signal: opts.signal,
        scheduler,
        stdoutSink: opts.stdoutSink,
      });
      output = bounded.output;
      timedOut = bounded.timedOut;
      outputLimitExceeded = bounded.outputLimitExceeded;
      if (bounded.inputError !== undefined && output.success) {
        throw bounded.inputError;
      }
    } else if (opts.stdin === undefined) {
      if (opts.timeoutMs === undefined) {
        output = await command.output();
      } else {
        const child = command.spawn();
        const outputPromise = child.output();
        let timer: TimeoutHandle | undefined;
        const winner = await Promise.race([
          outputPromise.then((value) => ({ kind: "output" as const, value })),
          new Promise<{ kind: "timeout" }>((resolveTimeout) => {
            timer = scheduler.scheduleTimeout(
              () => resolveTimeout({ kind: "timeout" }),
              Math.max(0, opts.timeoutMs ?? 0),
            );
          }),
        ]);
        if (timer !== undefined) scheduler.cancelTimeout(timer);
        if (winner.kind === "output") {
          output = winner.value;
        } else {
          timedOut = true;
          bestEffortSync("subprocess-timeout-child-kill", () => {
            child.kill("SIGKILL");
          });
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
        await bestEffort("subprocess-stdin-abort", async () => {
          await writer.abort(error);
        });
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
      stderr: describeSpawnError(error, binary),
    };
  } finally {
    // Worktree topology may have changed under every retained discovery answer.
    if (
      invocation !== undefined &&
      GIT_TOPOLOGY_SUBCOMMANDS.has(invocation.subcommand) &&
      !(invocation.subcommand === "worktree" &&
        args[invocation.subcommandIndex + 1] === "list")
    ) {
      invalidateGitDiscovery();
    }
  }
  const dec = new TextDecoder();
  opts.signal?.throwIfAborted();
  return {
    success: output.success && !timedOut && !outputLimitExceeded,
    code: timedOut
      ? 124
      : outputLimitExceeded
      ? GIT_OUTPUT_LIMIT_EXCEEDED
      : output.code,
    stdout: dec.decode(output.stdout),
    stdoutBytes: output.stdout,
    stderr: dec.decode(output.stderr),
    stderrBytes: output.stderr,
    ...(timedOut ? { timedOut: true } : {}),
    ...(outputLimitExceeded ? { outputLimitExceeded: true } : {}),
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
  await assertOutsideCommonPublication();
  try {
    const output = await new Deno.Command("sh", {
      args: ["-c", shellCommand(command)],
      cwd: opts.cwd,
      // `discern` in an operator command resolves to the running engine,
      // whatever the ambient PATH holds (self_shim.ts).
      env: {
        ...opts.env,
        ...operationLockChildEnv(),
        PATH: await selfShimPath(opts.cwd, opts.env?.PATH),
        ...spawnedByEnv(),
      },
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
    // discern-best-effort: subprocess-command-probe-fallback
    return false;
  }
}
