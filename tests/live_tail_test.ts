/**
 * The live tail: what a repainting view keeps of a streamed line, and
 * streamed output, whose text a view reads only through that bound.
 */

import { assertCases } from "./assert_cases.ts";
import { assertEquals } from "@std/assert";
import {
  appendStreamedOutput,
  liveTailOutput,
  liveTailOutputLines,
  liveTailText,
  NO_STREAMED_OUTPUT,
  streamedOutput,
  streamedOutputIsBlank,
  wholeStreamedOutput,
} from "../src/lib/live_tail.ts";

Deno.test("the live tail keeps what the frame can show of a streamed line", () => {
  const smile = "\u{1F600}";
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
        expected: "…aaaaaEND",
      },
      {
        name: "a long line keeps a final overwrite segment the package shows",
        kind: "line",
        text: `${"a".repeat(30)}\rtail`,
        limit: 8,
        expected: "…aaa\rtail",
      },
      {
        name: "a long partial keeps its start, the row the tail shows",
        kind: "partial",
        text: `START${"a".repeat(30)}`,
        limit: 8,
        expected: "STARTaaa…",
      },
      {
        name: "a long partial keeps only its final overwrite segment",
        kind: "partial",
        text: `${"old".repeat(10)}\rNEWEST${"b".repeat(30)}`,
        limit: 8,
        expected: "NEWESTbb…",
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
        name: "a line's cut never starts inside a surrogate pair",
        kind: "line",
        text: smile.repeat(20),
        limit: 7,
        expected: `…${smile.repeat(3)}`,
      },
      {
        name: "a partial's cut never ends inside a surrogate pair",
        kind: "partial",
        text: smile.repeat(20),
        limit: 7,
        expected: `${smile.repeat(3)}…`,
      },
    ] as const,
    (row) => row.name,
    (row) => {
      assertEquals(
        liveTailText(row.kind, row.text, row.limit, "…"),
        row.expected,
      );
    },
  );
  assertEquals(
    liveTailText("line", "abcdefghij", 4, "..."),
    "...ghij",
    "an ASCII terminal marks the cut in ASCII",
  );
});

Deno.test("streamed output keeps its last lines plain and whole", () => {
  const long = "x".repeat(20_000);
  const appended = [
    "\x1b[31mfirst\x1b[0m\n",
    `${long}\nsecond\n`,
    "third",
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
        name: "every line is bounded as a committed line",
        read: () => liveTailOutput(output, 8, "…").split("\n"),
        expected: ["one", "…aaaaaEND", "  ", "two  ", "", "three", ""],
      },
      {
        name: "the last lines that carry text, trailing space removed",
        read: () => liveTailOutputLines(output, 3, 8, "…"),
        expected: ["…aaaaaEND", "two", "three"],
      },
      {
        name: "fewer lines than asked when the output holds fewer",
        read: () => liveTailOutputLines(output, 9, 8, "…"),
        expected: ["one", "…aaaaaEND", "two", "three"],
      },
      {
        name: "nothing from output that wrote nothing",
        read: () => liveTailOutputLines(NO_STREAMED_OUTPUT, 3, 8, "…"),
        expected: [],
      },
      {
        name: "a first line with nothing before it",
        read: () => liveTailOutputLines(streamedOutput("\nonly"), 3, 8, "…"),
        expected: ["only"],
      },
    ],
    (row) => row.name,
    (row) => {
      assertEquals([...row.read()], row.expected);
    },
  );
});
