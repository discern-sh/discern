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
import { withTempDir } from "./helpers.ts";
import { realPtyTest } from "./real_pty.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Recover the visible terminal text from the package-owned HTML projection. */
function terminalHtmlText(html: string): string {
  const content = /<pre\b[^>]*>([\s\S]*)<\/pre>/u.exec(html)?.[1];
  if (content === undefined) {
    throw new Error("terminal projection did not render a pre element");
  }
  return content.replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

Deno.test("flagship normalizers replace facts without hiding visible structure", () => {
  const source = [
    "At: /tmp/one/worktree",
    "Recorded: 2026-08-15T12:34:56.789Z",
    "Age: 7m ago",
    "check passed in 34ms.",
    "discern 9.8.7 · linux/x86_64 · git 2.44.0 (vendor build)",
    "\x1b[38;5;151m✓\x1b[0m git: 2.44.0 (vendor build)",
    "Commit: abcdef0123456789",
    "Proof at \x1b[1mabcdef012345\x1b[0m",
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
      "short-handles",
      "trailing-whitespace",
    ],
  );
  assertStringIncludes(normalized, "At: <PROJECT_PATH>");
  assertStringIncludes(normalized, "0000-00-00T00:00:00.000Z");
  assertStringIncludes(normalized, "Age: 0m ago");
  assertStringIncludes(normalized, "passed in <0s");
  assertStringIncludes(
    normalized,
    "discern 0.0.0 · <PLATFORM> · git 0.00.0",
  );
  assertStringIncludes(normalized, "git: 0.00.0");
  assertStringIncludes(normalized, "Commit: 0000000000000000");
  assertStringIncludes(normalized, "Proof at \x1b[1m000000000000\x1b[0m");
  assertEquals(normalized.split("\n").length, source.split("\n").length);
  assertStringIncludes(normalized, "\x1b[38;5;151m✓\x1b[0m");
  assertStringIncludes(normalized, "└────────────────────┘");

  const belowOneSecond = normalizeFlagshipTerminalOutput(
    "check passed in <0s.\n",
    { name: "below", args: ["done"], cwd: "/tmp/one/worktree" },
  );
  const aboveOneSecond = normalizeFlagshipTerminalOutput(
    "check passed in 9.8s.\n",
    { name: "above", args: ["done"], cwd: "/tmp/one/worktree" },
  );
  assertEquals(
    aboveOneSecond,
    belowOneSecond,
    "duration normalization must survive a loaded run crossing a display-unit threshold",
  );
});

realPtyTest({
  name: "flagship commands cross the real terminal and match reviewed captures",
  contracts: ["control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (temp) => {
      const executable = join(temp, "discern");
      await compileDiscernCaptureBinary(REPO_ROOT, executable);
      const captures = await captureFlagshipTerminalScreens(executable);
      for (const command of FLAGSHIP_COMMANDS) {
        const capture = captures[command.name];
        if (capture === undefined) {
          throw new Error(`missing runtime capture: ${command.name}`);
        }
        const serialized = serializeTerminalCapture(capture);
        assertEquals(capture.exitCode, 0, capture.screen);
        assertEquals(capture.geometry, { columns: 80, rows: 24 });
        assertEquals(
          capture.normalizers,
          FLAGSHIP_CAPTURE_NORMALIZERS.map((normalizer) => normalizer.name),
        );

        const spans = projectTerminalSpans(capture.screen);
        assertEquals(spans.length > 0, true, command.name);
        const html = renderTerminalCaptureHtml(capture);
        assertEquals(
          terminalHtmlText(html),
          spans.map((span) => span.text).join(""),
          `${command.name} HTML projection changed the visible terminal text`,
        );
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
    }, { parent: "/tmp", prefix: "discern-terminal-binary-" });
  },
});
