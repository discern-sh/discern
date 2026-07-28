/**
 * `await`'s surface constants, in a zero-import module: the CLI registers its
 * help text at every spawn and must name the default timeout without loading
 * the verb's implementation graph (verb bodies lazy-import by design), so the
 * numbers live here and `await.ts` builds on them.
 *
 * The defaults follow one rule: each calling surface's default sits just under
 * the ceiling that would kill the call there, with explicit headroom (the
 * per-surface research and margins live in the decision record):
 *
 *  - CLI: agent harnesses run shell commands under a default budget of about
 *    two minutes; 100s returns the "not yet" answer before the harness kills
 *    the process and the caller learns nothing.
 *  - MCP: the strictest common client enforces the 60s reference-SDK request
 *    timeout with no configuration and no progress extension; 45s keeps the
 *    whole call — spawn, wait, serialize — inside that budget.
 *
 * Never derived from `[gate].timeout`: that bounds one command inside a
 * SIBLING's gate, while this wait spans queueing plus that gate's whole wall
 * clock — the only ceiling that can kill `await` is the caller's own. Bounded
 * slices compose: a caller that wants a longer watch calls again, told when.
 */

/** Default `--timeout` for a CLI invocation, in seconds. */
export const AWAIT_CLI_DEFAULT_TIMEOUT_SECONDS = 100;

/** Default timeout for an MCP `discern_await` call, in seconds. */
export const AWAIT_MCP_DEFAULT_TIMEOUT_SECONDS = 45;

/** CLI exit code for a wait that ended "not yet" — distinct from 1 (a refusal
 * or error) so shells can branch three ways; the envelope stays `ok: true`. */
export const AWAIT_TIMEOUT_EXIT_CODE = 124;

/** The slow re-evaluation cadence backing up the file watcher, which is
 * platform-flaky by reputation — every condition is re-checked at least this
 * often, so a missed filesystem event costs seconds, never the whole wait. */
export const AWAIT_POLL_INTERVAL_MS = 2000;
