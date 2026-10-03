/**
 * Unit tests for the shared narration authority and its boundary-owning sink
 * (`src/lib/narration.ts`) — the single implementation behind the engine's
 * `Out` and the installer's `Logger`.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  makeNarration,
  makeOutputSink,
  type Narration,
  reportFailure,
  silentOutputSink,
} from "../src/lib/narration.ts";
import {
  resolveTerminalContext,
  terminalMultiline,
} from "../src/lib/terminal.ts";
import { displayWidth, stripAnsi } from "../src/lib/text.ts";
import {
  type CliPresenter,
  TERMINAL_GLYPHS,
  TRIANGLES,
} from "discern-design-system/cli";
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

/** One call that hands a narration verb the guard's prose. */
type NarrationWriter = (narration: Narration, prose: string) => void;

/** How one narration verb receives prose: rendered within the terminal width,
 * or passed through verbatim because its caller composes the layout. Each
 * contract names the call that exercises its own verb. */
type NarrationWidthContract =
  | { readonly bounded: NarrationWriter }
  | { readonly verbatim: string; readonly write: NarrationWriter };

/** Keyed by the narration interface itself, so a new verb cannot compile
 * without declaring whether it bounds its prose to the terminal width. */
const NARRATION_WIDTH_CONTRACTS = {
  info: { bounded: (narration, prose) => narration.info(prose) },
  ok: { bounded: (narration, prose) => narration.ok(prose) },
  warn: { bounded: (narration, prose) => narration.warn(prose) },
  error: { bounded: (narration, prose) => narration.error(prose) },
  heading: { bounded: (narration, prose) => narration.heading(prose) },
  group: {
    bounded: (narration, prose) => narration.group("width-guard", prose),
  },
  detail: { bounded: (narration, prose) => narration.detail(prose) },
  humanLine: {
    verbatim: "the caller composes package renderers and owns the wrapping",
    write: (narration, prose) => narration.humanLine(prose),
  },
  terminalSafeMultilineError: {
    bounded: (narration, prose) =>
      narration.terminalSafeMultilineError(
        terminalMultiline(`${prose}\n  ${prose}`),
      ),
  },
  errorBlock: {
    bounded: (narration, prose) => narration.errorBlock(`${prose}\n  ${prose}`),
  },
} satisfies Record<keyof Narration, NarrationWidthContract>;

/** Ordinary words plus one token wider than the whole guard terminal. */
const WIDTH_GUARD_PROSE =
  "Run `discern upgrade --dry-run` to preview the managed update under /very/long/path/that/cannot/fit/on/one/line before applying it.";
const WIDTH_GUARD_COLUMNS = 30;

/** What one narration call wrote, and every text the package presenter
 * received while rendering it. */
interface GuardRender {
  readonly output: string;
  readonly presented: readonly string[];
}

/** Forward every presenter call unchanged, recording its text arguments. */
function recordingPresenter(
  presenter: CliPresenter,
  presented: string[],
): CliPresenter {
  return new Proxy(presenter, {
    get(target, key, receiver): unknown {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        presented.push(
          ...args.filter((arg): arg is string => typeof arg === "string"),
        );
        return Reflect.apply(value, target, args);
      };
    },
  });
}

/** Render narration on a colour terminal of the given width. */
function renderAtWidth(
  columns: number,
  write: (narration: Narration) => void,
): GuardRender {
  const { sink, stdout, stderr } = rawCapture();
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      LANG: "en_GB.UTF-8",
      TERM: "xterm-256color",
      FORCE_COLOR: "1",
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns, rows: 24 }),
  });
  assert(terminal.color, "the width guard measures styled output");
  const presented: string[] = [];
  write(
    makeNarration(
      sink,
      {
        ...terminal,
        presenter: recordingPresenter(terminal.presenter, presented),
      },
      { narration: "stdout", alerts: "stderr" },
    ),
  );
  return { output: [...stdout, ...stderr].join(""), presented };
}

/** Render one verb on a colour terminal of the guard width. */
function renderAtGuardWidth(write: (narration: Narration) => void): string {
  return renderAtWidth(WIDTH_GUARD_COLUMNS, write).output;
}

Deno.test("every narration verb that renders prose stays within the terminal width", () => {
  const verbs = Object.keys(
    makeNarration(silentOutputSink(), pinnedTerminal(), {
      narration: "stdout",
      alerts: "stderr",
    }),
  ).sort();
  assertEquals(verbs, Object.keys(NARRATION_WIDTH_CONTRACTS).sort());

  for (const [verb, contract] of Object.entries(NARRATION_WIDTH_CONTRACTS)) {
    if ("verbatim" in contract) {
      assertEquals(
        renderAtGuardWidth((narration) =>
          contract.write(narration, WIDTH_GUARD_PROSE)
        ),
        `${WIDTH_GUARD_PROSE}\n`,
        `${verb} is verbatim because ${contract.verbatim}`,
      );
      continue;
    }
    const { output, presented } = renderAtWidth(
      WIDTH_GUARD_COLUMNS,
      (narration) => contract.bounded(narration, WIDTH_GUARD_PROSE),
    );
    const overflow = output.split("\n").filter((line) =>
      displayWidth(line) > WIDTH_GUARD_COLUMNS
    );
    assertEquals(
      overflow.map(stripAnsi),
      [],
      `${verb} must wrap prose to the ${WIDTH_GUARD_COLUMNS}-column terminal`,
    );
    assert(
      stripAnsi(output).replaceAll(/\s+/gu, "").includes(
        WIDTH_GUARD_PROSE.replaceAll(/\s+/gu, ""),
      ),
      `${verb} must keep every character of the prose it wraps`,
    );
    // Package wrapping costs more than linear time in the length of a word it
    // must split, so an overlong token reaches it already broken.
    assertEquals(
      presented.flatMap((text) => stripAnsi(text).split(/\s+/u)).filter(
        (token) => displayWidth(token) > WIDTH_GUARD_COLUMNS,
      ),
      [],
      `${verb} must break an overlong token before the package presenter wraps it`,
    );
  }
});

Deno.test("a wrapped detail keeps its indent, hangs deeper, and closes styling per line", () => {
  for (const indent of ["", "  "]) {
    const lines = renderAtGuardWidth((narration) =>
      narration.detail(`${indent}${WIDTH_GUARD_PROSE}`)
    ).trimEnd().split("\n");
    assert(lines.length > 1, "the guard prose must wrap");
    const [first = "", ...continuations] = lines;
    assert(
      first.startsWith(`  ${indent}\x1b[`),
      `detail lost the caller's indent: ${first}`,
    );
    for (const line of continuations) {
      assert(
        line.startsWith(`  ${indent}  \x1b[`),
        `a continuation must hang two cells past its item: ${line}`,
      );
    }
    for (const line of lines) {
      assert(
        line.endsWith("\x1b[0m"),
        `detail styling crosses a line end: ${line}`,
      );
    }
  }
});

Deno.test("the silent sink swallows everything and reports nothing written", () => {
  const sink = silentOutputSink();
  sink.write("x", "stdout");
  sink.line("y", "stderr");
  sink.boundary({ evenAtStart: true });
  assertEquals(sink.wrote(), false);
});
