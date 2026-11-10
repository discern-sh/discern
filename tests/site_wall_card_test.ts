/**
 * The wall's cards hold their contract: the markup of each kind, what
 * assistive technology reads from a card, the type the wall is set in, and the
 * stylesheet rules that keep a hovered card from disturbing any other.
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WALL_STYLESHEETS } from "../site/wall/assets.ts";
import {
  Card,
  cardGlyph,
  cardHeading,
  cardNumeral,
  pointerOffset,
} from "../site/wall/Card.tsx";
import { WALL_DECK } from "../site/wall/deck.ts";
import { WALL_KNOBS } from "../site/wall/tuning/knobs.ts";
import type { WallCard } from "../site/wall/types.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** The stylesheet this suite holds to the card rules. */
const CARD_SHEET = "wall-card.css";

/** Read one of the wall's stylesheets from its source. */
function readSheet(sheet: string): Promise<string> {
  return Deno.readTextFile(join(ROOT, "site/page-src", sheet));
}

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

/** The face's children for each kind, in order. */
const FACE: Readonly<Record<WallCard["kind"], readonly string[]>> = {
  benefit: [
    "svg.wall-glyph.wall-card-glyph",
    "h2.wall-card-title",
    "p.wall-card-line",
  ],
  statement: ["h2.wall-card-title"],
  numeral: ["h2.wall-card-title", "p.wall-card-line"],
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
    assertEquals(item.hasAttribute("data-receded"), false, card.id);
    assert(
      /--wall-hue:\s*\d+/.test(item.getAttribute("style") ?? ""),
      `${card.id} carries its cluster hue`,
    );

    assertEquals([...item.children].map(shape), ["div.wall-card-face"]);
    const face = item.firstElementChild;
    assert(face !== null);
    assertEquals([...face.children].map(shape), FACE[card.kind], card.id);

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
  assertEquals(receded.item.getAttribute("data-receded"), "");
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
    const text = withoutComments(await readSheet(sheet));
    if (text.includes("--discern-font-display")) {
      violations.push(`${sheet} reads the display serif token`);
    }
    if (/(?<![\w-])serif\b/i.test(text)) {
      violations.push(`${sheet} names a serif family`);
    }
    for (const rule of cssRules(text)) {
      for (const [property, value] of rule.declarations) {
        if (
          property === "font-family" && value !== "inherit" &&
          !families.has(value)
        ) {
          violations.push(
            `${sheet}: ${rule.selector} sets font-family: ${value}`,
          );
        }
        if (property === "font" && value !== "inherit") {
          violations.push(`${sheet}: ${rule.selector} sets font: ${value}`);
        }
      }
    }
  }
  assertEquals(violations, []);

  // The check above can fail: it reads real declarations out of these sheets.
  const seen = (await Promise.all(WALL_STYLESHEETS.map(readSheet))).flatMap(
    (text) =>
      cssRules(withoutComments(text)).flatMap((rule) =>
        rule.declarations.filter(([property]) => property === "font-family")
      ),
  );
  assert(seen.length > 0, "the wall stylesheets declare their type");
});

Deno.test("no wall surface blurs what is behind it", async () => {
  for (const sheet of WALL_STYLESHEETS) {
    assertEquals(
      /backdrop-filter/.test(withoutComments(await readSheet(sheet))),
      false,
      `${sheet} uses backdrop-filter`,
    );
  }
});

interface CssRule {
  /** The rule's selector list, white space collapsed. */
  readonly selector: string;
  /** The at-rules that enclose it, outermost first. */
  readonly context: readonly string[];
  readonly declarations: readonly (readonly [string, string])[];
}

/** A stylesheet with its comments removed. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split `text` on `separator` wherever it sits outside every parenthesis. */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.replace(/\s+/g, " ").trim()).filter((part) =>
    part !== ""
  );
}

/**
 * The style rules of a comment-free stylesheet, each with the at-rules around
 * it. The wall's stylesheets nest rules only inside at-rules, which is all
 * this reads.
 */
function cssRules(text: string, context: readonly string[] = []): CssRule[] {
  const rules: CssRule[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}") depth--;
      close++;
    }
    const prelude = text.slice(at, open).replace(/\s+/g, " ").trim();
    const body = text.slice(open + 1, close - 1);
    if (prelude.startsWith("@")) {
      rules.push(...cssRules(body, [...context, prelude]));
    } else {
      rules.push({
        selector: prelude,
        context,
        declarations: splitOutside(body, ";").map((declaration) => {
          const colon = declaration.indexOf(":");
          return [
            declaration.slice(0, colon).trim(),
            declaration.slice(colon + 1).trim(),
          ] as const;
        }),
      });
    }
    at = close;
  }
  return rules;
}

/** The card stylesheet's rules. */
async function cardRules(): Promise<CssRule[]> {
  const rules = cssRules(withoutComments(await readSheet(CARD_SHEET)));
  assert(rules.length > 0);
  return rules;
}

/** A rule's selectors, one per entry of its selector list. */
function selectors(rule: CssRule): string[] {
  return splitOutside(rule.selector, ",");
}

/** One declaration's value in a rule, when the rule makes it. */
function declared(rule: CssRule, property: string): string | undefined {
  return rule.declarations.find(([name]) => name === property)?.[1];
}

/** Whether a rule applies only where the reader has not asked for less motion. */
function movesOnlyByChoice(rule: CssRule): boolean {
  return rule.context.some((query) =>
    query.includes("prefers-reduced-motion: no-preference")
  );
}

/** The face, with none of its pseudo-elements. */
const FACE_SUBJECT = /\.wall-card-face$/;

Deno.test("card motion lives on the face, and the list item is left to the lens", async () => {
  const rules = await cardRules();
  const reserved =
    /^(?:transform|translate|rotate|scale|transition(?:-.+)?|animation(?:-.+)?|opacity|filter|will-change|z-index)$/;
  const onItem = rules.flatMap((rule) =>
    selectors(rule).filter((selector) =>
      /(?:^|\s)\.wall-card(?:--[\w-]+)?(?![\w-])\S*$/.test(selector)
    ).flatMap((selector) =>
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
      selectors(rule).some((selector) => FACE_SUBJECT.test(selector)) &&
      declared(rule, "transform") !== undefined
    ),
    "the hover lift is a transform on the face",
  );
});

Deno.test("cards animate transform and opacity, and stay still for a reader who asks", async () => {
  const rules = await cardRules();
  const moving = /^(?:transform|will-change|transition(?:-.+)?)$/;
  const violations: string[] = [];
  let transitions = 0;
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (/^animation/.test(property)) {
        violations.push(`${rule.selector} animates with ${property}`);
      }
      if (moving.test(property) && !movesOnlyByChoice(rule)) {
        violations.push(
          `${rule.selector} sets ${property} outside prefers-reduced-motion: no-preference`,
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
        if (!allowed) violations.push(`${rule.selector} transitions ${item}`);
      }
    }
  }
  assertEquals(violations, []);
  assert(transitions > 0, "the card stylesheet declares its transitions");
});

Deno.test("hover applies only where a pointer can hover", async () => {
  const stuck = (await cardRules()).filter((rule) =>
    rule.selector.includes(":hover") &&
    !rule.context.some((query) => query.includes("hover: hover"))
  ).map((rule) => rule.selector);
  assertEquals(stuck, [], "a touch screen would leave these stuck after a tap");
});

Deno.test("the hover tilt is the knob's angle at most, and the lift a few pixels", async () => {
  const knob = WALL_KNOBS.find((candidate) => candidate.name === "hover-tilt");
  assert(knob !== undefined, "the hover-tilt knob sets the tilt");
  assertEquals(knob.unit, "deg");
  assertEquals(knob.min, 0, "the tilt can be turned off");
  assert(knob.default <= 1.5, "the shipped tilt is 1.5 degrees at most");

  const sheet = withoutComments(await readSheet(CARD_SHEET)).replace(
    /\s+/g,
    " ",
  );
  const turns = [
    ...sheet.matchAll(
      /\b(rotate\w*|skew\w*|matrix\w*)\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g,
    ),
  ].map((match) => `${match[1]}(${match[2]})`);
  assert(turns.length > 0, "the card stylesheet tilts the hovered face");
  // The pointer's place runs from -1 to 1, so each turn is the knob at most.
  const bounded =
    /^rotate[XY]\(calc\(var\(--wall-pointer-[xy]\) \* var\(--wall-hover-tilt\)(?: \* -1)?\)\)$/;
  assertEquals(turns.filter((turn) => !bounded.test(turn)), []);

  const lifts = [...sheet.matchAll(/translate3d\(([^)]*)\)/g)].map((match) =>
    (match[1] ?? "").split(",").map((part) => part.trim())
  );
  assert(lifts.length > 0, "the card stylesheet lifts the hovered face");
  for (const [x, y, z] of lifts) {
    assertEquals([x, z], ["0", "0"], "the lift is straight up");
    assert(
      Math.abs(parseFloat(y ?? "")) <= 3 && /^(?:0|-?[\d.]+px)$/.test(y ?? ""),
      `a lift of ${y} is more than three pixels`,
    );
  }
  assertEquals(
    /\btranslate[XYZ]?\(/.test(sheet),
    false,
    "every card move is the bounded translate3d above",
  );
});

Deno.test("the viewport-placed light is used only near, and never on a face that moves", async () => {
  const rules = await cardRules();
  const sheet = withoutComments(await readSheet(CARD_SHEET));

  // One declaration places a background by the viewport.
  const fixed = rules.flatMap((rule) =>
    rule.declarations.filter(([, value]) => /\bfixed\b/.test(value)).map((
      [property],
    ) => property)
  );
  assertEquals(fixed, ["--wall-card-light-near"]);
  assertEquals((sheet.match(/\bfixed\b/g) ?? []).length, 1);

  const nearUsers = rules.filter((rule) =>
    rule.declarations.some(([property, value]) =>
      property !== "--wall-card-light-near" &&
      value.includes("var(--wall-card-light-near)")
    )
  );
  assert(nearUsers.length > 0, "the near light reaches the card borders");
  for (const rule of nearUsers) {
    assert(
      rule.context.some((query) => query.includes("hover: hover")),
      `${rule.selector} follows a pointer on a screen that may have none`,
    );
    for (const selector of selectors(rule)) {
      assert(
        selector.startsWith(".wall[data-wall-near] "),
        `${selector} places a background by the viewport while the plane may be transformed`,
      );
    }
  }

  // A transformed element draws a viewport-placed background in the wrong
  // place, so each state that moves the face swaps in the card's own light.
  const movers = rules.filter((rule) =>
    declared(rule, "transform") !== undefined
  ).flatMap(selectors);
  assert(movers.length > 0);
  for (const mover of movers) {
    assert(FACE_SUBJECT.test(mover), `${mover} moves something off the face`);
    const swap = rules.find((rule) =>
      selectors(rule).includes(`.wall[data-wall-near] ${mover}`)
    );
    assertEquals(
      swap === undefined ? undefined : declared(swap, "--wall-card-light"),
      "var(--wall-card-light-own)",
      `${mover} moves the face but keeps the viewport-placed light`,
    );
  }
});

Deno.test("a face that moves or lights is drawn above the other cards until it rests", async () => {
  const rules = await cardRules();
  const face = rules.find((rule) =>
    rule.selector === ".wall-card-face" && rule.context.length === 1
  );
  assert(face !== undefined, "the face has its resting rule");
  assertEquals(declared(face, "z-index"), "0");

  // Every state that composites the face, by moving it or by fading one of
  // its two layers, must also raise it. A layer in the middle of the wall
  // makes the browser redraw every later card, and their edges shimmer.
  const states = new Set<string>();
  for (const rule of rules) {
    for (const selector of selectors(rule)) {
      const state =
        /^(?:\.wall\[data-wall-near\] )?(\.wall-card\S+) \.wall-card-face(?:::(?:before|after))?$/
          .exec(selector)?.[1];
      if (state === undefined) continue;
      const fades = /::(?:before|after)$/.test(selector) &&
        declared(rule, "opacity") !== undefined;
      const moves = declared(rule, "transform") !== undefined ||
        declared(rule, "will-change") !== undefined;
      if (fades || moves) states.add(state);
    }
  }
  assert(states.size >= 3, "hover, focus, and press each light or move a card");
  for (const state of states) {
    const raise = rules.find((rule) =>
      movesOnlyByChoice(rule) &&
      selectors(rule).includes(`${state} .wall-card-face`) &&
      declared(rule, "z-index") === "1"
    );
    assert(
      raise !== undefined,
      `${state} lights or moves a face it leaves in place in the stack`,
    );
    assertEquals(
      declared(raise, "transition-delay"),
      "0s",
      `${state} raises the face at once`,
    );
  }

  // At rest the face steps back down only after its transform has finished
  // and its two layers have faded.
  const resting = rules.find((rule) =>
    rule.selector === ".wall-card-face" && movesOnlyByChoice(rule)
  );
  assert(resting !== undefined);
  const layers = rules.find((rule) =>
    movesOnlyByChoice(rule) &&
    selectors(rule).includes(".wall-card-face::before") &&
    selectors(rule).includes(".wall-card-face::after") &&
    declared(rule, "transition") !== undefined
  );
  assert(layers !== undefined, "the face's two layers fade");
  const timed = [resting, layers].flatMap((rule) =>
    splitOutside(declared(rule, "transition") ?? "", ",").map((item) =>
      item.split(" ")
    )
  );
  const seconds = (time: string | undefined): number => {
    assert(time !== undefined && /^[\d.]+s$/.test(time), `${time} in seconds`);
    return parseFloat(time);
  };
  const hold = timed.find(([name]) => name === "z-index");
  assert(hold !== undefined, "the face holds its place in the stack");
  assertEquals(seconds(hold[1]), 0, "the stacking order is never tweened");
  const settling = timed.filter(([name]) => name !== "z-index");
  assertEquals(settling.map(([name]) => name), ["transform", "opacity"]);
  for (const [name, duration] of settling) {
    assert(
      seconds(hold[2]) >= seconds(duration),
      `the face steps down after ${
        hold[2]
      }, before its ${name} settles in ${duration}`,
    );
  }
});

/** One length of a shadow as a share of the gap plus a fixed pixel part. */
function shadowLength(token: string): { gap: number; px: number } {
  if (token === "0") return { gap: 0, px: 0 };
  const px = /^(-?[\d.]+)px$/.exec(token);
  if (px !== null) return { gap: 0, px: Number(px[1]) };
  const share = /^calc\(var\(--wall-gap\) \* (-?[\d.]+)\)$/.exec(token);
  if (share !== null) return { gap: Number(share[1]), px: 0 };
  throw new Error(`a card shadow length of "${token}" cannot be bounded`);
}

Deno.test("no card's shadow reaches the next card", async () => {
  const gap = WALL_KNOBS.find((candidate) => candidate.name === "gap");
  assert(gap !== undefined, "the gap knob sets the space between cards");

  let outer = 0;
  for (const rule of await cardRules()) {
    const value = declared(rule, "box-shadow");
    if (value === undefined || value === "none") continue;
    for (const shadow of splitOutside(value, ",")) {
      if (shadow.startsWith("inset ")) continue;
      outer++;
      const [x, y, blur, spread = { gap: 0, px: 0 }, ...rest] = splitOutside(
        shadow.replace(/ oklch\(.*$/, ""),
        " ",
      ).map(shadowLength);
      assert(
        x !== undefined && y !== undefined && blur !== undefined &&
          rest.length === 0,
        `"${shadow}" is two offsets, a blur, and at most a spread`,
      );
      // A blur has all but faded one blur radius past the shadow's edge. A
      // raised card is drawn over its neighbors, so anything past the gap
      // would darken them.
      for (const width of [gap.min, gap.default, gap.max]) {
        const at = (length: { gap: number; px: number }): number =>
          length.gap * width + length.px;
        const reach = Math.max(Math.abs(at(x)), Math.abs(at(y))) + at(spread) +
          at(blur);
        assert(
          reach <= width,
          `${rule.selector}: "${shadow}" reaches ${reach}px across a ${width}px gap`,
        );
      }
    }
  }
  assert(outer >= 3, "the cards cast shadows at rest and when raised");
});

Deno.test("print and forced colors get flat cards in system colors", async () => {
  const rules = await cardRules();
  for (const mode of ["forced-colors: active", "print"]) {
    const flat = rules.find((rule) =>
      rule.selector === ".wall-card-face" &&
      rule.context.some((query) => query.includes(mode))
    );
    assert(flat !== undefined, `${mode} restyles the face`);
    assertEquals(declared(flat, "background"), "Canvas", mode);
    assertEquals(declared(flat, "color"), "CanvasText", mode);
    assertEquals(declared(flat, "border-color"), "CanvasText", mode);
    assertEquals(declared(flat, "box-shadow"), "none", mode);
  }
  // The wall is dark, so paper needs the light scheme's system colors.
  assert(
    rules.some((rule) =>
      rule.selector === ".wall-card" &&
      rule.context.some((query) => query === "@media print") &&
      declared(rule, "color-scheme") === "light"
    ),
    "printed cards resolve system colors against a light page",
  );
});
