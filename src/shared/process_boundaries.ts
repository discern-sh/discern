/**
 * Exact production boundaries that may write to a process stream or terminate
 * the process. Every row binds one direct primitive by path, enclosing function,
 * and operation; the structural census rejects both unknown sites and stale rows.
 */

/** The physical channel owned by one direct output boundary. */
export type ProcessOutputChannel = "stdout" | "stderr" | "stdout-or-stderr";

/** One exact direct process-output primitive. */
export interface ProcessOutputBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: string;
  readonly channel: ProcessOutputChannel;
  readonly purpose: string;
  readonly reason: string;
}

/** One exact direct process-termination primitive. */
export interface ProcessExitBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: "Deno.exit";
  readonly exitPurpose: string;
  readonly reason: string;
}

/**
 * The only direct output primitives under `src/`. Higher layers compose output
 * through `DiscernResult`, `Logger`, or `Out`; these rows are their final process
 * adapters, not module-wide exemptions.
 */
export const PROCESS_OUTPUT_BOUNDARIES = {
  "engine-byte-stream": {
    path: "src/engine/output.ts",
    enclosingFunction: "byteWriter",
    operation: "Deno.stdout-or-stderr.writeSync",
    channel: "stdout-or-stderr",
    purpose: "deliver already-composed job bytes to the selected human stream",
    reason:
      "the gate runner preserves captured child bytes at the engine output adapter after result-mode suppression is decided",
  },
  "engine-stderr-text": {
    path: "src/engine/output.ts",
    enclosingFunction: "writeStderr",
    operation: "Deno.stderr.writeSync",
    channel: "stderr",
    purpose: "deliver already-composed engine narration and diagnostics",
    reason:
      "the engine narration sink needs a synchronous full-write adapter so ordering and partial writes remain explicit",
  },
  "engine-stdout-text": {
    path: "src/engine/output.ts",
    enclosingFunction: "writeStdout",
    operation: "Deno.stdout.writeSync",
    channel: "stdout",
    purpose: "deliver already-composed engine content and narration",
    reason:
      "the engine output sink and raw content contracts share one synchronous full-write adapter",
  },
  "installer-stderr-line": {
    path: "src/lib/log.ts",
    enclosingFunction: "stderr",
    operation: "console.error",
    channel: "stderr",
    purpose: "deliver one Logger alert or stderr narration line",
    reason:
      "Logger is the installer composition authority and its line adapter preserves console-based test interception",
  },
  "installer-stdout-line": {
    path: "src/lib/log.ts",
    enclosingFunction: "stdout",
    operation: "console.log",
    channel: "stdout",
    purpose: "deliver one Logger content or stdout narration line",
    reason:
      "Logger is the installer composition authority and its line adapter preserves console-based test interception",
  },
  "result-envelope-stdout": {
    path: "src/shared/emit.ts",
    enclosingFunction: "emitResult",
    operation: "console.log",
    channel: "stdout",
    purpose:
      "emit the selected DiscernResult projection as the complete quiet result",
    reason:
      "emitResult is the sole CLI result chokepoint and deliberately owns the projection's terminating newline",
  },
} as const satisfies Readonly<Record<string, ProcessOutputBoundary>>;

/**
 * The only direct `Deno.exit` sites under `src/`. Ordinary libraries return or
 * throw typed state; only the CLI dispatcher, parser, crash, and signal edges
 * terminate the host process.
 */
export const PROCESS_EXIT_BOUNDARIES = {
  "cli-action-result": {
    path: "src/engine/logbook/cli.ts",
    enclosingFunction: "recordedExit",
    operation: "Deno.exit",
    exitPurpose: "apply one recorded Cliffy action's returned exit code",
    reason:
      "the CLI action interceptor is the dispatcher boundary shared by every registered verb action",
  },
  "cli-validation-refusal": {
    path: "src/main.ts",
    enclosingFunction: "handleCliValidationError",
    operation: "Deno.exit",
    exitPurpose: "stop Cliffy after a validation refusal has been projected",
    reason:
      "Cliffy validation callbacks cannot return an exit code to main and must terminate after owning the refusal output",
  },
  "crash-frame-failure": {
    path: "src/main.ts",
    enclosingFunction: "terminateCrash",
    operation: "Deno.exit",
    exitPurpose:
      "leave after the crash artifact and terminal or result frame settle",
    reason:
      "the last-resort crash boundary must terminate even when crash reporting itself re-enters",
  },
  "main-dispatch-result": {
    path: "src/main.ts",
    enclosingFunction: "runMainProcess",
    operation: "Deno.exit",
    exitPurpose: "apply the top-level dispatcher's returned process status",
    reason:
      "the executable module converts main's typed return code into process state exactly once",
  },
  "signal-reraise-fallback": {
    path: "src/engine/process_signals.ts",
    enclosingFunction: "reraiseInterrupt",
    operation: "Deno.exit",
    exitPurpose:
      "preserve conventional signal status when self-signalling does not terminate",
    reason:
      "signal propagation must remain fail-fast after owned children settle even when the platform cannot re-raise the signal",
  },
} as const satisfies Readonly<Record<string, ProcessExitBoundary>>;

/** Count of exact output exceptions held by the falling Standard. */
export function processOutputBoundaryCount(): number {
  return Object.keys(PROCESS_OUTPUT_BOUNDARIES).length;
}

/** Count of exact exit exceptions held by the falling Standard. */
export function processExitBoundaryCount(): number {
  return Object.keys(PROCESS_EXIT_BOUNDARIES).length;
}
