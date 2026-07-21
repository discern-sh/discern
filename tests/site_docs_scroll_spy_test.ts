import { assertEquals } from "@std/assert";
import { activeTocIndex } from "../site/pages/assets/docs-toc.js";

Deno.test("the contents spy reaches the final heading when the page tail is short", () => {
  const headingTops = [300, 650, 980, 1280, 1550, 1810, 2050, 2280, 2490, 2680];
  assertEquals(
    activeTocIndex({
      headingTops,
      scrollY: 2200,
      viewportHeight: 900,
      documentHeight: 3100,
      headerOffset: 72,
    }),
    9,
  );
});

Deno.test("the contents spy auto-enrols unrelated heading sets", () => {
  const cases = [
    {
      headingTops: [100, 700, 1300],
      scrollY: 0,
      viewportHeight: 600,
      documentHeight: 1900,
      expected: 0,
    },
    {
      headingTops: [100, 700, 1300],
      scrollY: 760,
      viewportHeight: 600,
      documentHeight: 1900,
      expected: 1,
    },
    {
      headingTops: [100, 700, 1300],
      scrollY: 1300,
      viewportHeight: 600,
      documentHeight: 1900,
      expected: 2,
    },
  ];
  for (const testCase of cases) {
    assertEquals(
      activeTocIndex({
        headingTops: testCase.headingTops,
        scrollY: testCase.scrollY,
        viewportHeight: testCase.viewportHeight,
        documentHeight: testCase.documentHeight,
        headerOffset: 72,
      }),
      testCase.expected,
    );
  }
});
