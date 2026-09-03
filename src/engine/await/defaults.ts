export {
  AWAIT_CALL_SECONDS,
  AWAIT_LONG_CALL_SECONDS,
  AWAIT_STRICT_CALL_SECONDS,
} from "../../shared/mcp_timeout_policy.ts";
import { EXIT_AWAIT_TIMEOUT } from "../../shared/exit_codes.ts";

/** CLI exit code for a wait that ended "not yet" — distinct from 1 (a refusal
 * or error) so shells can branch three ways; the envelope stays `ok: true`. */
export const AWAIT_TIMEOUT_EXIT_CODE = EXIT_AWAIT_TIMEOUT;

/** The slow re-evaluation cadence backing up the file watcher, which is
 * platform-flaky by reputation — every condition is re-checked at least this
 * often, so a missed filesystem event costs seconds, never the whole wait. */
export const AWAIT_POLL_INTERVAL_MS = 2000;
