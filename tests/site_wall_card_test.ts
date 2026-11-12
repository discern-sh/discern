/**
 * The wall's cards hold their contract: the markup of each kind, what
 * assistive technology reads from a card, the type the wall is set in, and the
 * stylesheet rules that keep a hovered card from disturbing any other.
 *
 * A real browser holds what only layout can show: a card the keyboard
 * reaches comes to rest clear of the bar pinned over the wall, a heading
 * wraps a word longer than its card is wide, and a benefit card sets its
 * glyph beside its words exactly where the wall is one column.
 */
import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WALL_STYLESHEETS } from "../site/wall/assets.ts";
import {
  Card,
  CARD_LIGHT,
  cardGlyph,
  cardHeading,
  cardNumeral,
  pointerOffset,
  RECEDED_ATTRIBUTE,
} from "../site/wall/Card.tsx";
import { WALL_DECK } from "../site/wall/deck.ts";
import type { WallCard } from "../site/wall/types.ts";
import {
  declared,
  MOTION_PROPERTY,
  movesByChoice,
  readWallSheet,
  selectsCardItem,
  splitOutside,
  type StyleRule,
  styleRules,
  withoutComments,
} from "./wall_stylesheets.ts";

/** The stylesheet this suite holds to the card rules. */
const CARD_SHEET = "wall-card.css";

/** Render one card as the server does and hand back its list item. */
function renderCard(
  card: WallCard,
  receded = false,
): { readonly item: Element; readonly close: () => void } {
  const dom = new JSDOM(
    `<ul>${
      renderToStaticMarkup(
        createElement(Card, { card, receded, onOpen: () => {} }),
      )
    }</ul>`,
  );
  const item = dom.window.document.querySelector("ul > li");
  assert(item !== null, `${card.id} renders one list item`);
  return { item, close: () => dom.window.close() };
}

/** An element's tag and classes, as `tag.class.class`. */
function shape(element: Element): string {
  return [element.tagName.toLowerCase(), ...element.classList].join(".");
}

/**
 * The words under `root` in document order, with runs of white space
 * collapsed to one space. `exposed` keeps only what assistive technology
 * reads: the text no `aria-hidden` ancestor removes.
 */
function words(root: Element, exposed: boolean): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    if (exposed && (node as Element).getAttribute("aria-hidden") === "true") {
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The text assistive technology reads from `root`. */
function exposedText(root: Element): string {
  return words(root, true);
}

/** Every word a card's front carries, in the order a reader meets them. */
function cardCopy(card: WallCard): string {
  const numeral = cardNumeral(card);
  return [
    ...(numeral === undefined ? [] : [numeral]),
    cardHeading(card),
    ...(card.kind === "statement" ? [] : [card.line]),
  ].join(" ");
}

/** The box that draws the pointer light on a card, as the face's first child. */
const LIGHT_BOX = `span.${CARD_LIGHT}`;

/** The face's children for each kind, in order. */
const FACE: Readonly<Record<WallCard["kind"], readonly string[]>> = {
  benefit: [
    LIGHT_BOX,
    "span.wall-glyph.wall-card-glyph",
    "h2.wall-card-title",
    "p.wall-card-line",
  ],
  statement: [LIGHT_BOX, "h2.wall-card-title"],
  numeral: [LIGHT_BOX, "h2.wall-card-title", "p.wall-card-line"],
};

Deno.test("every card in the deck renders its kind's markup", () => {
  const kinds = new Set(WALL_DECK.map((card) => card.kind));
  assertEquals(
    [...kinds].sort(),
    Object.keys(FACE).sort(),
    "the deck exercises every kind this contract names",
  );

  for (const card of WALL_DECK) {
    const { item, close } = renderCard(card);
    assertEquals(shape(item), `li.wall-card.wall-card--${card.kind}`, card.id);
    assertEquals(item.getAttribute("data-card"), card.id);
    assertEquals(item.hasAttribute(RECEDED_ATTRIBUTE), false, card.id);
    assert(
      /--wall-hue:\s*\d+/.test(item.getAttribute("style") ?? ""),
      `${card.id} carries its cluster hue`,
    );

    assertEquals([...item.children].map(shape), ["div.wall-card-face"]);
    const face = item.firstElementChild;
    assert(face !== null);
    assertEquals([...face.children].map(shape), FACE[card.kind], card.id);
    // The light writes on this box every frame it moves, and a box with
    // anything inside it would have that restyled too.
    assertEquals(
      face.firstElementChild?.childNodes.length,
      0,
      `${card.id}: the light box is empty`,
    );

    // One control per card, in the heading, named by its own content.
    const controls = item.querySelectorAll("a, button, input, [tabindex]");
    assertEquals(controls.length, 1, `${card.id} has exactly one control`);
    const button = face.querySelector(
      "h2.wall-card-title > button.wall-card-open",
    );
    assert(button !== null, `${card.id} keeps its button in its heading`);
    assertEquals(button, controls[0]);
    assertEquals(button.getAttribute("type"), "button");
    assertEquals(button.getAttribute("aria-haspopup"), "dialog");
    for (const naming of ["aria-label", "aria-labelledby"]) {
      assertEquals(
        button.hasAttribute(naming),
        false,
        `${card.id}: the button's words are its name, so ${naming} would hide them`,
      );
    }

    const glyph = face.querySelector(".wall-card-glyph");
    assertEquals(glyph !== null, cardGlyph(card) !== undefined, card.id);
    if (glyph !== null) {
      assertEquals(glyph.getAttribute("aria-hidden"), "true", card.id);
    }

    const numerals = face.querySelectorAll(".wall-card-numeral");
    const numeral = cardNumeral(card);
    assertEquals(numerals.length, numeral === undefined ? 0 : 1, card.id);
    if (numeral !== undefined) {
      assertEquals(numerals[0]?.textContent, numeral);
      assertEquals(
        numerals[0],
        button.firstElementChild,
        `${card.id} leads its heading with its number`,
      );
    }
    close();
  }

  const first = WALL_DECK[0];
  assert(first !== undefined);
  const receded = renderCard(first, true);
  assertEquals(receded.item.getAttribute(RECEDED_ATTRIBUTE), "");
  receded.close();
});

Deno.test("assistive technology reads each card's words once, in reading order", () => {
  const numeralCards = WALL_DECK.filter((card) => card.kind === "numeral");
  assert(numeralCards.length > 0, "the deck has a numeral card to hold");

  for (const card of WALL_DECK) {
    const { item, close } = renderCard(card);
    const copy = cardCopy(card);

    // Nothing a sighted reader sees is withheld, and nothing is said twice.
    assertEquals(exposedText(item), copy, card.id);
    assertEquals(
      words(item, false),
      copy,
      `${card.id} shows no words it hides from assistive technology`,
    );

    // The button's name is the whole heading, number included, so the card
    // reads the same by heading, by control, and from top to bottom.
    const button = item.querySelector(".wall-card-open");
    assert(button !== null);
    const numeral = cardNumeral(card);
    const name = numeral === undefined
      ? cardHeading(card)
      : `${numeral} ${cardHeading(card)}`;
    assertEquals(exposedText(button), name, card.id);
    const heading = item.querySelector("h2");
    assert(heading !== null);
    assertEquals(exposedText(heading), name, card.id);
    close();
  }

  // The number is one node, exposed, and never repeated for assistive
  // technology: a hidden numeral leaves "That's how many…" with no number.
  for (const card of numeralCards) {
    const { item, close } = renderCard(card);
    const exposed = [...item.querySelectorAll("*")].filter((element) =>
      element.children.length === 0 &&
      (element.textContent ?? "").trim() === card.numeral &&
      element.closest('[aria-hidden="true"]') === null
    );
    assertEquals(
      exposed.map(shape),
      ["span.wall-card-numeral"],
      `${card.id} exposes its number exactly once`,
    );
    assert(
      exposedText(item).startsWith(`${card.numeral} ${card.title}`),
      `${card.id} reads its number before its title`,
    );
    close();
  }
});

Deno.test("a pointer's place in a card stays within the card's edges", () => {
  assertEquals(pointerOffset(100, 100, 200), -1);
  assertEquals(pointerOffset(200, 100, 200), 0);
  assertEquals(pointerOffset(300, 100, 200), 1);
  assertEquals(pointerOffset(250, 100, 200), 0.5);
  // The tilt is this number times the knob, so it must never pass 1.
  for (const outside of [-5000, 99, 301, 5000]) {
    assertEquals(Math.abs(pointerOffset(outside, 100, 200)), 1);
  }
  for (const empty of [0, -3, Number.NaN]) {
    assertEquals(pointerOffset(150, 100, empty), 0, "an unmeasured card");
  }
});

Deno.test("the wall is set in sans-serif type alone", async () => {
  const families = new Set([
    "var(--discern-font-ui)",
    "var(--discern-font-marketing)",
    "var(--discern-font-mono)",
  ]);
  const violations: string[] = [];
  for (const sheet of WALL_STYLESHEETS) {
    const text = withoutComments(await readWallSheet(sheet));
    if (text.includes("--discern-font-display")) {
      violations.push(`${sheet} reads the display serif token`);
    }
    if (/(?<![\w-])serif\b/i.test(text)) {
      violations.push(`${sheet} names a serif family`);
    }
    for (const rule of styleRules(text)) {
      for (const [property, value] of rule.declarations) {
        if (
          property === "font-family" && value !== "inherit" &&
          !families.has(value)
        ) {
          violations.push(
            `${sheet}: ${rule.prelude} sets font-family: ${value}`,
          );
        }
        if (property === "font" && value !== "inherit") {
          violations.push(`${sheet}: ${rule.prelude} sets font: ${value}`);
        }
      }
    }
  }
  assertEquals(violations, []);

  // The check above can fail: it reads real declarations out of these sheets.
  const seen = (await Promise.all(WALL_STYLESHEETS.map(readWallSheet))).flatMap(
    (text) =>
      styleRules(text).flatMap((rule) =>
        rule.declarations.filter(([property]) => property === "font-family")
      ),
  );
  assert(seen.length > 0, "the wall stylesheets declare their type");
});

Deno.test("no wall surface blurs what is behind it", async () => {
  for (const sheet of WALL_STYLESHEETS) {
    assertEquals(
      /backdrop-filter/.test(withoutComments(await readWallSheet(sheet))),
      false,
      `${sheet} uses backdrop-filter`,
    );
  }
});

/** The card stylesheet's rules. */
async function cardRules(): Promise<StyleRule[]> {
  const rules = styleRules(await readWallSheet(CARD_SHEET));
  assert(rules.length > 0);
  return rules;
}

/** The face, with none of its pseudo-elements. */
const FACE_SUBJECT = /\.wall-card-face$/;

Deno.test("card motion lives on the face, and the list item is left to the lens", async () => {
  const rules = await cardRules();
  const reserved =
    /^(?:transform|translate|rotate|scale|transition(?:-.+)?|animation(?:-.+)?|opacity|filter|will-change|z-index)$/;
  const onItem = rules.flatMap((rule) =>
    rule.selectors.filter(selectsCardItem).flatMap((selector) =>
      rule.declarations.filter(([property]) => reserved.test(property)).map((
        [property],
      ) => `${selector} { ${property} }`)
    )
  );
  assertEquals(
    onItem,
    [],
    "opacity, filter, and transitions on the list item belong to the lens, and a transform there would move the masonry",
  );

  assert(
    rules.some((rule) =>
      rule.selectors.some((selector) => FACE_SUBJECT.test(selector)) &&
      declared(rule, "transform") !== undefined
    ),
    "the hover lift is a transform on the face",
  );
});

Deno.test("cards animate transform and opacity, and stay still for a reader who asks", async () => {
  const rules = await cardRules();
  const violations: string[] = [];
  let transitions = 0;
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (/^animation/.test(property)) {
        violations.push(`${rule.prelude} animates with ${property}`);
      }
      if (MOTION_PROPERTY.test(property) && !movesByChoice(rule)) {
        violations.push(
          `${rule.prelude} sets ${property} outside prefers-reduced-motion: no-preference`,
        );
      }
      if (property !== "transition") continue;
      for (const item of splitOutside(value, ",")) {
        transitions++;
        const [name, duration] = item.split(" ");
        // The stacking order may switch, at once, after a delay; it is never
        // tweened.
        const allowed = name === "transform" || name === "opacity" ||
          (name === "z-index" && duration === "0s");
        if (!allowed) violations.push(`${rule.prelude} transitions ${item}`);
      }
    }
  }
  assertEquals(violations, []);
  assert(transitions > 0, "the card stylesheet declares its transitions");
});

Deno.test("hover applies only where a pointer can hover", async () => {
  const stuck = (await cardRules()).filter((rule) =>
    rule.prelude.includes(":hover") &&
    !rule.context.some((query) => query.includes("hover: hover"))
  ).map((rule) => rule.prelude);
  assertEquals(stuck, [], "a touch screen would leave these stuck after a tap");
});

Deno.test("no wall surface is placed by the viewport", async () => {
  // A background fixed to the viewport is repainted on every frame the page
  // scrolls, and is drawn in the wrong place on anything that has moved.
  const fixed: string[] = [];
  let surfaces = 0;
  for (const sheet of WALL_STYLESHEETS) {
    for (const rule of styleRules(await readWallSheet(sheet))) {
      for (const [property, value] of rule.declarations) {
        if (!/^(?:background(?:-attachment)?|--[\w-]+)$/.test(property)) {
          continue;
        }
        surfaces++;
        if (/\bfixed\b/.test(value)) {
          fixed.push(`${sheet}: ${rule.prelude} { ${property} }`);
        }
      }
    }
  }
  assertEquals(fixed, []);
  assert(surfaces > 0, "the wall stylesheets declare their surfaces");
});

Deno.test("print and forced colors get flat cards in system colors", async () => {
  const rules = await cardRules();
  for (const mode of ["forced-colors: active", "print"]) {
    const flat = rules.find((rule) =>
      rule.prelude === ".wall-card-face" &&
      rule.context.some((query) => query.includes(mode))
    );
    assert(flat !== undefined, `${mode} restyles the face`);
    assertEquals(declared(flat, "background"), "Canvas", mode);
    assertEquals(declared(flat, "color"), "CanvasText", mode);
    assertEquals(declared(flat, "border-color"), "CanvasText", mode);
    assertEquals(declared(flat, "box-shadow"), "none", mode);
  }
  // The pointer light has no meaning in either, so its box is not drawn.
  for (const mode of ["forced-colors: active", "print"]) {
    assert(
      rules.some((rule) =>
        rule.selectors.includes(`.${CARD_LIGHT}`) &&
        rule.context.some((query) => query.includes(mode)) &&
        declared(rule, "display") === "none"
      ),
      `${mode} leaves the light box out`,
    );
  }
  // The wall is dark, so paper needs the light scheme's system colors.
  assert(
    rules.some((rule) =>
      rule.prelude === ".wall-card" &&
      rule.context.some((query) => query === "@media print") &&
      declared(rule, "color-scheme") === "light"
    ),
    "printed cards resolve system colors against a light page",
  );
});
