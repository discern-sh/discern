/**
 * Unit tests for the shared narration authority and its boundary-owning sink
 * (`src/lib/narration.ts`) — the single implementation behind the engine's
 * `Out` and the installer's `Logger`.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  makeNarration,
  makeOutputSink,
  reportFailure,
  silentOutputSink,
} from "../src/lib/narration.ts";
import {
  resolveTerminalContext,
  terminalContext,
} from "../src/lib/terminal.ts";
import { fakeEnv } from "./helpers.ts";

/** A raw-writer sink capturing the exact bytes per stream. */
function rawCapture(): {
  sink: ReturnType<typeof makeOutputSink>;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = makeOutputSink({
    kind: "raw",
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  });
  return { sink, stdout, stderr };
}

/** A line-writer sink capturing console-style lines per stream. */
function lineCapture(): {
  sink: ReturnType<typeof makeOutputSink>;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = makeOutputSink({
    kind: "line",
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { sink, stdout, stderr };
}

Deno.test("the sink owns exactly one blank line at every declared boundary", () => {
  const { sink, stdout } = rawCapture();

  sink.boundary();
  assertEquals(stdout, [], "no boundary before any output");
  sink.write("first", "stdout");
  sink.boundary();
  sink.boundary();
  sink.line("second", "stdout");
  sink.boundary();
  sink.write("third\n", "stdout");
  sink.boundary();
  assertEquals(
    stdout.join(""),
    "first\n\nsecond\n\nthird\n\n",
  );
});

Deno.test("an even-at-start boundary writes the heading's one leading line", () => {
  const { sink, stdout } = rawCapture();
  sink.boundary({ evenAtStart: true });
  sink.line("Heading", "stdout");
  sink.boundary({ evenAtStart: true });
  sink.line("Adjacent", "stdout");
  assertEquals(stdout.join(""), "\nHeading\n\nAdjacent\n");
});

Deno.test("boundary blanks follow the last written stream", () => {
  const { sink, stdout, stderr } = rawCapture();
  sink.line("out", "stdout");
  sink.line("err", "stderr");
  sink.boundary();
  assertEquals(stdout.join(""), "out\n");
  assertEquals(stderr.join(""), "err\n\n");
  sink.boundary({ stream: "stdout" });
  assertEquals(stdout.join(""), "out\n", "an existing boundary is not doubled");
});

Deno.test("a line-oriented sink writes console lines and refuses raw text", () => {
  const { sink, stdout, stderr } = lineCapture();
  sink.line("row", "stdout");
  sink.boundary();
  sink.line("next", "stderr");
  assertEquals(stdout, ["row", ""]);
  assertEquals(stderr, ["next"]);
  assertThrows(
    () => sink.write("partial", "stdout"),
    TypeError,
    "line-oriented",
  );
});

Deno.test("the silent sink swallows everything and reports nothing written", () => {
  const sink = silentOutputSink();
  sink.write("x", "stdout");
  sink.line("y", "stderr");
  sink.boundary({ evenAtStart: true });
  assertEquals(sink.wrote(), false);
});

Deno.test("the narrator renders the one glyph grammar over the sink", () => {
  const { sink, stdout, stderr } = rawCapture();
  const narration = makeNarration(sink, terminalContext(), {
    narration: "stdout",
    alerts: "stderr",
  });
  narration.info("step");
  narration.ok("done");
  narration.heading("Section");
  narration.warn("careful");
  narration.error("failed");
  narration.detail("fine print");
  assertEquals(stdout.join(""), "◮ step\n✓ done\n\nSection\n  fine print\n");
  assertEquals(stderr.join(""), "! careful\n✕ failed\n");
});

Deno.test("the narrator inherits package Unicode and ASCII degradation", () => {
  const render = (lang: string): { stdout: string; stderr: string } => {
    const { sink, stdout, stderr } = rawCapture();
    const terminal = resolveTerminalContext({
      noColor: true,
      env: fakeEnv({ LANG: lang, TERM: "xterm" }),
      isTerminal: () => true,
      consoleSize: () => ({ columns: 80, rows: 24 }),
    });
    const narration = makeNarration(sink, terminal, {
      narration: "stdout",
      alerts: "stderr",
    });
    narration.info("step");
    narration.ok("done");
    narration.warn("careful");
    narration.error("failed");
    return { stdout: stdout.join(""), stderr: stderr.join("") };
  };

  assertEquals(render("en_GB.UTF-8"), {
    stdout: "◮ step\n✓ done\n",
    stderr: "! careful\n✕ failed\n",
  });
  assertEquals(render("C"), {
    stdout: "> step\n+ done\n",
    stderr: "! careful\nx failed\n",
  });
});

Deno.test("the one failure form is a danger line with one recovery group", () => {
  const { sink, stderr } = lineCapture();
  const narration = makeNarration(sink, terminalContext(), {
    narration: "stderr",
    alerts: "stderr",
  });
  reportFailure(narration, "the input is malformed", [
    "Run: discern --help",
  ]);
  assertEquals(stderr, [
    "✕ the input is malformed",
    "",
    "  Run: discern --help",
  ]);
});

Deno.test("a failure whose message carries its next step stays one line", () => {
  const { sink, stderr } = lineCapture();
  const narration = makeNarration(sink, terminalContext(), {
    narration: "stderr",
    alerts: "stderr",
  });
  reportFailure(narration, "nothing to land; commit first");
  assertEquals(stderr, ["✕ nothing to land; commit first"]);
});
