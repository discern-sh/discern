import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { projectTerminalSpans } from "discern-design-system/cli/projection";
import {
  captureFlagshipTerminalScreens,
  FLAGSHIP_CAPTURE_DIRECTORY,
  FLAGSHIP_CAPTURE_NORMALIZERS,
  FLAGSHIP_COMMANDS,
  normalizeFlagshipTerminalOutput,
} from "./fixtures/flagship_terminal_captures.ts";
import {
  compileDiscernCaptureBinary,
  renderTerminalCaptureHtml,
  serializeTerminalCapture,
} from "./fixtures/terminal_command_capture.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test("flagship normalizers replace facts without hiding visible structure", () => {
  const source = [
    "At: /tmp/one/worktree",
    "Recorded: 2026-08-15T12:34:56.789Z",
    "Age: 7m ago",
    "check passed in 34ms.",
    "discern 9.8.7 · linux/x86_64 · git 2.44.0 (vendor build)",
    "\x1b[38;5;151m✓\x1b[0m git: 2.44.0 (vendor build)",
    "Commit: abcdef0123456789",
    "└────────────────────┘",
    "",
  ].join("\n");
  const normalized = normalizeFlagshipTerminalOutput(source, {
    name: "coverage",
    args: ["status"],
    cwd: "/tmp/one/worktree",
  });

  assertEquals(
    FLAGSHIP_CAPTURE_NORMALIZERS.map((normalizer) => normalizer.name),
    [
      "absolute-paths",
      "timestamps",
      "durations",
      "version-strings",
      "runtime-platform",
      "commit-identifiers",
    ],
  );
  assertStringIncludes(normalized, "At: <PROJECT_PATH>");
  assertStringIncludes(normalized, "0000-00-00T00:00:00.000Z");
  assertStringIncludes(normalized, "Age: 0m ago");
  assertStringIncludes(normalized, "passed in 00ms");
  assertStringIncludes(
    normalized,
    "discern 0.0.0 · <PLATFORM> · git 0.00.0",
  );
  assertStringIncludes(normalized, "git: 0.00.0");
  assertStringIncludes(normalized, "Commit: 0000000000000000");
  assertEquals(normalized.split("\n").length, source.split("\n").length);
  assertStringIncludes(normalized, "\x1b[38;5;151m✓\x1b[0m");
  assertStringIncludes(normalized, "└────────────────────┘");
});

Deno.test({
  name:
    "flagship commands are deterministic, projectable, and match reviewed captures",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const temp = await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "discern-terminal-binary-",
    });
    const executable = join(temp, "discern");
    try {
      await compileDiscernCaptureBinary(REPO_ROOT, executable);
      const first = await captureFlagshipTerminalScreens(executable);
      const second = await captureFlagshipTerminalScreens(executable);
      for (const command of FLAGSHIP_COMMANDS) {
        const firstCapture = first[command.name];
        const secondCapture = second[command.name];
        if (firstCapture === undefined || secondCapture === undefined) {
          throw new Error(`missing runtime capture: ${command.name}`);
        }
        const serialized = serializeTerminalCapture(firstCapture);
        assertEquals(
          serializeTerminalCapture(secondCapture),
          serialized,
          `${command.name} differed across consecutive captures`,
        );
        assertEquals(firstCapture.exitCode, 0, firstCapture.screen);
        assertEquals(firstCapture.geometry, { columns: 80, rows: 24 });
        assertEquals(
          firstCapture.normalizers,
          FLAGSHIP_CAPTURE_NORMALIZERS.map((normalizer) => normalizer.name),
        );

        const spans = projectTerminalSpans(firstCapture.screen);
        assertEquals(spans.length > 0, true, command.name);
        const html = renderTerminalCaptureHtml(firstCapture);
        assertStringIncludes(html, spans[0]?.text ?? "");
        assertEquals(
          await Deno.readTextFile(
            join(FLAGSHIP_CAPTURE_DIRECTORY, `${command.name}.json`),
          ),
          serialized,
          `run deno task terminal:capture-fixtures to review ${command.name}`,
        );
        assertEquals(
          await Deno.readTextFile(
            join(FLAGSHIP_CAPTURE_DIRECTORY, `${command.name}.html`),
          ),
          html,
          `run deno task terminal:capture-fixtures to review ${command.name}`,
        );
      }
    } finally {
      await Deno.remove(temp, { recursive: true }).catch(() => undefined);
    }
  },
});
