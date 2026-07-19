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

import { takeObservedResult } from "../../shared/result_capture.ts";
import type { LogbookSurface } from "./schema.ts";
import { beginRecording } from "./record.ts";

const recordedVerbs = new Set<string>();

/**
 * The top-level verbs whose Cliffy actions route through {@link recordedExit},
 * collected at registration (building the CLI populates it without running any
 * verb). The parity guard reconciles this against the verb SSOT.
 */
export const RECORDED_CLI_VERBS: ReadonlySet<string> = recordedVerbs;

/** A verb action's body: runs the verb and returns its exit code (void → 0). */
type VerbBody<A extends unknown[]> = (
  this: unknown,
  ...args: A
) => number | undefined | Promise<number | undefined> | void | Promise<void>;

/**
 * Run one CLI verb invocation through the recorder: begin the concurrent
 * context gather, run `body`, record the event, and return the exit code. A
 * thrown error records a `failed` event and rethrows unchanged. The direct
 * entry for pre-Cliffy dispatch paths (the `script` namespace); Cliffy actions
 * use {@link recordedExit}.
 */
export async function recordedRun(
  verb: string,
  surface: LogbookSurface,
  body: () => number | undefined | Promise<number | undefined>,
): Promise<number> {
  const recording = beginRecording(Deno.cwd());
  const started = performance.now();
  let code = 1;
  try {
    code = (await body()) ?? 0;
  } finally {
    const observed = takeObservedResult();
    // A preview leaves the envelope's own dry_run mark; the argv flag is the
    // fallback for human-mode previews. The `script` namespace is excluded from
    // the argv check — everything after the script name belongs to the child,
    // so a child's own --dry-run must not mislabel the event.
    const dryRun = observed?.dry_run === true ||
      (verb !== "script" && Deno.args.includes("--dry-run"));
    await recording.finish({
      verb,
      surface,
      outcome: code === 0 ? "ok" : "failed",
      durationMs: performance.now() - started,
      ...(observed !== undefined ? { result: observed } : {}),
      ...(dryRun ? { dryRun: true } : {}),
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
export function recordedExit<A extends unknown[]>(
  verb: string,
  body: VerbBody<A>,
): (this: unknown, ...args: A) => Promise<void> {
  const top = verb.split(" ")[0];
  if (top !== undefined && top !== "") {
    recordedVerbs.add(top);
  }
  return async function (this: unknown, ...args: A): Promise<void> {
    Deno.exit(
      await recordedRun(
        verb,
        "cli",
        async () => (await body.apply(this, args)) ?? 0,
      ),
    );
  };
}
