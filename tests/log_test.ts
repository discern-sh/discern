/**
 * Unit tests for the presentation-aware {@link Logger} and {@link colourEnabled}.
 *
 * These run with colour forced off (no TTY under `deno test`, and `--no-color`
 * passed explicitly), so every human method emits plain, un-painted text. We spy
 * on `console.error`/`console.log` — saving and restoring the originals in a
 * `finally` — to capture what each method writes, and to which channel. JSON mode
 * is checked from the opposite side: the human methods fall silent and only
 * `jsonResult` speaks.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { colourEnabled, Logger } from "../src/lib/log.ts";
import { fakeEnv } from "./helpers.ts";

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
  const log = new Logger({ json: false, noColor: true });
  const { err, out } = await capture(() => {
    log.info("starting");
    log.ok("done");
    log.warn("careful");
    log.error("oops");
    log.detail("a detail");
  });
  assertEquals(out, []); // none of these touch stdout
  assertEquals(err.length, 5);
  assertEquals(err[0], "→ starting");
  assertEquals(err[1], "✓ done");
  assertEquals(err[2], "! careful");
  assertEquals(err[3], "✗ oops");
  assertEquals(err[4], "  a detail");
});

Deno.test("heading writes a blank-line-prefixed banner to stderr", async () => {
  const log = new Logger({ json: false, noColor: true });
  const { err, out } = await capture(() => log.heading("Section"));
  assertEquals(out, []);
  assertEquals(err.length, 1);
  // console.error gets the raw "\nSection"; the joiner keeps the leading newline.
  assertEquals(err[0], "\nSection");
});

Deno.test("line writes plain text to stdout; default is an empty line", async () => {
  const log = new Logger({ json: false, noColor: true });
  const { err, out } = await capture(() => {
    log.line("hello");
    log.line();
  });
  assertEquals(err, []);
  assertEquals(out, ["hello", ""]);
});

Deno.test("bold and dim are identity functions when colour is off", () => {
  const log = new Logger({ json: false, noColor: true });
  assertEquals(log.bold("x"), "x");
  assertEquals(log.dim("y"), "y");
});

Deno.test("jsonResult does nothing in human mode", async () => {
  const log = new Logger({ json: false, noColor: true });
  const { err, out } = await capture(() => log.jsonResult({ a: 1 }));
  assertEquals(err, []);
  assertEquals(out, []);
});

Deno.test("the json flag is exposed on the logger", () => {
  assertEquals(new Logger({ json: true, noColor: true }).json, true);
  assertEquals(new Logger({ json: false, noColor: true }).json, false);
});

Deno.test("JSON mode silences every human method", async () => {
  const log = new Logger({ json: true, noColor: true });
  const { err, out } = await capture(() => {
    log.info("i");
    log.ok("o");
    log.warn("w");
    log.error("e");
    log.heading("h");
    log.detail("d");
    log.line("l");
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

Deno.test("colourEnabled(true) is always false (forced off)", () => {
  assertEquals(colourEnabled(true), false);
});

Deno.test("colourEnabled(false) is false when NO_COLOR is set and non-empty", () => {
  assertEquals(colourEnabled(false, fakeEnv({ NO_COLOR: "1" })), false);
});

Deno.test("colourEnabled(false) ignores an empty NO_COLOR and falls back to the TTY check", () => {
  // Empty NO_COLOR is not "set"; without a TTY (the test runner) this is false.
  assertEquals(
    colourEnabled(false, fakeEnv({ NO_COLOR: "" })),
    Deno.stdout.isTerminal(),
  );
});

Deno.test("colourEnabled(false) defers to the TTY check when NO_COLOR is unset", () => {
  // Under `deno test` stdout is not a terminal, so this resolves false; the
  // assertion is written against the live TTY state to stay correct anywhere.
  assertEquals(colourEnabled(false, fakeEnv()), Deno.stdout.isTerminal());
  assert(typeof Deno.stdout.isTerminal() === "boolean");
});
