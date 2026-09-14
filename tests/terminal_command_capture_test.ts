import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  captureDiscernCommand,
  normalizePtyLineEndings,
  renderTerminalCaptureHtml,
  serializeTerminalCapture,
  settledInteractiveTerminalFrame,
  TERMINAL_CAPTURE_GEOMETRIES,
  terminalCaptureCompileArguments,
  type TerminalCommandCapture,
} from "./fixtures/terminal_command_capture.ts";
import { realPtyTest } from "./real_pty.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test("terminal capture names each review geometry", () => {
  assertEquals(TERMINAL_CAPTURE_GEOMETRIES, {
    canonical: { columns: 80, rows: 24 },
    wide: { columns: 120, rows: 24 },
    tall: { columns: 80, rows: 40 },
    short: { columns: 80, rows: 13 },
  });
});

Deno.test("terminal capture compilation bypasses the mutable npm workspace", () => {
  const args = terminalCaptureCompileArguments(
    "/project",
    "/tmp/discern-capture",
  );

  assertEquals(args.includes("--node-modules-dir=none"), true);
  assertEquals(args.includes("--cached-only"), true);
  assertEquals(args.at(-1), "/project/src/main.ts");
});

realPtyTest({
  name: "command capture forces its geometry and terminal environment",
  contracts: ["resize-delivery", "control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const capture = await captureDiscernCommand({
      executable: "sh",
      name: "environment",
      args: [
        "-c",
        'printf "%s|%s|%s|%s|%s\\n" "$TERM" "$CI" "$NO_COLOR" "$LANG" "$LC_ALL"; stty size',
      ],
      cwd: REPO_ROOT,
      geometry: TERMINAL_CAPTURE_GEOMETRIES.wide,
      color: false,
      locale: "C",
      env: {
        TERM: "dumb",
        CI: "false",
        NO_COLOR: "",
        LANG: "inherited",
        LC_ALL: "inherited",
      },
    });

    assertEquals(capture.exitCode, 0, capture.screen);
    assertEquals(capture.screen, "xterm-256color|1|1|C|C\n24 120\n");
    assertEquals(capture.geometry, { columns: 120, rows: 24 });
    assertEquals(capture.environment, {
      color: "off",
      locale: "C",
      mode: "static",
      term: "xterm-256color",
    });
  },
});

Deno.test("PTY line normalization preserves rows and rejects live repaint", () => {
  assertEquals(normalizePtyLineEndings("one\r\ntwo\r\n"), "one\ntwo\n");
  assertEquals(
    normalizePtyLineEndings("complete frame\r\r\nnext row\r\r\n"),
    "complete frame\nnext row\n",
  );
  assertThrows(
    () => normalizePtyLineEndings("progress\rcomplete"),
    Error,
    "live carriage-return repaint",
  );
});

Deno.test("interactive capture extracts the last settled package frame", () => {
  const transcript = "prior\r\n\x1b[?25lfirst\r\n" +
    "\x1b[1G\x1b[2A\x1b[J\x1b]11;?\x1b\\\x1b[?25l" +
    "\x1b[1msettled\x1b[0m\r\n\x1b[?25h";
  assertEquals(
    settledInteractiveTerminalFrame(transcript),
    "\x1b[1msettled\x1b[0m\n",
  );
});

Deno.test("interactive capture extracts a complete alternate-screen repaint", () => {
  const transcript = "\x1b[?1049h\x1b[?1000h\x1b[2J\x1b[H" +
    "complete frame\r\r\nsecond row    ";
  assertEquals(
    settledInteractiveTerminalFrame(transcript, { columns: 14, rows: 2 }),
    "complete frame\nsecond row    ",
  );
});

Deno.test("captured package styling projects to stable self-contained HTML", () => {
  const capture: TerminalCommandCapture = {
    schemaVersion: 1,
    name: "styled status",
    args: ["status"],
    geometry: TERMINAL_CAPTURE_GEOMETRIES.canonical,
    environment: {
      color: "on",
      locale: "en_US.UTF-8",
      mode: "static",
      term: "xterm-256color",
    },
    exitCode: 0,
    normalizers: [],
    screen: "\x1b[1;38;5;117mStatus\x1b[0m\n",
    keyframes: {},
  };

  const html = renderTerminalCaptureHtml(capture);
  assertStringIncludes(html, "<!doctype html>");
  assertStringIncludes(html, "<title>styled status — 80×24</title>");
  assertStringIncludes(html, "Status");
  assertEquals(html.includes("\x1b["), false);
  assertEquals(renderTerminalCaptureHtml(capture), html);
  assertEquals(
    serializeTerminalCapture(capture),
    serializeTerminalCapture({
      ...capture,
    }),
  );
});

Deno.test("complete-frame capture refuses missing geometry, partial and overflowing frames", () => {
  const frame = "\x1b[?1049h\x1b[2J\x1b[H";
  for (
    const output of [
      frame + "x",
      frame + "12345\n1234",
      frame + "1234\n1234\n1234",
    ]
  ) {
    assertThrows(
      () => settledInteractiveTerminalFrame(output, { columns: 4, rows: 2 }),
      TypeError,
    );
  }
  assertThrows(
    () => settledInteractiveTerminalFrame(frame + "1234\n1234"),
    TypeError,
    "requires terminal geometry",
  );
});
