/**
 * The live tail: what a repainting view keeps of a streamed line, and
 * streamed output, whose text a view reads only through that bound.
 */

import { assertCases } from "./assert_cases.ts";
import { assert, assertEquals } from "@std/assert";
import { displayWidth } from "../src/lib/text.ts";
import {
  appendStreamedOutput,
  type LiveTailLimit,
  liveTailLimit,
  liveTailOutput,
  liveTailOutputLines,
  liveTailText,
  NO_STREAMED_OUTPUT,
  streamedOutput,
  streamedOutputIsBlank,
  wholeStreamedOutput,
} from "../src/lib/live_tail.ts";

/** A limit of `count` code units: one row of that many columns, fitted. */
function units(count: number): LiveTailLimit {
  return liveTailLimit("fit", count, 1);
}

Deno.test("the live tail keeps what the frame can show of a streamed line", () => {
  const smile = "\u{1F600}";
  const flag = "\u{1F1EC}\u{1F1E7}";
  const accented = "e\u0301";
  const red = (text: string): string => `\x1b[38;5;196m${text}\x1b[0m`;
  assertCases(
    [
      {
        name: "a line within the limit is unchanged",
        kind: "line",
        text: "short\rline",
        limit: 20,
        expected: "short\rline",
      },
      {
        name: "a partial within the limit is unchanged",
        kind: "partial",
        text: "short\rpartial",
        limit: 20,
        expected: "short\rpartial",
      },
      {
        name: "a long line keeps its end, the rows the tail shows",
        kind: "line",
        text: `${"a".repeat(30)}END`,
        limit: 8,
        expected: "…aaaaEND",
      },
      {
        name: "a long line keeps a final overwrite segment the package shows",
        kind: "line",
        text: `${"a".repeat(30)}\rtail`,
        limit: 8,
        expected: "…aa\rtail",
      },
      {
        name: "a long partial keeps its start, the row the tail shows",
        kind: "partial",
        text: `START${"a".repeat(30)}`,
        limit: 8,
        expected: "STARTaa…",
      },
      {
        name: "a long partial keeps only its final overwrite segment",
        kind: "partial",
        text: `${"old".repeat(10)}\rNEWEST${"b".repeat(30)}`,
        limit: 8,
        expected: "NEWESTb…",
      },
      {
        name: "a final overwrite segment within the limit is kept whole",
        kind: "partial",
        text: `${"old".repeat(10)}\rnewest`,
        limit: 8,
        expected: "newest",
      },
      {
        name: "a trailing carriage return keeps the segment before it",
        kind: "partial",
        text: `${"old".repeat(10)}\rnewest\r`,
        limit: 8,
        expected: "newest",
      },
      {
        name: "a long scrolled line keeps its start and its end",
        kind: "scrolled",
        text: `START${"a".repeat(30)}END`,
        limit: 8,
        expected: "STAR…END",
      },
      {
        name: "a scrolled line's cuts fall between graphemes",
        kind: "scrolled",
        text: flag.repeat(10),
        limit: 12,
        expected: `${flag}…${flag}`,
      },
      {
        name: "a scrolled line's cuts never fall inside an escape sequence",
        kind: "scrolled",
        text: red("X").repeat(20),
        limit: 8,
        expected: "XXXX…XXX",
      },
      {
        name: "styling does not spend the limit",
        kind: "line",
        text: red("styled"),
        limit: 8,
        expected: "styled",
      },
      {
        name: "a line's cut never starts inside an escape sequence",
        kind: "line",
        text: `${red("X").repeat(20)}END`,
        limit: 8,
        expected: "…XXXXEND",
      },
      {
        name: "a partial's cut never ends inside an escape sequence",
        kind: "partial",
        text: `START${red("X").repeat(20)}`,
        limit: 8,
        expected: "STARTXX…",
      },
      {
        name: "a hyperlink keeps its label and spends nothing else",
        kind: "partial",
        text: `\x1b]8;;https://example.com\x07link\x1b]8;;\x07${
          "y".repeat(20)
        }`,
        limit: 8,
        expected: "linkyyy…",
      },
      {
        name: "a line's cut never starts inside a surrogate pair",
        kind: "line",
        text: smile.repeat(20),
        limit: 8,
        expected: `…${smile.repeat(3)}`,
      },
      {
        name: "a partial's cut never ends inside a surrogate pair",
        kind: "partial",
        text: smile.repeat(20),
        limit: 8,
        expected: `${smile.repeat(3)}…`,
      },
      {
        name: "a line's cut never splits a regional-indicator pair",
        kind: "line",
        text: flag.repeat(10),
        limit: 7,
        expected: `…${flag}`,
      },
      {
        name: "a partial's cut never splits a regional-indicator pair",
        kind: "partial",
        text: flag.repeat(10),
        limit: 7,
        expected: `${flag}…`,
      },
      {
        name: "a line's cut never separates a combining mark from its letter",
        kind: "line",
        text: accented.repeat(10),
        limit: 8,
        expected: `…${accented.repeat(3)}`,
      },
      {
        name:
          "a partial's cut never separates a combining mark from its letter",
        kind: "partial",
        text: accented.repeat(10),
        limit: 8,
        expected: `${accented.repeat(3)}…`,
      },
    ] as const,
    (row) => row.name,
    (row) => {
      const kept = liveTailText(row.kind, row.text, units(row.limit), "…");
      assertEquals(kept, row.expected);
      assert(kept.length <= row.limit, `${kept.length} > ${row.limit}`);
    },
  );
  assertEquals(
    liveTailText("line", "abcdefghij", units(7), "..."),
    "...ghij",
    "an ASCII terminal marks the cut in ASCII",
  );
});

Deno.test("a limit fills a clipping view's rows and fits a view that shows every row", () => {
  const [columns, rows] = [10, 3];
  const rowsOf = (kept: string): number =>
    Math.ceil(displayWidth(kept) / columns);
  for (const character of ["x", "\u754C", "\u{1F600}"]) {
    const line = character.repeat(400);
    const filled = liveTailText(
      "line",
      line,
      liveTailLimit("fill", columns, rows),
      "…",
    );
    assert(
      rowsOf(filled) > rows,
      `a clipping view keeps more than its rows of ${character}: ${filled}`,
    );
  }
  const fitted = liveTailText(
    "line",
    "x".repeat(400),
    liveTailLimit("fit", columns, rows),
    "…",
  );
  assertEquals(
    rowsOf(fitted),
    rows,
    "a line of narrow characters fills a view that shows every row exactly",
  );
});

Deno.test("streamed output keeps its last lines plain and whole", () => {
  const long = "x".repeat(20_000);
  const appended = [
    "first\n",
    `${long}\nsec\x1b[31mond\x1b[0m\n`,
    "\x1b]8;;https://example.com\x07third\x1b]8;;\x07",
  ].reduce(
    (output, chunk) => appendStreamedOutput(output, streamedOutput(chunk), 3),
    NO_STREAMED_OUTPUT,
  );
  assertEquals(
    wholeStreamedOutput(appended),
    `${long}\nsecond\nthird`,
    "the last lines survive whole, without terminal styling",
  );
  assertEquals(
    wholeStreamedOutput(
      appendStreamedOutput(NO_STREAMED_OUTPUT, streamedOutput("a\nb"), 3),
    ),
    "a\nb",
    "fewer lines than the limit are kept as written",
  );
  assertEquals(streamedOutputIsBlank(NO_STREAMED_OUTPUT), true);
  assertEquals(streamedOutputIsBlank(streamedOutput(" \n\t")), true);
  assertEquals(streamedOutputIsBlank(appended), false);
});

Deno.test("streamed output never converts to its text by accident", () => {
  const output = streamedOutput("a line a view must bound");
  for (
    const converted of [`${output}`, String(output), JSON.stringify(output)]
  ) {
    assertEquals(converted.includes("a line"), false, converted);
  }
});

Deno.test("a view reads streamed output only through the live tail", () => {
  const long = `START${"a".repeat(30)}END`;
  const output = streamedOutput(`one\n${long}\n  \ntwo  \n\nthree\n`);
  assertCases(
    [
      {
        name: "every line keeps its start and its end, for a reader",
        read: () => liveTailOutput(output, units(8), "…").split("\n"),
        expected: ["one", "STAR…END", "  ", "two  ", "", "three", ""],
      },
      {
        name: "the last lines that carry text, trailing space removed",
        read: () => liveTailOutputLines(output, 3, units(8), "…"),
        expected: ["…aaaaEND", "two", "three"],
      },
      {
        name: "fewer lines than asked when the output holds fewer",
        read: () => liveTailOutputLines(output, 9, units(8), "…"),
        expected: ["one", "…aaaaEND", "two", "three"],
      },
      {
        name: "nothing from output that wrote nothing",
        read: () => liveTailOutputLines(NO_STREAMED_OUTPUT, 3, units(8), "…"),
        expected: [],
      },
      {
        name: "a first line with nothing before it",
        read: () =>
          liveTailOutputLines(streamedOutput("\nonly"), 3, units(8), "…"),
        expected: ["only"],
      },
    ],
    (row) => row.name,
    (row) => {
      assertEquals([...row.read()], row.expected);
    },
  );
});
