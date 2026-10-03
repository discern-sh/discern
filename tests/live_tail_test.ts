/** The live tail: what a repainting view keeps of a streamed line. */

import { assertCases } from "./assert_cases.ts";
import { assertEquals } from "@std/assert";
import { liveTailText } from "../src/lib/live_tail.ts";

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
