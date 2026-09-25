/** Real foreground input ownership, shared document navigation, and Desk return. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ptyOutputContains, runPtyProcess } from "./fixtures/pty_process.ts";
import { APPLICATION_FIXTURE_ROOT } from "./fixtures/terminal_application_capture.ts";
import { realPtyTest } from "./real_pty.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";

realPtyTest({
  name:
    "Desk foreground shared browser owns input across search, links, refusal, and return at 80 by 24",
  contracts: [
    "line-discipline",
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
  ],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (root) => {
      await scaffoldEngine(root, { agents: [] });
      const manual = join(root, "manual-fixture");
      await Deno.mkdir(manual);
      await Deno.writeTextFile(
        join(manual, "README.md"),
        "# Manual fixture\n\n- [Alpha guide](alpha.md)\n- [Beta guide](beta.md)\n",
      );
      await Deno.writeTextFile(
        join(manual, "alpha.md"),
        "# Alpha guide\n\n[Next section](beta.md#destination)\n\n[Unsupported external](file:///unavailable)\n",
      );
      await Deno.writeTextFile(
        join(manual, "beta.md"),
        "# Beta guide\n\n## Destination\n\nAnchor destination text.\n\n[Unsupported external](file:///unavailable)\n",
      );
      await gitInit(root);
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: [
          "run",
          "-A",
          "--config",
          join(APPLICATION_FIXTURE_ROOT, "deno.json"),
          join(
            APPLICATION_FIXTURE_ROOT,
            "tests/fixtures/desk_manual_process.ts",
          ),
          manual,
        ],
        cwd: root,
        geometry: { columns: 80, rows: 24 },
        env: { NO_COLOR: "1" },
        input: [
          {
            waitFor: ["No tasks yet", "/ find"],
            steps: [{ bytes: "\t/manual\r\r" }],
          },
          {
            waitFor: ["DISCERN MAP", "Enter open/action  Esc cancel"],
            capture: {
              name: "manual",
              when: ptyOutputContains([
                "DISCERN MAP",
                "Enter open/action  Esc cancel",
              ]),
            },
            steps: [{ bytes: "Alpha" }],
          },
          {
            waitFor: ["Search: Alpha", "Alpha guide"],
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: ["Alpha guide", "Tab picker  Esc/q close"],
            steps: [{ bytes: "]\r" }],
          },
          {
            waitFor: ["Anchor destination text", "Tab picker  Esc/q close"],
            capture: {
              name: "linked",
              when: ptyOutputContains([
                "Anchor destination text",
                "Tab picker  Esc/q close",
              ]),
            },
            steps: [{ bytes: "]\r" }],
          },
          { waitFor: "only http:// and https://", steps: [{ bytes: "\r" }] },
          {
            waitFor: ["Anchor destination text", "Tab picker"],
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b", allowLoneEscape: true }],
          },
          {
            waitFor: ["Desk commands / manual", "/ find"],
            capture: {
              name: "returned",
              when: ptyOutputContains(["Desk commands / manual", "/ find"]),
            },
            steps: [{ bytes: "q" }],
          },
        ],
      });
      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(
        result.keyframes.linked ?? "",
        "Anchor destination text",
      );
      assertStringIncludes(
        result.keyframes.returned ?? "",
        "Desk commands / manual",
      );
      assert(result.keyframes.manual !== undefined);
      const bundled = await runPtyProcess({
        command: Deno.execPath(),
        args: [
          "run",
          "-A",
          "--config",
          join(APPLICATION_FIXTURE_ROOT, "deno.json"),
          join(
            APPLICATION_FIXTURE_ROOT,
            "tests/fixtures/desk_manual_process.ts",
          ),
        ],
        cwd: root,
        geometry: { columns: 80, rows: 24 },
        env: { NO_COLOR: "1" },
        input: [
          {
            waitFor: ["No tasks yet", "/ find"],
            steps: [{ bytes: "\t/manual\r\r" }],
          },
          {
            waitFor: ["DISCERN DOCS", "Enter open/action  Esc cancel"],
            steps: [{ bytes: "Delegate substantial work" }],
          },
          {
            waitFor: [
              "Search: Delegate substantial work",
              "20-guides/delegate-work.md",
            ],
            steps: [{ bytes: "\r" }],
          },
          {
            waitFor: ["A substantial idea", "Tab picker  Esc/q close"],
            capture: {
              name: "bundled",
              when: ptyOutputContains([
                "A substantial idea",
                "Tab picker  Esc/q close",
              ]),
            },
            steps: [{ bytes: "]\r" }],
          },
          {
            waitFor: ["Wait for another task", "Tab picker  Esc/q close"],
            steps: [{ bytes: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            steps: [{ bytes: "\x1b", allowLoneEscape: true }],
          },
          {
            waitFor: ["Desk commands / manual", "/ find"],
            steps: [{ bytes: "q" }],
          },
        ],
      });
      assertEquals(bundled.code, 0, bundled.transcript);
      assertStringIncludes(
        bundled.keyframes.bundled ?? "",
        "A substantial idea",
      );
    });
  },
});
