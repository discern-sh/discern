/**
 * The **CLI interceptor** — the one recording point every `discern` verb action
 * routes through, and the process's single `Deno.exit` owner for verb dispatch.
 *
 * The MCP surface always had a chokepoint (`runVerb` in the server); the CLI
 * did not — each Cliffy action independently ran its verb and exited. This
 * wrapper closes that structural gap: an action's body now RETURNS its exit
 * code, and {@link recordedExit} runs it, records one logbook event on
 * completion (green or red — a thrown error records `failed` and rethrows),
 * and performs the exit. One place to observe an invocation is also one place
 * a future cross-cutting concern can ride.
 *
 * Coverage is a parity guarantee, not a convention: {@link RECORDED_CLI_VERBS}
 * collects every verb registered through the wrapper at CLI-build time, and
 * `tests/engine_verb_parity_test.ts` reconciles it against `KNOWN_VERBS` — a
 * new verb that skips the wrapper fails the gate.
 *
 * The per-invocation envelope (steps, diagnostics) arrives through the
 * observed-result seam (`shared/result_capture.ts`): `emitResult` feeds it on
 * every quiet result run and the gate entry points feed it in human mode. A
 * verb that surfaces no envelope still records a minimal event.
 */

import {
  observeResult,
  takeCheckpointActivity,
  takeObservedResult,
  takeShownTipIds,
  takeSupplementalHintIds,
  takeVerbTarget,
} from "../../shared/result_capture.ts";
import {
  type CrashSignature,
  crashSignature,
  throwIfCrashProbe,
} from "../crash.ts";
import type { DriverFacts, LogbookSurface } from "./schema.ts";
import type { AgentSignal } from "./agent_signals.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import {
  LOGBOOK_EFFECTFUL_VERBS,
  logbookInvocationIsRecorded,
} from "../../shared/verbs.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { operationEffectPolicy } from "../../shared/operation_effects.ts";

const recordedVerbs = new Set<string>();
const beginRecordedVerbs = new Set<string>();
const recordedCommandPaths = new Set<string>();

/** Resolve a command path to its public envelope discriminator at the CLI edge. */
type OperationResultVerbResolver = (command: string) => string | undefined;

let operationResultVerbResolver: OperationResultVerbResolver = () => undefined;

/** Install the public result-contract resolver without importing its graph. */
export function setOperationResultVerbResolver(
  resolver: OperationResultVerbResolver,
): void {
  operationResultVerbResolver = resolver;
}

/**
 * The CLI's raw driver signals — evidence for the who-drove-this question,
 * gathered here because only the surface knows them: the parent process id (a
 * session grouping hint — one conversation's invocations share a parent even
 * when every task shares a branch), which result format was requested,
 * whether stdout is a terminal, whether the conventional CI marker is set,
 * and every advisory identity marker the shared catalogue recognizes. Facts
 * only; marker values never land, and scoring them into an is-this-an-agent
 * inference is reader work, revisable over all history.
 */
async function cliDriverFacts(scanArgs: boolean): Promise<DriverFacts> {
  let tty = false;
  try {
    tty = Deno.stdout.isTerminal();
  } catch {
    // discern-best-effort: logbook-cli-tty-fallback
    // A closed stdout reads as not-a-terminal.
  }
  let ci = false;
  try {
    const marker = Deno.env.get("CI");
    ci = marker !== undefined && marker !== "" && marker !== "false";
  } catch {
    // discern-best-effort: logbook-cli-ci-fallback
    // No env permission reads as not-CI.
  }
  let spawnedBy: string | undefined;
  try {
    const marker = Deno.env
      .get(DISCERN_ENVIRONMENT_VARIABLES.spawnedBy)?.trim();
    spawnedBy = marker === undefined || marker === "" ? undefined : marker;
  } catch {
    // discern-best-effort: logbook-cli-spawned-by-fallback
    // No env permission reads as not-spawned.
  }
  let agentSignals: AgentSignal[] | undefined;
  try {
    // Loaded when a verb actually dispatches — this module sits on every CLI
    // action's registration path, so its static graph must stay routing-thin.
    const { detectAgentSignals } = await import("./agent_signals.ts");
    agentSignals = await detectAgentSignals();
  } catch {
    // discern-best-effort: logbook-cli-agent-signals-fallback
    // Driver enrichment is best-effort and must never affect the verb.
  }
  return {
    session: `cli:${Deno.ppid}`,
    ...(scanArgs
      ? {
        json: Deno.args.includes("--json"),
        markdown: Deno.args.includes("--markdown"),
      }
      : {}),
    tty,
    ci,
    ...(agentSignals !== undefined && agentSignals.length > 0
      ? { agent_signals: agentSignals }
      : {}),
    ...(spawnedBy === undefined ? {} : { spawned_by: spawnedBy }),
  };
}

/**
 * The flag NAMES this invocation passed — `--force`, `--raw`, and kin — never
 * their values (`--name foo` records `name` alone) and never positionals. The
 * scan stops at a bare `--`, keeps only conventional flag-shaped names (so a
 * pasted path or free-text argument can never slip in), and drops the two
 * flags that already ride first-class event fields. Cliffy rejects unknown
 * flags before any verb runs, so what lands here is registry-vetted by parse.
 */
function cliFlagNames(): string[] | undefined {
  const names: string[] = [];
  for (const arg of Deno.args) {
    if (arg === "--") {
      break;
    }
    const match = /^--([a-z][a-z0-9-]*)(=|$)/.exec(arg);
    const name = match?.[1];
    if (
      name !== undefined && name !== "json" && name !== "markdown" &&
      name !== "dry-run" &&
      !names.includes(name)
    ) {
      names.push(name);
    }
  }
  return names.length > 0 ? names : undefined;
}

/**
 * The top-level verbs whose Cliffy actions route through {@link recordedExit},
 * collected at registration (building the CLI populates it without running any
 * verb). The parity guard reconciles this against the verb SSOT.
 */
export const RECORDED_CLI_VERBS: ReadonlySet<string> = recordedVerbs;
/** Exact command paths whose live execution reaches {@link recordedRun}. */
export const RECORDED_CLI_COMMAND_PATHS: ReadonlySet<string> =
  recordedCommandPaths;
/** Effectful top-level verbs with at least one action registered through the
 * begin-recording path. The verb parity guard reconciles this derived registry
 * against the canonical effectful set. */
export const BEGIN_RECORDED_CLI_VERBS: ReadonlySet<string> = beginRecordedVerbs;

/** A verb action's body: runs the verb and returns its exit code (void → 0).
 * Generic over `this` so a command-group action typed `function (this: Command)`
 * wraps without a cast. */
type VerbBody<TThis, A extends unknown[]> = (
  this: TThis,
  ...args: A
) => number | undefined | Promise<number | undefined> | void | Promise<void>;

/**
 * An expected CLI refusal raised by a lower dispatcher helper. It carries the
 * result and status upward without writing or terminating from the library.
 */
export class CliRefusal extends Error {
  readonly result: DiscernResult;
  readonly exitCode: number;

  constructor(result: DiscernResult, exitCode = 1) {
    super(result.message ?? `discern ${result.verb} refused`);
    this.name = "CliRefusal";
    this.result = result;
    this.exitCode = exitCode;
  }
}

/** Metadata known by a direct pre-Cliffy recording caller. */
export interface RecordedRunOptions {
  /** The object acted on when no result or target observer supplies one. */
  readonly target?: string;
  /** Read envelope-less slot-wait timing after the body settles. */
  readonly waitedMs?: () => number | undefined;
  /** A mixed runner received the operand that selects its effectful form. */
  readonly hasOperands?: boolean;
}

/** A failed completion contract always owns a failing process status. */
export function completionExitCode(
  reportedCode: number,
  result: DiscernResult | undefined,
): number {
  return reportedCode === 0 && result?.ok === false ? 1 : reportedCode;
}

/** Enroll a pre-Cliffy execution path that calls {@link recordedRun} directly. */
export function registerDirectRecordedCliCommandPath(command: string): void {
  recordedCommandPaths.add(command);
}

/** Whether this CLI invocation requested a serialized result projection. */
function serializedResultRequested(): boolean {
  return ["--json", "--markdown", "--render"].some((flag) =>
    Deno.args.includes(flag)
  );
}

/** Quote one raw CLI argument for a copyable POSIX-shell retry. */
function shellQuoteArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Preserve the invoked command while omitting presentation-only global flags. */
function cliReproduceCommand(): string {
  const args: string[] = [];
  for (let index = 0; index < Deno.args.length; index++) {
    const argument = Deno.args[index] ?? "";
    if (
      ["--json", "--markdown", "--render", "--no-color", "--plain"].includes(
        argument,
      )
    ) continue;
    if (argument === "--theme") {
      index++;
      continue;
    }
    if (argument.startsWith("--theme=")) continue;
    args.push(argument);
  }
  return ["discern", ...args].map(shellQuoteArgument).join(" ");
}

/** Render a lock refusal through the same CLI result boundary as the verb. */
async function routeOperationLockRefusal(
  error: import("../operation_lock.ts").OperationLockError,
): Promise<number> {
  const { withSetupResultNextAction } = await import(
    "../../shared/setup_next_action.ts"
  );
  const result = withSetupResultNextAction(
    error.result,
    cliReproduceCommand(),
  );
  if (serializedResultRequested()) {
    const { emitResult } = await import("../../shared/emit.ts");
    emitResult(result);
  } else {
    observeResult(result);
    const { Logger } = await import("../../lib/log.ts");
    new Logger({ json: false, noColor: false }).errorBlock(error.message);
  }
  return 1;
}

/** Project one expected lower-layer refusal at the CLI dispatcher boundary. */
async function routeCliRefusal(error: CliRefusal): Promise<number> {
  const { withSetupResultNextAction } = await import(
    "../../shared/setup_next_action.ts"
  );
  const result = withSetupResultNextAction(
    error.result,
    cliReproduceCommand(),
  );
  if (serializedResultRequested()) {
    const { emitResult } = await import("../../shared/emit.ts");
    emitResult(result);
  } else {
    observeResult(result);
    const { Logger } = await import("../../lib/log.ts");
    new Logger({ json: false, noColor: false }).error(
      result.message ?? error.message,
    );
  }
  return error.exitCode;
}

/** Run every CLI path through the operation policy, recorded or otherwise. */
async function runClassifiedCliOperation(
  verb: string,
  body: () => number | undefined | Promise<number | undefined>,
  options: {
    readonly flags?: readonly string[];
    readonly dryRun: boolean;
    readonly hasOperands?: boolean;
  },
): Promise<number> {
  const { OperationLockError, withOperationLock } = await import(
    "../operation_lock.ts"
  );
  const resultVerb = operationResultVerbResolver(verb);
  try {
    return (await withOperationLock(
      Deno.cwd(),
      {
        command: verb,
        ...(resultVerb === undefined ? {} : { resultVerb }),
        reproduceCmd: cliReproduceCommand(),
        ...(options.flags === undefined ? {} : { flags: options.flags }),
        ...(options.hasOperands === undefined
          ? {}
          : { hasOperands: options.hasOperands }),
        ...(options.dryRun ? { dryRun: true } : {}),
      },
      async () => (await body()) ?? 0,
    ));
  } catch (error) {
    if (error instanceof CliRefusal) {
      return await routeCliRefusal(error);
    }
    if (error instanceof OperationLockError) {
      return await routeOperationLockRefusal(error);
    }
    throw error;
  }
}

/**
 * Run one CLI verb invocation through the recorder: begin the concurrent
 * context gather, run `body`, record the event, and return the exit code. A
 * thrown error records a `failed` event and rethrows unchanged. The direct
 * entry for pre-Cliffy dispatch paths (the `scripts` namespace); Cliffy actions
 * use {@link recordedExit}.
 */
export async function recordedRun(
  verb: string,
  surface: LogbookSurface,
  body: () => number | undefined | Promise<number | undefined>,
  opts: RecordedRunOptions = {},
): Promise<number> {
  const scanArgs = verb !== "scripts";
  const flags = scanArgs ? cliFlagNames() : undefined;
  const dryRun = scanArgs && Deno.args.includes("--dry-run");
  const operationFacts = {
    ...(flags === undefined ? {} : { flags }),
    dryRun,
    ...(opts.hasOperands === undefined
      ? {}
      : { hasOperands: opts.hasOperands }),
  };
  const lockBoundary = operationEffectPolicy(verb, operationFacts)?.lock;
  const run = () => runClassifiedCliOperation(verb, body, operationFacts);
  if (!logbookInvocationIsRecorded(verb)) {
    const reportedCode = await run();
    return completionExitCode(reportedCode, takeObservedResult()?.result);
  }
  // A CLI process normally serves one verb, but the accumulators are process
  // local: clear any stale test/embedded-call state before this invocation.
  takeSupplementalHintIds();
  takeShownTipIds();
  takeCheckpointActivity();
  // The recorder reaches the git/config machinery; load it only when a verb
  // actually runs, keeping this wrapper's static graph routing-thin (a bare
  // `--help` builds the whole CLI tree through recordedExit without it).
  // Start driver enrichment before opening the recorder so an effectful
  // invocation's begin event carries the same raw signals as its completion.
  const driver = cliDriverFacts(scanArgs);
  const { beginRecording } = await import("./record.ts");
  const recording = beginRecording(Deno.cwd(), {
    verb,
    surface,
    driver,
    ...(flags !== undefined ? { flags } : {}),
    dryRun,
    ...(opts.hasOperands === undefined
      ? {}
      : { hasOperands: opts.hasOperands }),
    ...(lockBoundary === undefined ? {} : { lockBoundary }),
  });
  // Everything after a `scripts` name belongs to the child, so only normal verbs
  // may inspect this process's argv. Start driver enrichment beside the verb so
  // the host-marker stat does not extend the completion tail.
  const started = SYSTEM_CLOCK.monotonicNow();
  let code = 1;
  let crash: CrashSignature | undefined;
  try {
    throwIfCrashProbe();
    code = await run();
  } catch (err) {
    // An unexpected throw still records — outcome `failed`, plus the
    // logbook-safe signature — before propagating to the crash frame.
    crash = crashSignature(err);
    throw err;
  } finally {
    const observed = takeObservedResult();
    const supplementalHintIds = takeSupplementalHintIds();
    const tipIds = takeShownTipIds();
    const checkpointActivity = takeCheckpointActivity();
    const target = takeVerbTarget() ?? opts.target;
    // A preview leaves the envelope's own dry_run mark; the argv flag is the
    // fallback for human-mode previews. The `scripts` namespace is excluded from
    // every argv scan (dry-run, --json, flag names) — everything after the
    // script name belongs to the child, so a child's own flags must not
    // mislabel the event.
    const result = observed?.result;
    code = completionExitCode(code, result);
    const waitedMs = result?.waitedMs ?? opts.waitedMs?.();
    const observedDryRun = result?.dry_run === true || dryRun;
    await recording.finish({
      verb,
      surface,
      outcome: code === 0 ? "ok" : "failed",
      durationMs: SYSTEM_CLOCK.monotonicNow() - started,
      ...(waitedMs !== undefined ? { waitedMs } : {}),
      driver: await driver,
      ...(result !== undefined ? { result } : {}),
      hintIds: [
        ...new Set([
          ...(observed?.hintIds ?? []),
          ...supplementalHintIds,
        ]),
      ],
      ...(tipIds.length > 0 ? { tipIds } : {}),
      ...(checkpointActivity !== undefined
        ? { checkpoints: checkpointActivity }
        : {}),
      ...(observedDryRun ? { dryRun: true } : {}),
      ...(flags !== undefined ? { flags } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(crash !== undefined ? { crash } : {}),
    });
  }
  return code;
}

/**
 * Wrap a Cliffy action so the invocation records one logbook event and exits
 * through the one shared exit point. `verb` is the display form ("done",
 * "worktree drop", "config set"); its first word is the top-level verb the
 * parity registry collects. `this` is forwarded, so a command-group action
 * (`this.showHelp()`) wraps like any other; a void return exits 0.
 */
export function recordedExit<TThis, A extends unknown[]>(
  verb: string,
  body: VerbBody<TThis, A>,
): (this: TThis, ...args: A) => Promise<void> {
  const top = verb.split(" ")[0];
  recordedCommandPaths.add(verb);
  if (top !== undefined && top !== "") {
    recordedVerbs.add(top);
    if (LOGBOOK_EFFECTFUL_VERBS.has(top)) {
      beginRecordedVerbs.add(top);
    }
  }
  return async function (this: TThis, ...args: A): Promise<void> {
    Deno.exit(
      await recordedRun(
        verb,
        "cli",
        async () => (await body.apply(this, args)) ?? 0,
      ),
    );
  };
}
