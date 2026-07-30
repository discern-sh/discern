/** Minimum evidence-priced wait once the observed duration is nearly spent. */
export const AWAIT_TIMING_MIN_SECONDS = 30;

/** First-run bound while work is active but the repository has no prior. */
export const AWAIT_TIMING_NO_PRIOR_SECONDS = 600;

/** Bound when no active work can price the wait, or the logbook is off. */
export const AWAIT_TIMING_IDLE_SECONDS = 300;

/** CLI exit code for a wait that ended "not yet" — distinct from 1 (a refusal
 * or error) so shells can branch three ways; the envelope stays `ok: true`. */
export const AWAIT_TIMEOUT_EXIT_CODE = 124;

/** The slow re-evaluation cadence backing up the file watcher, which is
 * platform-flaky by reputation — every condition is re-checked at least this
 * often, so a missed filesystem event costs seconds, never the whole wait. */
export const AWAIT_POLL_INTERVAL_MS = 2000;
