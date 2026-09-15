/** Executed production CLI journey with fake native launchers and retained viewport evidence. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { stripAnsi } from "discern-design-system/cli";
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
  type DeskTtyInputPhase,
  type DeskTtyRunResult,
  runDeskTty,
  withDeskTtyProject,
} from "./desk_tty_harness.ts";
import type { PtyGeometry } from "./pty_process.ts";

/** Ready markers come from the actual rendered application, never elapsed sleep. */
function phase(
  name: string,
  includes: [string, ...string[]],
  input: string | PtyGeometry,
): DeskTtyInputPhase {
  return {
    waitFor: {
      description: name,
      test: (output) =>
        includes.every((value) =>
          stripAnsi(output.phaseStdout + output.phaseStderr).includes(value)
        ),
    },
    capture: { name, when: { includes } },
    chunks: [
      typeof input === "string"
        ? {
          input,
          ...(input.endsWith("\x1b") ? { allowLoneEscape: true } : {}),
        }
        : { resize: input },
    ],
  };
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
    const input: DeskTtyInputPhase[] = [
      phase("empty", ["No tasks yet", "/ find"], "\t/Check for updates\r"),
      phase("due", [
        "Desk commands / Check",
        "Check for updates",
        "Due",
        "/ find",
      ], "\r"),
      ...(geometry.rows <= 10
        ? [
          phase("reader", ["Release information", "Esc back"], "\x1b[6~"),
          phase("evidence", ["Browser:", "Esc back"], "\x1b[6~"),
        ]
        : []),
      phase(
        "result",
        ["Release information", "since=", "Esc back"],
        resize ? { columns: 40, rows: 20 } : "\x1b",
      ),
      ...(resize
        ? [phase("resized", ["Release information", "Esc back"], "\x1b")]
        : []),
      phase("returned", [
        "Desk commands / Check",
        "Check for updates",
        "/ find",
      ], "r"),
      phase("refreshed", [
        "Desk commands / Check",
        "Check for updates",
        "/ find",
      ], "q"),
    ];
    const result = await runDeskTty(project, {
      geometry,
      input,
      colorMode: "no-color-env",
      env: {
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        RELEASE_LAUNCH_LOG: log,
      },
    });
    assertEquals(result.code, 0, result.transcript);
    assert(result.terminal.restored && result.terminal.noChild);
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
    const returned = result.frames.find((frame) => frame.name === "returned");
    assert(returned !== undefined);
    if (resize) {
      assertStringIncludes(
        returned.text,
        "sends running version to discern.sh.",
      );
    }
    assert(
      !JSON.stringify(returned).includes("Due"),
      "the advisory clears without restarting",
    );
    return result;
  });
}
