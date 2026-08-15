import { assertEquals, assertThrows } from "@std/assert";
import {
  measureText,
  padText,
  stripAnsi as packageStripAnsi,
  truncateText as packageTruncateText,
  wrapText as packageWrapText,
} from "discern-design-system/cli";
import {
  displayWidth,
  meter,
  padDisplayEnd,
  renderAlignedRows,
  sparkline,
  stripAnsi,
  terminalSize,
  terminalWidth,
  truncateText,
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
  assertEquals(displayWidth("🇬🇧"), 1);
  assertEquals(displayWidth("1️⃣"), 1);
  assertEquals(displayWidth(`${ESC}[31m界${ESC}[0m`), 2);
});

Deno.test("generic text facades stay exact delegates of the package authority", () => {
  const samples = [
    "plain",
    `${ESC}[31mred${ESC}[0m`,
    "e\u0301",
    "界",
    "👩‍💻",
    "🇬🇧",
    "1️⃣",
  ];
  for (const sample of samples) {
    assertEquals(displayWidth(sample), measureText(sample));
    assertEquals(stripAnsi(sample), packageStripAnsi(sample));
    assertEquals(padDisplayEnd(sample, 8), padText(sample, 8, "start"));
    assertEquals(truncateText(sample, 3), packageTruncateText(sample, 3));
  }
  assertEquals(
    wrapText("alpha beta gamma", 10),
    packageWrapText("alpha beta gamma", 10),
  );
});

Deno.test("padDisplayEnd pads visible columns without counting ANSI bytes", () => {
  const styled = `${ESC}[32mok${ESC}[0m`;
  assertEquals(padDisplayEnd(styled, 5), `${styled}   `);
  assertEquals(displayWidth(padDisplayEnd("界", 4)), 4);
  assertEquals(padDisplayEnd("long", 2), "long");
});

Deno.test("sparkline scales flat, endpoint, and negative series", () => {
  assertEquals(sparkline([]), "");
  assertEquals(sparkline([7]), "▁");
  assertEquals(sparkline([7, 7, 7]), "▁▁▁");
  assertEquals(sparkline([-10, 10]), "▁█");
  assertEquals(sparkline([-10, -5, 0]), "▁▅█");
});

Deno.test("meter splits a clamped proportion into filled cells and track", () => {
  assertEquals(meter(0, 10), { filled: "", track: "░░░░░░░░░░" });
  assertEquals(meter(1, 10), { filled: "██████████", track: "" });
  assertEquals(meter(0.5, 10), { filled: "█████", track: "░░░░░" });
  assertEquals(meter(-3, 10), { filled: "", track: "░░░░░░░░░░" });
  assertEquals(meter(7, 10), { filled: "██████████", track: "" });
});

Deno.test("meter never renders barely as none or almost as all", () => {
  assertEquals(meter(0.01, 10).filled, "█");
  assertEquals(meter(0.99, 10).filled, "█████████");
});

Deno.test("meter refuses a non-finite fraction", () => {
  assertThrows(() => meter(Number.NaN, 10), TypeError, "finite");
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

Deno.test("wrapText can hard-wrap long styled tokens without splitting graphemes", () => {
  assertEquals(
    wrapText("go abcdefgh now", 8, "  ", { breakLongWords: true }),
    ["go", "  abcdef", "  gh now"],
  );
  const styled = `${ESC}[31mabcdefgh${ESC}[0m`;
  const lines = wrapText(styled, 4, "  ", { breakLongWords: true });
  assertEquals(lines, [
    `${ESC}[31mabcd`,
    "  ef",
    `  gh${ESC}[0m`,
  ]);
  assertEquals(lines.map(displayWidth), [4, 4, 4]);
  assertEquals(
    wrapText("界界", 3, "", { breakLongWords: true }),
    ["界", "界"],
  );
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

Deno.test("terminalSize resolves one console sample, environment, and both fallbacks", () => {
  const throws = (): { columns: number; rows: number } => {
    throw new Error("not a terminal");
  };
  assertEquals(
    terminalSize({
      env: {
        get: (key) =>
          key === "COLUMNS" ? "91" : key === "LINES" ? "33" : undefined,
      },
      consoleSize: throws,
    }),
    { columns: 91, rows: 33 },
  );
  assertEquals(
    terminalSize({
      env: { get: (): undefined => undefined },
      fallbackColumns: 120,
      fallbackRows: 40,
      consoleSize: throws,
    }),
    { columns: 120, rows: 40 },
  );
  assertEquals(
    terminalSize({
      env: { get: (): undefined => undefined },
      consoleSize: () => ({ columns: 101, rows: 51 }),
    }),
    { columns: 101, rows: 51 },
  );
});

Deno.test("renderAlignedRows sizes the label column by display width under one policy", () => {
  const green = `${ESC}[32mgood${ESC}[0m`;
  const lines = renderAlignedRows([
    { label: green, body: "coverage" },
    { label: "attention", body: "gate" },
    { label: "bare", body: "" },
  ]);
  assertEquals(lines, [
    `  ${green}       coverage`,
    "  attention  gate",
    "  bare",
  ]);
  assertEquals(renderAlignedRows([]), []);
});

Deno.test("renderAlignedRows caps the label column and wraps bodies with a hanging indent", () => {
  const lines = renderAlignedRows(
    [
      { label: "name", body: "alpha beta gamma delta epsilon zeta eta theta" },
      { label: "much-longer-name", body: "short" },
    ],
    { labelCap: 10, width: 40 },
  );
  assertEquals(lines, [
    "  name        alpha beta gamma delta",
    "              epsilon zeta eta theta",
    // A label wider than the bounded column stacks its row so no line
    // overflows the listing width.
    "  much-longer-name",
    "    short",
  ]);
});

Deno.test("renderAlignedRows hard-breaks an overlong label in a width-bounded listing", () => {
  const label = `hostile${"x".repeat(33)}`;
  const lines = renderAlignedRows(
    [{ label, body: "title" }],
    { labelCap: 10, width: 24 },
  );
  for (const line of lines) {
    assertEquals(displayWidth(line) <= 24, true, line);
  }
});

Deno.test("renderAlignedRows stacks rows when the body column falls under 24 cells", () => {
  const lines = renderAlignedRows(
    [{ label: "a-rather-long-label", body: "the body wraps below" }],
    { labelCap: 32, width: 30, styleLabel: (cell) => `<${cell}>` },
  );
  assertEquals(lines, [
    "  <a-rather-long-label>",
    "    the body wraps below",
  ]);
});
