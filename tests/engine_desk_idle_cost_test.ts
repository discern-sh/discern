/**
 * What an idle Desk costs, and how soon it shows a real change.
 *
 * A production Desk session runs over a real fleet on a fake terminal and a
 * manual clock, inside the Git discovery scope the CLI's operation boundary
 * gives a session: the fingerprint and the survey are the real ones, the
 * probe's Git processes are counted through its runner, which the
 * fingerprint's own test proves sees every one, and paints are counted from
 * what the terminal received. Over a minute in which nothing changes, every
 * cadence but the ceiling's is a check, and nothing is repainted. A commit in
 * a task then shows on the next cadence.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DESK_REFRESH_MS,
  DESK_SURVEY_CEILING_MS,
} from "../src/engine/desk/desk_state.ts";
import { DESK_SELECTION_SETTLE_MS } from "../src/engine/desk/live.ts";
import {
  FLEET_FINGERPRINT_GIT,
  fleetFingerprint,
  type FleetFingerprintGit,
} from "../src/engine/status/fleet_fingerprint.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { withGitDiscoveryScope } from "../src/shared/git_discovery.ts";
import {
  clockScheduler,
  deskSession,
  deskTranscript,
} from "./fixtures/desk_session.ts";
import { ManualTerminalClock } from "discern-design-system/cli/interactive/testing";
import type { Scheduler } from "../src/shared/scheduler.ts";
import {
  createDeskTtyProject,
  deskFleetEntry,
  deskFleetFixture,
  deskProof,
} from "./fixtures/desk_tty_harness.ts";
import { git } from "./engine_helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { withTempDir } from "./temp_dir.ts";
import { join } from "@std/path";

const DAY = 86_400_000;

/** One idle minute: every cadence, the last of which meets the ceiling. */
const IDLE_CADENCES = DESK_SURVEY_CEILING_MS / DESK_REFRESH_MS;

/**
 * The idle budget per minute: a check each cadence until the ceiling, one
 * survey at it, and nothing written to the terminal, since nothing the Desk
 * shows has changed.
 */
const IDLE_BUDGET = {
  checks: IDLE_CADENCES - 1,
  surveys: 1,
  writes: 0,
} as const;

/** Tasks at rest for days, so no age the Desk shows turns over in a minute. */
const FLEET = deskFleetFixture([
  deskFleetEntry("resting-a1b2c3", {
    aheadCommits: 1,
    idleMs: 2 * DAY,
    proof: deskProof(),
  }),
  deskFleetEntry("waiting-b2c3d4", { aheadCommits: 2, idleMs: 3 * DAY }),
]);

Deno.test("an idle Desk checks its fleet within budget and shows a commit on the next cadence", async () => {
  await withTempDir(async (parent) => {
    const project = await createDeskTtyProject(parent, FLEET);
    // The CLI's operation boundary holds one Git discovery scope for a whole
    // session, which retains the common directory every check needs.
    await withGitDiscoveryScope(async () => {
      // The Desk opens only where Git names the main checkout, by its real path.
      const root = await Deno.realPath(project.root);
      const checkouts = project.worktrees.size + 1;
      let probeGit = 0;
      let probes = 0;
      let surveys = 0;
      const counted: FleetFingerprintGit = (args, cwd) => {
        probeGit += 1;
        return FLEET_FINGERPRINT_GIT(args, cwd);
      };
      // The session's wall time moves only with its manual clock, and every
      // read that settles schedules the next cadence on it.
      const clock = new ManualTerminalClock();
      const start = SYSTEM_CLOCK.wallNow();
      const timers = clockScheduler(clock);
      let cadencesScheduled = 0;
      const scheduler: Scheduler = {
        ...timers,
        scheduleTimeout: (callback, delayMs) => {
          if (delayMs === DESK_REFRESH_MS) cadencesScheduled += 1;
          return timers.scheduleTimeout(callback, delayMs);
        },
      };
      /** Let one cadence come round and wait for its read to settle. */
      const cadence = async (): Promise<void> => {
        const scheduled = cadencesScheduled;
        desk.advance(DESK_REFRESH_MS);
        await desk.until(
          () => cadencesScheduled > scheduled,
          "the cadence's read to settle",
        );
      };
      const desk = await deskSession({
        production: true,
        cliModel: TEST_CLI_MODEL,
        clock,
        runtime: {
          canInteract: () => true,
          inDeskSession: () => false,
          findRoot: () => root,
          makeOut: () => deskTranscript().out,
          pause: () => {},
          now: () => start + clock.now(),
          scheduler,
          status: async (root) => {
            surveys += 1;
            return await statusResult(root, { all: true });
          },
          probe: async (root) => {
            probes += 1;
            return await fleetFingerprint(root, counted);
          },
        },
      });
      try {
        await desk.select("resting-a1b2c3");
        // The first survey's own reads create discern's operation lock, which
        // the next check sees once; the Desk is at rest after it.
        await desk.until(() => cadencesScheduled > 0, "the first survey");
        await cadence();
        const before = {
          probes,
          probeGit,
          surveys,
          writes: desk.io.writes.length,
        };
        for (let tick = 0; tick < IDLE_CADENCES; tick += 1) await cadence();
        const spent = {
          checks: probes - before.probes - (surveys - before.surveys),
          surveys: surveys - before.surveys,
          writes: desk.io.writes.length - before.writes,
        };
        assertEquals(spent, IDLE_BUDGET, desk.screen());
        assertEquals(
          probeGit - before.probeGit,
          (spent.checks + spent.surveys) * (checkouts + 2),
          "each read fingerprints the fleet for one Git process per checkout plus two",
        );

        const task = project.worktrees.get("resting-a1b2c3");
        assert(task !== undefined);
        await Deno.writeTextFile(join(task, "probe.txt"), "a real change\n");
        await git(task, "add", "probe.txt");
        await git(task, "commit", "-m", "Record a real change");
        const surveyed = surveys;
        await cadence();
        assertEquals(
          surveys,
          surveyed + 1,
          "a moved fingerprint surveys at once",
        );
        desk.advance(DESK_SELECTION_SETTLE_MS);
        await desk.shows("Record a real change");
      } catch (error) {
        desk.io.close();
        await desk.exit.catch(() => undefined);
        throw error;
      }
      assertEquals(await desk.quit(), 0, "the Desk quits cleanly");
    });
  }, { prefix: "discern-desk-idle-" });
});
