/**
 * A launcher that fails while the Desk owns the screen: the browser opens
 * beside the screen, so the failing child's exit and its error output must
 * leave the session's terminal modes and input as they were. The success
 * path and the reader's words are held by the fake-terminal runtime tests.
 */
import { realPtyTest } from "./real_pty.ts";
import { releaseDeskJourney } from "./fixtures/release_desk_journey.ts";

realPtyTest({
  name:
    "a failing release-page launcher leaves the Desk's screen and input live",
  contracts: [
    "line-discipline",
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
  ],
  canary: false,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await releaseDeskJourney({ columns: 100, rows: 28 }, true);
  },
});
