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
 * every `--json` run and the gate entry points feed it in human mode. A verb
 * that surfaces no envelope still records a minimal event.
 */

import {
  takeObservedResult,
  takeSupplementalHintIds,
  takeVerbTarget,
} from "../../shared/result_capture.ts";
import type { DriverFacts, LogbookSurface } from "./schema.ts";
import type { AgentSignal } from "./agent_signals.ts";
import { LOGBOOK_EFFECTFUL_VERBS } from "../../shared/verbs.ts";

const recordedVerbs = new Set<string>();
const beginRecordedVerbs = new Set<string>();

/**
 * The CLI's raw driver signals — evidence for the who-drove-this question,
 * gathered here because only the surface knows them: the parent process id (a
 * session grouping hint — one conversation's invocations share a parent even
 * when every task shares a branch), whether `--json` was requested (agents
 * pass it per the guidance; humans rarely do), whether stdout is a terminal,
 * whether the conventional CI marker is set, and every advisory identity marker
 * the shared catalogue recognizes. Facts only; marker values never land, and
 * scoring them into an is-this-an-agent inference is reader work, revisable over
 * all history.
 */
async function cliDriverFacts(scanArgs: boolean): Promise<DriverFacts> {
  let tty = false;
  try {
    tty = Deno.stdout.isTerminal();
  } catch {
    // A closed stdout reads as not-a-terminal.
  }
  let ci = false;
  try {
    const marker = Deno.env.get("CI");
    ci = marker !== undefined && marker !== "" && marker !== "false";
  } catch {
    // No env permission reads as not-CI.
  }
  let agentSignals: AgentSignal[] | undefined;
  try {
    // Loaded when a verb actually dispatches — this module sits on every CLI
    // action's registration path, so its static graph must stay routing-thin.
    const { detectAgentSignals } = await import("./agent_signals.ts");
    agentSignals = await detectAgentSignals();
  } catch {
    // Driver enrichment is best-effort and must never affect the verb.
  }
  return {
    session: `cli:${Deno.ppid}`,
    ...(scanArgs ? { json: Deno.args.includes("--json") } : {}),
    tty,
    ci,
    ...(agentSignals !== undefined && agentSignals.length > 0
      ? { agent_signals: agentSignals }
      : {}),
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
      name !== undefined && name !== "json" && name !== "dry-run" &&
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
): Promise<number> {
  // A CLI process normally serves one verb, but the accumulator is process
  // local: clear any stale test/embedded-call state before this invocation.
  takeSupplementalHintIds();
  // The recorder reaches the git/config machinery; load it only when a verb
  // actually runs, keeping this wrapper's static graph routing-thin (a bare
  // `--help` builds the whole CLI tree through recordedExit without it).
  // Start driver enrichment before opening the recorder so an effectful
  // invocation's begin event carries the same raw signals as its completion.
  const scanArgs = verb !== "scripts";
  const driver = cliDriverFacts(scanArgs);
  const flags = scanArgs ? cliFlagNames() : undefined;
  const { beginRecording } = await import("./record.ts");
  const recording = beginRecording(Deno.cwd(), {
    verb,
    surface,
    driver,
    ...(flags !== undefined ? { flags } : {}),
  });
  // Everything after a `scripts` name belongs to the child, so only normal verbs
  // may inspect this process's argv. Start driver enrichment beside the verb so
  // the host-marker stat does not extend the completion tail.
  const started = performance.now();
  let code = 1;
  try {
    code = (await body()) ?? 0;
  } finally {
    const observed = takeObservedResult();
    const supplementalHintIds = takeSupplementalHintIds();
    const target = takeVerbTarget();
    // A preview leaves the envelope's own dry_run mark; the argv flag is the
    // fallback for human-mode previews. The `scripts` namespace is excluded from
    // every argv scan (dry-run, --json, flag names) — everything after the
    // script name belongs to the child, so a child's own flags must not
    // mislabel the event.
    const result = observed?.result;
    const dryRun = result?.dry_run === true ||
      (scanArgs && Deno.args.includes("--dry-run"));
    await recording.finish({
      verb,
      surface,
      outcome: code === 0 ? "ok" : "failed",
      durationMs: performance.now() - started,
      driver: await driver,
      ...(result !== undefined ? { result } : {}),
      hintIds: [
        ...new Set([
          ...(observed?.hintIds ?? []),
          ...supplementalHintIds,
        ]),
      ],
      ...(dryRun ? { dryRun: true } : {}),
      ...(flags !== undefined ? { flags } : {}),
      ...(target !== undefined ? { target } : {}),
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
