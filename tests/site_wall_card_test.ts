/** Card content, accessible names, and bounded pointer coordinates. */
import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Card,
  cardHeading,
  cardNumeral,
  pointerOffset,
  RECEDED_ATTRIBUTE,
} from "../site/wall/Card.tsx";
import { WALL_DECK } from "../site/wall/deck.ts";

/** Read text in document order, excluding decoration hidden from assistive technology. */
function exposedText(root: Element): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    if ((node as Element).getAttribute("aria-hidden") === "true") return;
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

Deno.test("every card exposes its heading and content once, including its numeral", () => {
  for (const card of WALL_DECK) {
    const dom = new JSDOM(renderToStaticMarkup(createElement(Card, {
      card,
      receded: false,
      onOpen: () => {},
    })));
    try {
      const item = dom.window.document.querySelector("li");
      assert(item !== null, `${card.id}: a card is a list item`);
      const name = [cardNumeral(card), cardHeading(card)].filter((part) =>
        part !== undefined
      ).join(" ");
      const heading = item.querySelector("h2");
      assert(heading !== null, `${card.id}: a card has a heading`);
      assertEquals(exposedText(heading), name, card.id);
      assertEquals(
        exposedText(item),
        [name, ...(card.kind === "statement" ? [] : [card.line])].join(" "),
        card.id,
      );
      assertEquals(item.hasAttribute(RECEDED_ATTRIBUTE), false);
      for (const glyph of item.querySelectorAll(".wall-glyph")) {
        assertEquals(
          glyph.getAttribute("aria-hidden"),
          "true",
          "glyphs are decorative",
        );
      }
      const controls = item.querySelectorAll("a, button");
      assertEquals(
        controls.length,
        card.href === undefined ? 0 : 1,
        `${card.id}: only linked headings offer a server control`,
      );
      if (card.href !== undefined) {
        assertEquals(controls[0]?.getAttribute("href"), card.href, card.id);
      }
      for (const control of controls) {
        assertEquals(
          exposedText(control),
          name,
          `${card.id}: the heading names its control`,
        );
      }
    } finally {
      dom.window.close();
    }
  }
});

Deno.test("receding a card preserves its content", () => {
  const card = WALL_DECK[0];
  assert(card !== undefined);
  const dom = new JSDOM(renderToStaticMarkup(createElement(Card, {
    card,
    receded: true,
    onOpen: () => {},
  })));
  try {
    const item = dom.window.document.querySelector("li");
    assert(item !== null);
    assert(item.hasAttribute(RECEDED_ATTRIBUTE));
    assert(exposedText(item).includes(cardHeading(card)));
  } finally {
    dom.window.close();
  }
});

Deno.test("a pointer's place in a card stays within the card's edges", () => {
  assertEquals(pointerOffset(100, 100, 200), -1);
  assertEquals(pointerOffset(200, 100, 200), 0);
  assertEquals(pointerOffset(300, 100, 200), 1);
  assertEquals(pointerOffset(250, 100, 200), 0.5);
  for (const outside of [-5000, 99, 301, 5000]) {
    assertEquals(Math.abs(pointerOffset(outside, 100, 200)), 1);
  }
  for (const empty of [0, -3, Number.NaN]) {
    assertEquals(pointerOffset(150, 100, empty), 0);
  }
});
