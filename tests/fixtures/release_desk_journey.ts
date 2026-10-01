/** Executed production CLI journey with fake native launchers and retained viewport evidence. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  inspectReleaseCheck,
  releaseReminderDue,
  writeReleaseCheck,
} from "../../src/shared/release_check.ts";
import { SYSTEM_CLOCK } from "../../src/shared/clock.ts";
import { DISCERN_VERSION } from "../../src/lib/version.ts";
import { writeExecutable } from "../engine_helpers.ts";
import {
  deskFleetFixture,
  deskFocused,
  type DeskFrameTest,
  deskLayerOpen,
  deskSettledPhase as phase,
  deskShowing,
  type DeskTtyInputPhase,
  type DeskTtyRunResult,
  runDeskTty,
  withDeskTtyProject,
} from "./desk_tty_harness.ts";
import type { PtyGeometry } from "./pty_process.ts";

/** Both tests hold. */
function both(left: DeskFrameTest, right: DeskFrameTest): DeskFrameTest {
  return (capture) => left(capture) && right(capture);
}

/** The screen shows every one of `texts`. */
function showing(...texts: readonly string[]): DeskFrameTest {
  return (capture) => texts.every((text) => capture.text.includes(text));
}

/** The same action/result/return path supports the test and personally reviewed gallery. */
export async function releaseDeskJourney(
  geometry: PtyGeometry,
  failure: boolean,
  resize = false,
): Promise<DeskTtyRunResult> {
  return await withDeskTtyProject(deskFleetFixture([]), async (project) => {
    const bin = join(project.parent, "browser-bin");
    const log = join(project.parent, "launches");
    await Deno.mkdir(bin);
    for (const command of ["open", "xdg-open", "wslview"]) {
      await writeExecutable(
        join(bin, command),
        `#!/bin/sh\nprintf '%s\\n' "$@" >> "$RELEASE_LAUNCH_LOG"\n${
          failure
            ? "echo 'Browser unavailable in fixture' >&2\nexit 7"
            : "exit 0"
        }\n`,
      );
    }
    await writeReleaseCheck(
      project.root,
      undefined,
      Date.parse("2000-01-01T00:00:00Z"),
    );
    const resized = resize ? { columns: 40, rows: 20 } : geometry;
    const review = "review-updates-review";
    const empty = deskShowing("No tasks yet");
    const palette = deskLayerOpen("palette");
    // Ready markers come from the settled application's state, never elapsed
    // sleep. Below 40 columns the palette row truncates, so only its start is
    // asserted.
    const due = geometry.columns < 40 ? "check" : "check due";
    // The release information reader, once the page has been handed over:
    // its loading line gives way to what the browser did.
    const result = both(
      deskLayerOpen("reader-opened"),
      (capture) =>
        capture.text.includes("Release information") &&
        !capture.text.includes("Opening the release page"),
    );
    const leave = { keys: ["escape" as const], allowLoneEscape: true };
    const input: DeskTtyInputPhase[] = [
      phase(geometry, "empty", "the empty Desk", empty, { keys: ["ctrl-k"] }),
      // The query brings the command into view on any palette height.
      phase(geometry, undefined, "the palette", palette, {
        input: "Check for updates",
      }),
      phase(
        geometry,
        "due",
        "Check for updates, due",
        both(palette, showing("Check for", due)),
        { keys: ["enter"] },
      ),
      // The browser opens only after the disclosure's explicit Open, which
      // waits until every line has been on screen: a short terminal pages
      // through it first.
      phase(
        geometry,
        "confirm",
        "the disclosure on Cancel",
        both(
          (capture) => !capture.text.includes("Checking current state"),
          deskFocused(review, "button:safe"),
        ),
        { keys: ["page-down", "page-down", "page-down", "page-down", "tab"] },
      ),
      phase(
        geometry,
        undefined,
        "the disclosure on Open",
        deskFocused(review, "button:confirm"),
        { keys: ["enter"] },
      ),
      // End brings the page's address on screen at any height.
      phase(geometry, "outcome", "what the browser did", result, {
        keys: ["end"],
      }),
      phase(
        geometry,
        "result",
        "the page's address",
        both(result, showing("since=")),
        resize ? { resize: resized } : leave,
      ),
      ...(resize ? [phase(resized, "resized", "the result, resized", result, leave)] : []),
      phase(resized, undefined, "back at the inbox", empty, {
        keys: ["ctrl-k"],
      }),
      phase(
        resized,
        "returned",
        "the palette without the due check",
        both(palette, (capture) => !capture.text.includes("check due")),
        { keys: ["escape"], allowLoneEscape: true },
      ),
      // A refresh repaints nothing here, so it and the quit share a phase;
      // the single launch below proves the refresh relaunched nothing.
      phase(resized, "refreshed", "the inbox", empty, { input: "r" }, {
        input: "q",
      }),
    ];
    const run = await runDeskTty(project, {
      geometry,
      input,
      colorMode: "no-color-env",
      env: {
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        RELEASE_LAUNCH_LOG: log,
      },
    });
    assertEquals(run.code, 0, run.transcript);
    assert(run.terminal.restored && run.terminal.noChild);
    const launched = (await Deno.readTextFile(log)).trim().split("\n");
    assertEquals(
      launched.length,
      1,
      "observation, return, and refresh must not relaunch",
    );
    assertEquals(
      new URL(launched[0] ?? "").searchParams.get("since"),
      DISCERN_VERSION,
    );
    const after = await inspectReleaseCheck(project.root);
    assert(after.status === "recorded");
    assertEquals(after.value.version_when_handed_off, DISCERN_VERSION);
    assertEquals(releaseReminderDue(after, SYSTEM_CLOCK.wallNow()), false);
    const returned = run.frames.find((frame) => frame.name === "returned");
    assert(returned !== undefined);
    assert(
      !returned.text.includes("check due"),
      "the advisory clears without restarting",
    );
    const shown = run.frames.find((frame) => frame.name === "outcome");
    assert(shown !== undefined);
    assert(
      shown.text.includes(
        failure ? "Couldn't open your browser" : "Opening release notes",
      ),
      "the reader says what the browser did",
    );
    return run;
  });
}
