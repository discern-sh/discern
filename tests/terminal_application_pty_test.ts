/** Native input ownership and kernel resize at the consumer boundary. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runPtyProcess } from "./fixtures/pty_process.ts";
import { realPtyTest } from "./real_pty.ts";
import { withTempDir } from "./helpers.ts";
import {
  APPLICATION_FIXTURE_ROOT,
  applicationFrameReady,
  applicationProcessArgs,
} from "./fixtures/terminal_application_capture.ts";

realPtyTest({
  name:
    "consumer traced native read releases input to a foreground child and resumes",
  contracts: ["line-discipline", "terminal-modes", "process-lifecycle"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (directory) => {
      const trace = join(directory, "trace.jsonl");
      const geometry = { columns: 80, rows: 24 };
      const ready = applicationFrameReady(geometry);
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: [...applicationProcessArgs(), "--pending-read"],
        cwd: APPLICATION_FIXTURE_ROOT,
        geometry,
        env: { CI: "false", NO_COLOR: "1", DISCERN_INTERACTION_TRACE: trace },
        input: [
          { waitFor: ready, steps: [{ bytes: "\x1b", allowLoneEscape: true }] },
          { waitFor: "CHILD_READY", steps: [{ bytes: "hello\n" }] },
          {
            waitFor: ready,
            capture: { name: "restored", when: ready },
            steps: [{ bytes: "\x1b[F\r" }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(result.transcript, "CHILD_RECEIVED_HELLO");
      assertStringIncludes(
        result.transcript,
        "APPLICATION_RETURNED cancellations=1",
      );
      assertEquals(
        (await Deno.readTextFile(trace)).trim().split("\n").length,
        2,
      );
    });
  },
});

realPtyTest({
  name:
    "consumer application follows kernel resize and returns from package foreground handoff",
  contracts: ["resize-delivery", "line-discipline", "terminal-modes"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (directory) => {
      const when = join(directory, "resize-now");
      await Deno.writeTextFile(join(directory, "resized"), "");
      const initial = { columns: 80, rows: 24 };
      const resized = { columns: 60, rows: 50 };
      const ready = applicationFrameReady(resized);
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: [
          "run",
          "-A",
          join(
            APPLICATION_FIXTURE_ROOT,
            "tests/fixtures/terminal_resize_harness.ts",
          ),
          "--result",
          join(directory, "result.json"),
          "--size",
          "80x24",
          "--resize",
          "60x50",
          "--resize-when",
          when,
          "--release-after-resize",
          join(directory, "resized"),
          "--",
          Deno.execPath(),
          ...applicationProcessArgs(),
        ],
        cwd: APPLICATION_FIXTURE_ROOT,
        geometry: initial,
        env: { CI: "false", NO_COLOR: "1" },
        input: [
          {
            waitFor: applicationFrameReady(initial),
            steps: [{ effect: () => Deno.writeTextFile(when, "ready") }],
          },
          {
            waitFor: ready,
            capture: { name: "resized", when: ready },
            steps: [{ bytes: "\x1b[B\r\x1b[A\r" }],
          },
          { waitFor: "CHILD_READY", steps: [{ bytes: "hello\n" }] },
          {
            waitFor: ready,
            capture: { name: "returned", when: ready },
            steps: [{ bytes: "\x1b[F\r" }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(result.transcript, "CHILD_RECEIVED_HELLO");
      assertStringIncludes(result.transcript, "APPLICATION_RETURNED");
    });
  },
});
