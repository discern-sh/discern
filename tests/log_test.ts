/**
 * Unit tests for the presentation-aware {@link Logger}.
 *
 * These run with colour forced off (no TTY under `deno test`, and `--no-color`
 * passed explicitly), so every human method emits plain, un-painted text. We spy
 * on `console.error`/`console.log` — saving and restoring the originals in a
 * `finally` — to capture what each method writes, and to which channel. JSON mode
 * is checked from the opposite side: the human methods fall silent and only
 * `jsonResult` speaks.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { Logger } from "../src/lib/log.ts";
import {
  resolveTerminalContext,
  terminalMultiline,
} from "../src/lib/terminal.ts";
import { fakeEnv, pinnedTerminal } from "./helpers.ts";

/** A human-mode Logger whose terminal context is pinned, so glyph capability
 * comes from the test instead of the ambient locale. */
function plainLogger(): Logger {
  return new Logger({ json: false, noColor: true, terminal: pinnedTerminal() });
}

/** Capture everything written to console.error / console.log while `fn` runs. */
async function capture(
  fn: () => void | Promise<void>,
): Promise<{ err: string[]; out: string[] }> {
  const err: string[] = [];
  const out: string[] = [];
  const origErr = console.error;
  const origOut = console.log;
  console.error = (...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  };
  console.log = (...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.error = origErr;
    console.log = origOut;
  }
  return { err, out };
}

Deno.test("human methods write to stderr with their prefix glyphs (no colour)", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => {
    log.info("starting");
    log.ok("done");
    log.warn("careful");
    log.error("oops");
    log.detail("a detail");
  });
  assertEquals(out, []); // none of these touch stdout
  assertEquals(err.length, 5);
  assertEquals(err[0], "◮ starting");
  assertEquals(err[1], "✓ done");
  assertEquals(err[2], "! careful");
  assertEquals(err[3], "✕ oops");
  assertEquals(err[4], "  a detail");
});

Deno.test("heading writes a blank-line-prefixed banner to stderr", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => log.heading("Section"));
  assertEquals(out, []);
  // The sink owns the heading's leading boundary: one separate blank line, then
  // the banner — the same bytes as before, in two line writes.
  assertEquals(err, ["", "Section"]);
});

Deno.test("heading collapses onto an existing group boundary", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => {
    log.info("first");
    log.group("next");
    log.heading("Section");
    log.heading("Adjacent");
  });
  assertEquals(out, []);
  // One blank line before each heading, never two — the boundary after "first"
  // and the heading's own leading line are the same sink-owned transition.
  assertEquals(err, ["◮ first", "", "Section", "", "Adjacent"]);
});

Deno.test("line writes plain text to stdout", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => {
    log.line("hello");
  });
  assertEquals(err, []);
  assertEquals(out, ["hello"]);
});

Deno.test("group writes exactly one boundary between populated groups", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => {
    log.group("leading-group");
    log.info("first");
    log.group("second-group");
    log.group("same-boundary");
    log.info("second");
    log.group("third-group", "Third");
    log.info("third");
  });
  assertEquals(out, []);
  assertEquals(err, ["◮ first", "", "◮ second", "", "  ── Third", "◮ third"]);
});

Deno.test("Logger exposes package presentation facts without inline style wrappers", () => {
  const log = plainLogger();
  assertEquals(log.terminal.role("x", "strong"), "x");
  assertEquals(log.terminal.role("y", "muted"), "y");
  assertEquals("bold" in log, false);
  assertEquals("dim" in log, false);
  assertEquals("cyan" in log, false);
  assertEquals("green" in log, false);
});

Deno.test("Logger narration styles come from injected package Token roles", async () => {
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_GB.UTF-8",
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 80, rows: 24 }),
  });
  const log = new Logger({ json: false, noColor: false, terminal });
  const { err } = await capture(() => {
    log.info("starting");
    log.ok("done");
    log.warn("careful");
    log.error("oops");
    log.heading("Section");
    log.detail("detail");
  });
  assertEquals(err, [
    terminal.presenter.note("starting"),
    terminal.presenter.success("done"),
    terminal.presenter.warning("careful"),
    terminal.presenter.failure("oops"),
    "",
    terminal.role("Section", "strong"),
    `  ${terminal.role("detail", "muted")}`,
  ]);
});

Deno.test("Logger narration makes hostile caller facts inert at the shared boundary", async () => {
  const log = plainLogger();
  const hostile = "repo\x1b[31m\nbranch\x00\u0085\u202E";
  const safe = "repo␛[31m␊branch␀<U+0085><U+202E>";
  const hostileLabel = "repo\x1b[31m\x00\u0085\u202E";
  const safeLabel = "repo␛[31m␀<U+0085><U+202E>";
  const { err, out } = await capture(() => {
    log.info(hostile);
    log.ok(hostile);
    log.warn(hostile);
    log.error(hostile);
    log.heading(hostile);
    log.detail(hostile);
    log.group("hostile-label", hostileLabel);
  });

  assertEquals(out, []);
  assertEquals(err, [
    `◮ ${safe}`,
    `✓ ${safe}`,
    `! ${safe}`,
    `✕ ${safe}`,
    "",
    safe,
    `  ${safe}`,
    "",
    `  ── ${safeLabel}`,
  ]);
});

Deno.test("Logger pre-composed package frames honor color mode and keep content plain", async () => {
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_GB.UTF-8",
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 80, rows: 24 }),
  });
  const colorLog = new Logger({ json: false, noColor: false, terminal });
  const plainLog = new Logger({ json: false, noColor: true, terminal });
  const coloredFrame = `${
    colorLog.terminal.role("package", "strong")
  }\nwrapped`;
  const plainFrame = `${plainLog.terminal.role("package", "strong")}\nwrapped`;
  const { err, out } = await capture(() => {
    colorLog.humanLine(coloredFrame);
    plainLog.humanLine(plainFrame);
    plainLog.terminalSafeMultilineError(terminalMultiline("safe\nwrapped"));
    plainLog.line("content\nrow");
  });
  assertStringIncludes(coloredFrame, "\x1b[");
  assertEquals(plainFrame.includes("\x1b["), false);
  assertEquals(err, [coloredFrame, plainFrame, "✕ safe\nwrapped"]);
  assertEquals(out, ["content\nrow"]);
});

Deno.test("Logger multiline errors require the branded safe-text boundary", () => {
  const rejectsArbitraryStrings = (log: Logger, text: string): void => {
    // @ts-expect-error — future callers must cross terminalMultiline first.
    log.terminalSafeMultilineError(text);
  };
  assertEquals(typeof rejectsArbitraryStrings, "function");
});

Deno.test("jsonResult does nothing in human mode", async () => {
  const log = plainLogger();
  const { err, out } = await capture(() => log.jsonResult({ a: 1 }));
  assertEquals(err, []);
  assertEquals(out, []);
});

Deno.test("the json flag is exposed on the logger", () => {
  assertEquals(new Logger({ json: true, noColor: true }).json, true);
  assertEquals(plainLogger().json, false);
});

Deno.test("JSON mode silences every human method", async () => {
  const log = new Logger({ json: true, noColor: true });
  const { err, out } = await capture(() => {
    log.info("i");
    log.ok("o");
    log.warn("w");
    log.error("e");
    log.heading("h");
    log.group("g");
    log.detail("d");
    log.line("l");
    log.humanLine("hl");
    log.terminalSafeMultilineError(terminalMultiline("em"));
  });
  assertEquals(err, []);
  assertEquals(out, []);
});

Deno.test("JSON mode: jsonResult emits a pretty-printed payload to stdout", async () => {
  const log = new Logger({ json: true, noColor: true });
  const { err, out } = await capture(() =>
    log.jsonResult({ ok: true, items: ["a"] })
  );
  assertEquals(err, []);
  assertEquals(out.length, 1);
  const payload = out[0];
  assertExists(payload);
  // Pretty-printed with a two-space indent.
  assertEquals(payload, JSON.stringify({ ok: true, items: ["a"] }, null, 2));
  assertStringIncludes(payload, "\n  ");
});
