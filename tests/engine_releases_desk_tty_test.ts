import { realPtyTest } from "./real_pty.ts";
import { releaseDeskJourney } from "./fixtures/release_desk_journey.ts";
for (const failure of [false, true]) {
  realPtyTest({
    name:
      `Release Desk activation retains its URL and restores live input after launcher ${
        failure ? "failure" : "success"
      }`,
    contracts: [
      "line-discipline",
      "terminal-modes",
      "control-rendering",
      "process-lifecycle",
    ],
    canary: false,
    ignore: Deno.build.os === "windows",
    fn: async () => {
      await releaseDeskJourney({ columns: 100, rows: 28 }, failure);
    },
  });
}
