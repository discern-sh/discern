import { assertEquals, assertThrows } from "@std/assert";
import {
  displayWidth,
  renderAlignedTable,
  sparkline,
  terminalWidth,
  wrapText,
} from "../src/lib/text.ts";

const ESC = String.fromCharCode(27);

Deno.test("displayWidth measures ANSI, combining, wide, and emoji graphemes", () => {
  assertEquals(displayWidth("plain"), 5);
  assertEquals(displayWidth(`${ESC}[31mred${ESC}[0m`), 3);
  assertEquals(displayWidth("→ good"), 6);
  assertEquals(displayWidth("e\u0301"), 1);
  assertEquals(displayWidth("界"), 2);
  assertEquals(displayWidth("A界"), 3);
  assertEquals(displayWidth("👩‍💻"), 2);
  assertEquals(displayWidth("🇬🇧"), 2);
  assertEquals(displayWidth("1️⃣"), 2);
  assertEquals(displayWidth(`${ESC}[31m界${ESC}[0m`), 2);
});

Deno.test("sparkline scales flat, endpoint, and negative series", () => {
  assertEquals(sparkline([]), "");
  assertEquals(sparkline([7]), "▁");
  assertEquals(sparkline([7, 7, 7]), "▁▁▁");
  assertEquals(sparkline([-10, 10]), "▁█");
  assertEquals(sparkline([-10, -5, 0]), "▁▅█");
});

Deno.test("sparkline refuses non-finite values", () => {
  assertThrows(
    () => sparkline([0, Number.NaN]),
    TypeError,
    "finite numbers",
  );
  assertThrows(
    () => sparkline([0, Number.POSITIVE_INFINITY]),
    TypeError,
    "finite numbers",
  );
});

Deno.test("wrapText handles narrow, exact, long-token, empty, and hanging-indent cases", () => {
  assertEquals(
    wrapText("alpha beta gamma", 10, "  "),
    ["alpha beta", "  gamma"],
  );
  assertEquals(wrapText("one two", 7), ["one two"]);
  assertEquals(
    wrapText("go agent/a-very-long-branch now", 8, "  "),
    ["go", "  agent/a-very-long-branch", "  now"],
  );
  assertEquals(wrapText("", 8), [""]);
  assertEquals(
    wrapText("one two three", 3, "    "),
    ["one", "    two", "    three"],
  );
});

Deno.test("wrapText measures styled words by display width", () => {
  const styled = `${ESC}[32mgood${ESC}[0m`;
  assertEquals(
    wrapText(`${styled} news today`, 9, "  "),
    [`${styled} news`, "  today"],
  );
});

Deno.test("wrapText measures wide and combining graphemes by terminal columns", () => {
  assertEquals(wrapText("界界 a", 5), ["界界", "a"]);
  assertEquals(wrapText("e\u0301 e\u0301", 3), ["e\u0301 e\u0301"]);
});

Deno.test("terminalWidth resolves console, environment, and conventional fallback", () => {
  const throws = (): { columns: number } => {
    throw new Error("not a terminal");
  };
  const noEnv = { get: (): undefined => undefined };
  assertEquals(
    terminalWidth({ env: noEnv, consoleSize: throws }),
    80,
  );
  assertEquals(
    terminalWidth({
      env: { get: (key) => key === "COLUMNS" ? "91" : undefined },
      consoleSize: throws,
    }),
    91,
  );
  assertEquals(
    terminalWidth({
      env: noEnv,
      fallback: 120,
      consoleSize: () => ({ columns: 101 }),
    }),
    101,
  );
});

Deno.test("renderAlignedTable sizes styled cells by display width and leaves the last column unpadded", () => {
  interface FindingRow {
    tone: string;
    subject: string;
  }
  const green = `${ESC}[32mgood${ESC}[0m`;
  const lines = renderAlignedTable<FindingRow>(
    [
      { header: "TONE", value: (row) => row.tone },
      { header: "FINDING", value: (row) => row.subject },
    ],
    [
      { tone: green, subject: "coverage" },
      { tone: "attention", subject: "gate" },
    ],
  );
  assertEquals(lines, [
    "TONE       FINDING",
    `${green}       coverage`,
    "attention  gate",
  ]);
  assertEquals(renderAlignedTable([], []), []);
});
