/**
 * The sole capability for a promise whose lifecycle deliberately outlives the
 * caller's sequence. Ordinary promise effects are awaited, returned, or stored;
 * every call here consumes one exact registry row and installs rejection
 * handling before returning.
 */

/** The synchronous authority that receives one detached rejection. */
export type DetachedPromiseRejectionAuthority =
  | "console.error"
  | "globalThis.reportError"
  | "terminateCrash";

/** One exact promise effect whose lifecycle belongs somewhere other than its caller. */
export interface DetachedPromiseBoundary {
  /** Repository-relative module containing the live capability call. */
  readonly path: string;
  /** Stable function or method surrounding the live capability call. */
  readonly enclosingFunction: string;
  /** Concrete asynchronous operation transferred out of caller sequencing. */
  readonly operation: string;
  /** Runtime component that owns completion after the caller returns. */
  readonly lifecycleOwner: string;
  /** Synchronous authority that receives a rejection from the detached effect. */
  readonly rejectionPolicy: {
    readonly kind: "report" | "terminate";
    readonly authority: DetachedPromiseRejectionAuthority;
  };
  /** Who cancels or bounds the effect when its owning lifecycle shuts down. */
  readonly cancellationOwnership: string;
  /** Why awaiting at the call site would change the intended sequencing. */
  readonly reason: string;
}

/** Preserve literal IDs while checking the complete registry shape. */
function defineDetachedPromiseBoundaries<
  const Boundaries extends Readonly<Record<string, DetachedPromiseBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Every production promise deliberately transferred to a longer-lived owner. */
export const DETACHED_PROMISE_BOUNDARIES = defineDetachedPromiseBoundaries({
  "canon-editor-guard-run": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "runGuards",
    operation:
      "run the selected Canon Editor guard files and publish the report",
    lifecycleOwner: "the Canon Editor server session",
    rejectionPolicy: { kind: "report", authority: "console.error" },
    cancellationOwnership:
      "the guard command owns its subprocess lifetime; editor shutdown leaves an already-started run to the enclosing tool process",
    reason:
      "the HTTP action starts a guard run and must keep serving status and change-feed requests while that run completes",
  },
  "canon-editor-watch-refresh": {
    path: "scripts/canon_editor/server.ts",
    enclosingFunction: "startCanonEditor",
    operation:
      "refresh the Canon Editor snapshot after a watched source changes",
    lifecycleOwner: "the Canon Editor filesystem-watch loop",
    rejectionPolicy: { kind: "report", authority: "console.error" },
    cancellationOwnership:
      "server shutdown closes and awaits the watcher loop; an already-fired debounce belongs to the tool process",
    reason:
      "the debounce callback must release the timer queue immediately while refresh completion updates the shared editor snapshot",
  },
  "job-output-reader-cancel-detach": {
    path: "src/engine/jobs/command.ts",
    enclosingFunction: "onAbort",
    operation: "cancel a job output reader after the killed-pipe grace expires",
    lifecycleOwner: "the aborted job's pipe-drain deadline",
    rejectionPolicy: {
      kind: "report",
      authority: "globalThis.reportError",
    },
    cancellationOwnership:
      "the abort path owns the grace timer; the surrounding job settlement awaits the affected drain and clears the timer",
    reason:
      "cancelling every blocked reader must start together from the timer callback so one slow cancellation cannot serialize the others",
  },
  "main-error-event-crash": {
    path: "src/main.ts",
    enclosingFunction: "<module>",
    operation: "render and terminate after an uncaught global error event",
    lifecycleOwner: "the top-level process crash boundary",
    rejectionPolicy: { kind: "terminate", authority: "terminateCrash" },
    cancellationOwnership:
      "process termination is the lifecycle boundary; a failure inside crash rendering terminates immediately through terminateCrash",
    reason:
      "a synchronous global event listener cannot await while the crash path must still write its artifact and frame before terminating",
  },
  "main-unhandled-rejection-crash": {
    path: "src/main.ts",
    enclosingFunction: "<module>",
    operation: "render and terminate after a global unhandled-rejection event",
    lifecycleOwner: "the top-level process crash boundary",
    rejectionPolicy: { kind: "terminate", authority: "terminateCrash" },
    cancellationOwnership:
      "process termination is the lifecycle boundary; a failure inside crash rendering terminates immediately through terminateCrash",
    reason:
      "a synchronous global event listener cannot await while the crash path must still write its artifact and frame before terminating",
  },
  "mcp-stdin-transport-close": {
    path: "src/engine/mcp/server.ts",
    enclosingFunction: "runMcpServer",
    operation: "close the MCP transport when its stdin pipe ends",
    lifecycleOwner: "the MCP stdio transport shutdown sequence",
    rejectionPolicy: {
      kind: "report",
      authority: "globalThis.reportError",
    },
    cancellationOwnership:
      "stdin EOF aborts in-flight work and transport.onclose resolves the closed promise awaited by runMcpServer",
    reason:
      "the synchronous Node stdin event cannot await, while runMcpServer separately waits for the transport's close lifecycle",
  },
  "site-preview-control-shutdown": {
    path: "site/dev.ts",
    enclosingFunction: "managedHandler",
    operation:
      "shut down the replaced local preview after its control response",
    lifecycleOwner: "the managed site preview server",
    rejectionPolicy: { kind: "report", authority: "console.error" },
    cancellationOwnership:
      "the server owns shutdown completion and runLocalSite awaits server.finished after the accepted control response",
    reason:
      "shutdown starts in a microtask so the authenticated control request can return its accepted response before the server stops",
  },
  "site-watch-rebuild": {
    path: "site/dev.ts",
    enclosingFunction: "watchSiteBuildInputs",
    operation: "rebuild the local site after the watch debounce expires",
    lifecycleOwner: "the local site's filesystem-watch loop",
    rejectionPolicy: { kind: "report", authority: "console.error" },
    cancellationOwnership:
      "the watch process owns the rebuild; its serialization latch coalesces later events and process shutdown bounds the lifecycle",
    reason:
      "the debounce callback must release the timer queue while the rebuild latch preserves intentional serial rebuilds",
  },
  "subprocess-output-reader-cancel-detach": {
    path: "src/shared/subprocess.ts",
    enclosingFunction: "cancel",
    operation: "cancel one bounded subprocess output reader on capture abort",
    lifecycleOwner: "the bounded child-output capture",
    rejectionPolicy: {
      kind: "report",
      authority: "globalThis.reportError",
    },
    cancellationOwnership:
      "the capture AbortSignal owns cancellation and boundedChildOutput awaits the reader task before returning",
    reason:
      "AbortSignal listeners are synchronous and must initiate cancellation without delaying the other stream or termination path",
  },
  "worktree-shell-drain-cancel-detach": {
    path: "src/engine/worktree/shell.ts",
    enclosingFunction: "boundDrains",
    operation:
      "cancel a worktree shell output reader after the killed-pipe grace expires",
    lifecycleOwner: "the interrupted worktree shell's pipe-drain deadline",
    rejectionPolicy: {
      kind: "report",
      authority: "globalThis.reportError",
    },
    cancellationOwnership:
      "the interrupt path owns the grace timer; settleCaptured awaits the affected drain and clears the timer",
    reason:
      "cancelling every blocked reader must start together from the timer callback so one slow cancellation cannot serialize the others",
  },
});

/** One compile-time-valid detached promise boundary id. */
export type DetachedPromiseBoundaryId =
  keyof typeof DETACHED_PROMISE_BOUNDARIES;

/** A synchronous rejection authority selected by the boundary registry. */
export type DetachedPromiseReporter = (error: unknown) => void;

/** Keep the already-handled chain alive without exposing a general escape hatch. */
function ownHandledPromise(_handled: Promise<unknown>): void {
  // The rejection callback attached before this call cannot throw: reporter
  // failures are rethrown as global errors, outside the promise channel.
}

/** Surface a reporter failure without converting it into another rejection. */
function throwReporterFailure(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

/** Invoke the elected synchronous authority without creating a rejected chain. */
function reportDetachedRejection(
  reporter: DetachedPromiseReporter,
  error: unknown,
): void {
  try {
    reporter(error);
  } catch (reporterError) {
    throwReporterFailure(reporterError);
  }
}

/**
 * Transfer one promise effect to its registered lifecycle owner.
 *
 * The thunk, when supplied, starts synchronously. The returned promise is
 * normalized and receives its rejection callback before this function returns;
 * even a synchronously thrown thunk or reporter failure reaches an explicit
 * global error path rather than an unhandled promise rejection.
 */
export function detachPromise(
  boundaryId: DetachedPromiseBoundaryId,
  promiseOrThunk: PromiseLike<unknown> | (() => PromiseLike<unknown>),
  reporter: DetachedPromiseReporter,
): void {
  if (!Object.hasOwn(DETACHED_PROMISE_BOUNDARIES, boundaryId)) {
    throw new TypeError(`unknown detached promise boundary '${boundaryId}'`);
  }
  let promise: PromiseLike<unknown>;
  try {
    promise = typeof promiseOrThunk === "function"
      ? promiseOrThunk()
      : promiseOrThunk;
  } catch (error) {
    reportDetachedRejection(reporter, error);
    return;
  }
  const handled = Promise.resolve(promise).then(
    undefined,
    (error): void => reportDetachedRejection(reporter, error),
  );
  ownHandledPromise(handled);
}

/** The validated census value consumed by the falling Standard. */
export function detachedPromiseBoundaryCount(): number {
  return Object.keys(DETACHED_PROMISE_BOUNDARIES).length;
}
