import { assertEquals, assertThrows } from "@std/assert";
import { formatHumanNumber } from "../src/shared/human_number.ts";

Deno.test("formatHumanNumber keeps 4 significant digits and groups smaller values", () => {
  const cases = [
    { value: 0, expected: "0" },
    { value: -0, expected: "0" },
    { value: 999, expected: "999" },
    { value: 1_000, expected: "1,000" },
    { value: 999_999, expected: "999,999" },
    { value: 12.577429802219916, expected: "12.58" },
    { value: 0.123456, expected: "0.1235" },
    { value: -0.000123456, expected: "-0.0001235" },
  ] as const;
  for (const { value, expected } of cases) {
    assertEquals(formatHumanNumber(value), expected, String(value));
  }
});

Deno.test("formatHumanNumber abbreviates million-scale values", () => {
  const cases = [
    { value: 1_000_000, expected: "1M" },
    { value: 157_053_944, expected: "157.1M" },
    { value: -160_261_296, expected: "-160.3M" },
    { value: 2_400_000_000, expected: "2.4B" },
  ] as const;
  for (const { value, expected } of cases) {
    assertEquals(formatHumanNumber(value), expected, String(value));
  }
});

Deno.test("formatHumanNumber refuses non-finite evidence", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => formatHumanNumber(value), TypeError);
  }
});
