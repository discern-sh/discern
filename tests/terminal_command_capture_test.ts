import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  captureDiscernCommand,
  normalizePtyLineEndings,
  renderTerminalCaptureHtml,
  serializeTerminalCapture,
  TERMINAL_CAPTURE_GEOMETRIES,
  type TerminalCommandCapture,
} from "./fixtures/terminal_command_capture.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test({
  name: "command capture forces its geometry and terminal environment",
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
  assertThrows(
    () => normalizePtyLineEndings("progress\rcomplete"),
    Error,
    "live carriage-return repaint",
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
