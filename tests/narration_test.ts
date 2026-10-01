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
import { resolveTerminalContext } from "../src/lib/terminal.ts";
import { TERMINAL_GLYPHS, TRIANGLES } from "discern-design-system/cli";
import { fakeEnv, pinnedTerminal } from "./helpers.ts";
import { assertNamedCases } from "./assert_cases.ts";

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

Deno.test("narration: rawCapture cases", () => {
  assertNamedCases({
    "the sink owns exactly one blank line at every declared boundary": () => {
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
    },
    "an even-at-start boundary writes the heading's one leading line": () => {
      const { sink, stdout } = rawCapture();
      sink.boundary({ evenAtStart: true });
      sink.line("Heading", "stdout");
      sink.boundary({ evenAtStart: true });
      sink.line("Adjacent", "stdout");
      assertEquals(stdout.join(""), "\nHeading\n\nAdjacent\n");
    },
    "boundary blanks follow the last written stream": () => {
      const { sink, stdout, stderr } = rawCapture();
      sink.line("out", "stdout");
      sink.line("err", "stderr");
      sink.boundary();
      assertEquals(stdout.join(""), "out\n");
      assertEquals(stderr.join(""), "err\n\n");
      sink.boundary({ stream: "stdout" });
      assertEquals(
        stdout.join(""),
        "out\n",
        "an existing boundary is not doubled",
      );
    },
    "the narrator renders the one glyph grammar over the sink": () => {
      const { sink, stdout, stderr } = rawCapture();
      const narration = makeNarration(sink, pinnedTerminal(), {
        narration: "stdout",
        alerts: "stderr",
      });
      narration.info("step");
      narration.ok("done");
      narration.heading("Section");
      narration.warn("careful");
      narration.error("failed");
      narration.detail("fine print");
      assertEquals(
        stdout.join(""),
        "▸ step\n✓ done\n\nSection\n  fine print\n",
      );
      assertEquals(stderr.join(""), "! careful\n✕ failed\n");
    },
    "the narrator inherits package Unicode and ASCII degradation": () => {
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

      // Each mark is the package's own glyph in the terminal's character
      // set, so the narrator draws whatever the package draws.
      const expected = (form: "unicode" | "ascii") => ({
        stdout: `${TRIANGLES.filledSmall.right[form]} step\n${
          TERMINAL_GLYPHS.done[form]
        } done\n`,
        stderr: `${TERMINAL_GLYPHS.attention[form]} careful\n${
          TERMINAL_GLYPHS.failed[form]
        } failed\n`,
      });
      assertEquals(render("en_GB.UTF-8"), expected("unicode"));
      assertEquals(render("en_GB.UTF-8").stdout, "▸ step\n✓ done\n");
      assertEquals(render("C"), expected("ascii"));
    },
    "the narrator delegates hanging-indent wrapping to the package": () => {
      const { sink, stdout } = rawCapture();
      const terminal = resolveTerminalContext({
        noColor: true,
        env: fakeEnv({ LANG: "en_GB.UTF-8", TERM: "xterm" }),
        isTerminal: () => true,
        consoleSize: () => ({ columns: 20, rows: 24 }),
      });
      const narration = makeNarration(sink, terminal, {
        narration: "stdout",
        alerts: "stderr",
      });

      narration.info("one two three four five");

      assertEquals(stdout.join(""), "▸ one two three four\n  five\n");
    },
  });
});
Deno.test("narration: lineCapture cases", () => {
  assertNamedCases({
    "a line-oriented sink writes console lines and refuses raw text": () => {
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
    },
    "the one failure form is a danger line with one recovery group": () => {
      const { sink, stderr } = lineCapture();
      const narration = makeNarration(sink, pinnedTerminal(), {
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
    },
    "a failure whose message carries its next step stays one line": () => {
      const { sink, stderr } = lineCapture();
      const narration = makeNarration(sink, pinnedTerminal(), {
        narration: "stderr",
        alerts: "stderr",
      });
      reportFailure(narration, "nothing to land; commit first");
      assertEquals(stderr, ["✕ nothing to land; commit first"]);
    },
  });
});

Deno.test("the silent sink swallows everything and reports nothing written", () => {
  const sink = silentOutputSink();
  sink.write("x", "stdout");
  sink.line("y", "stderr");
  sink.boundary({ evenAtStart: true });
  assertEquals(sink.wrote(), false);
});
