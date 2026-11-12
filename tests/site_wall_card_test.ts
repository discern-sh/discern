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
import type { Page } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { handler } from "../site/serve.ts";
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
import { WALL_KNOBS } from "../site/wall/tuning/knobs.ts";
import type { WallCard } from "../site/wall/types.ts";
import {
  LIGHT_PROPERTIES,
  LIGHT_REACH,
  LIGHT_REACH_GATES,
} from "../site/wall/use_light.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";
import {
  declared,
  MOTION_PROPERTY,
  movesByChoice,
  readWallSheet,
  selectsCardItem,
  splitOutside,
  type StyleRule,
  styleRules,
  wallSheets,
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

Deno.test("the hover tilt is the knob's angle at most, and the lift a few pixels", async () => {
  const knob = WALL_KNOBS.find((candidate) => candidate.name === "hover-tilt");
  assert(knob !== undefined, "the hover-tilt knob sets the tilt");
  assertEquals(knob.unit, "deg");
  assertEquals(knob.min, 0, "the tilt can be turned off");
  assert(knob.default <= 1.5, "the shipped tilt is 1.5 degrees at most");

  const sheet = withoutComments(await readWallSheet(CARD_SHEET)).replace(
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

Deno.test("a control that draws its own look takes no tap highlight from the browser", async () => {
  // A rule that gives up the browser's look for a control draws that
  // control's pressed state itself. On a touch screen the browser still lays
  // its own highlight over the control's box at a tap, and the picture a
  // view transition takes of the page catches it.
  const kept: string[] = [];
  let controls = 0;
  for (const { sheet, text } of await wallSheets()) {
    for (const rule of styleRules(text)) {
      if (declared(rule, "appearance") !== "none") continue;
      controls++;
      if (declared(rule, "-webkit-tap-highlight-color") !== "transparent") {
        kept.push(`${sheet}: ${rule.prelude} keeps the browser's highlight`);
      }
    }
  }
  assertEquals(kept, []);
  assert(
    controls >= 3,
    "a card's button, a chip, and the sheet's close control draw their own look",
  );
});

Deno.test("a card's border catches the pointer light through one box, near and where a pointer can hover", async () => {
  const rules = await cardRules();
  const box = rules.find((rule) =>
    rule.prelude === `.${CARD_LIGHT}` && rule.context.length === 1
  );
  assert(box !== undefined, "the light box has its resting rule");

  // The box lies over the whole face and shows on its border ring alone.
  assert(
    /\bpadding-box exclude\b/.test(declared(box, "mask") ?? ""),
    "the light box is masked down to the border",
  );
  assertEquals(declared(box, "pointer-events"), "none");

  // It is placed from the card's own corner by what the light writes, it
  // reaches as far as the room says, and it is dark until the light is up.
  const [x, y, on] = LIGHT_PROPERTIES.card;
  const light = declared(box, "background") ?? "";
  const thrown = /^radial-gradient\( (var\(--wall-[\w-]+\)) circle at /.exec(
    light,
  )?.[1];
  assert(
    thrown !== undefined,
    "the light box draws a round light of a named size",
  );
  assert(
    light.includes(`${thrown} circle at var(${x}) var(${y})`),
    "the light box places its light where the light says",
  );
  assert(light.includes(`var(${on})`), "the light box dims with the light");
  assertEquals(
    [x, y, on].map((name) => declared(box, name)),
    ["0px", "0px", "0"],
    "the light box rests dark",
  );

  // What a card near the pointer catches is white, the same on every card.
  // A card's own hue shows on the layer that lights the one card the pointer
  // or the keyboard is on.
  const hued = ["--wall-hue", "--wall-chroma", "--wall-accent"];
  for (const name of hued) {
    assertEquals(
      light.includes(`var(${name})`),
      false,
      `the light a nearby card catches reads ${name}, so each card near the pointer lights in its own color`,
    );
  }
  const lit = rules.find((rule) =>
    rule.prelude === ".wall-card-face::before" && rule.context.length === 1
  );
  assert(lit !== undefined, "the face has its lit layer");
  assert(
    (declared(lit, "background") ?? "").includes("var(--wall-hue)"),
    "the card under the pointer shows its own hue",
  );

  // Only its brightness ever changes: nothing moves or fades it.
  const still =
    /^(?:transform|translate|rotate|scale|transition(?:-.+)?|animation(?:-.+)?|opacity|filter|will-change)$/;
  const moved = rules.filter((rule) =>
    rule.selectors.some((selector) => selector.endsWith(`.${CARD_LIGHT}`))
  ).flatMap((rule) =>
    rule.declarations.filter(([property]) => still.test(property)).map((
      [property],
    ) => `${rule.prelude} { ${property} }`)
  );
  assertEquals(moved, []);

  // The room alone says how far the light reaches, and it reaches cards only
  // while the wall is near and the screen has a pointer to follow. A far
  // plane is tilted, and a touch screen has nothing for the light to follow.
  // The light reads the reach again only when one of those two changes, so
  // no rule may set the reach by anything else.
  const room = styleRules(await readWallSheet("wall.css")).filter((
    rule,
  ) => declared(rule, LIGHT_REACH) !== undefined);
  const resting = room.filter((rule) =>
    rule.prelude === ".wall" && rule.context.length === 1
  );
  assertEquals(
    resting.map((rule) => declared(rule, LIGHT_REACH)),
    ["0px"],
    "no card takes the light at rest",
  );
  const reaching = room.filter((rule) => !resting.includes(rule));
  assert(reaching.length > 0, "the light reaches card borders somewhere");
  for (const rule of reaching) {
    assertEquals(
      rule.context.filter((query) => !query.startsWith("@layer")),
      [`@media ${LIGHT_REACH_GATES.media}`],
      `${rule.prelude} sets the reach under a condition the light does not watch`,
    );
    assertEquals(
      rule.selectors,
      [
        `.wall${
          LIGHT_REACH_GATES.attributes.map((name) => `[${name}]`).join("")
        }`,
      ],
      "the reach is set by a state of the wall the light does not watch",
    );
    // Script lights the cards within this reach, so it must be exactly as
    // far as the light box draws its light.
    assertEquals(
      declared(rule, LIGHT_REACH),
      thrown,
      "script and stylesheet disagree on how far the light is thrown",
    );
  }
});

Deno.test("a face that moves or lights is drawn above the other cards until it rests", async () => {
  const rules = await cardRules();
  const face = rules.find((rule) =>
    rule.prelude === ".wall-card-face" && rule.context.length === 1
  );
  assert(face !== undefined, "the face has its resting rule");
  assertEquals(declared(face, "z-index"), "0");

  // Every state that composites the face, by moving it or by fading one of
  // its two layers, must also raise it. A layer in the middle of the wall
  // makes the browser redraw every later card, and their edges shimmer.
  const states = new Set<string>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
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
      movesByChoice(rule) &&
      rule.selectors.includes(`${state} .wall-card-face`) &&
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
    rule.prelude === ".wall-card-face" && movesByChoice(rule)
  );
  assert(resting !== undefined);
  const layers = rules.find((rule) =>
    movesByChoice(rule) &&
    rule.selectors.includes(".wall-card-face::before") &&
    rule.selectors.includes(".wall-card-face::after") &&
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
          `${rule.prelude}: "${shadow}" reaches ${reach}px across a ${width}px gap`,
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

const ORIGIN = "http://127.0.0.1:18905";

/**
 * Open the homepage at one size for a reader who asked for less motion, who
 * gets the flat wall wherever the page stands and no travel between two
 * places on it.
 */
async function onThePage(
  viewport: { readonly width: number; readonly height: number },
  check: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    await serveThroughHandler(page, ORIGIN, handler);
    await page.goto(`${ORIGIN}/`);
    await page.locator(".wall[data-wall-live]").waitFor();
    await check(page);
  } finally {
    await browser.close();
  }
}

Deno.test("a card the keyboard reaches going backward comes to rest clear of the pinned bar", async () => {
  await onThePage({ width: 1280, height: 720 }, async (page) => {
    // From the link after the wall, back through every card to the first.
    await page.locator(".wall-closing a").focus();
    const stops: { readonly card: string; readonly under: number }[] = [];
    for (let press = 0; press < WALL_DECK.length + 8; press++) {
      await page.keyboard.press("Shift+Tab");
      const stop = await page.evaluate(() =>
        new Promise<{ card: string | null; under: number }>((resolve) =>
          // The browser has scrolled to the focused card by the next frame.
          requestAnimationFrame(() => {
            const focused = document.activeElement;
            const bar = document.querySelector(".wall-controls");
            const card = focused?.closest(".wall-list > .wall-card") ?? null;
            resolve({
              card: card?.getAttribute("data-card") ?? null,
              under: focused === null || bar === null
                ? Number.NaN
                : bar.getBoundingClientRect().bottom -
                  focused.getBoundingClientRect().top,
            });
          })
        )
      );
      if (stop.card !== null) {
        stops.push({ card: stop.card, under: stop.under });
      } else if (stops.length > 0) break;
    }
    assertEquals(
      stops.map((stop) => stop.card).toSorted(),
      WALL_DECK.map((card) => card.id).toSorted(),
      "the keyboard stops on every card on the way back",
    );
    assertEquals(
      stops.filter((stop) => !(stop.under <= 0)).map((stop) =>
        `${stop.card}: its heading is ${stop.under}px under the bar`
      ),
      [],
    );
    assertEquals(
      await page.locator(".wall-controls").evaluate((bar) =>
        getComputedStyle(bar).position
      ),
      "sticky",
      "the bar stays over the wall at this size, so a card could pass under it",
    );
  });
});

Deno.test("a heading wraps a word longer than its card is wide", async () => {
  await onThePage({ width: 390, height: 844 }, async (page) => {
    const kinds = [...new Set(WALL_DECK.map((card) => card.kind))];
    const spills = await page.evaluate((kinds) => {
      const found: string[] = [];
      for (const kind of kinds) {
        const card = document.querySelector(`.wall-card--${kind}`);
        const face = card?.querySelector(".wall-card-face");
        const button = card?.querySelector(".wall-card-open");
        const words = [...button?.childNodes ?? []].findLast((node) =>
          node.nodeType === Node.TEXT_NODE
        );
        if (!face || !button || !words) {
          found.push(`${kind}: no heading to fill`);
          continue;
        }
        words.textContent = "Uncharacteristically".repeat(6);
        const edge = face.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(words);
        const lines = [...range.getClientRects()];
        if (lines.length < 2) found.push(`${kind}: the word did not wrap`);
        for (const line of lines) {
          if (line.left < edge.left - 0.5 || line.right > edge.right + 0.5) {
            found.push(
              `${kind}: the word runs from ${line.left} to ${line.right} in a face from ${edge.left} to ${edge.right}`,
            );
          }
        }
        const room = document.querySelector(".wall-list")
          ?.getBoundingClientRect();
        if (room === undefined || edge.right > room.right + 0.5) {
          found.push(`${kind}: the word made its card wider than the wall`);
        }
      }
      return found;
    }, kinds);
    assertEquals(spills, []);
  });
});

Deno.test("a benefit card sets its glyph beside its words exactly where the wall is one column", async () => {
  await onThePage({ width: 390, height: 844 }, async (page) => {
    const seen: { width: number; columns: number; beside: boolean }[] = [];
    for (const width of [320, 390, 600, 620, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const laid = await page.evaluate(() =>
        new Promise<{ columns: number; beside: boolean[] }>((resolve) =>
          requestAnimationFrame(() => {
            const cards = [
              ...document.querySelectorAll(".wall-list > .wall-card"),
            ];
            resolve({
              columns: new Set(
                cards.map((card) =>
                  Math.round(card.getBoundingClientRect().left)
                ),
              ).size,
              beside: cards.flatMap((card) => {
                const glyph = card.querySelector(".wall-card-glyph")
                  ?.getBoundingClientRect();
                const title = card.querySelector(".wall-card-title")
                  ?.getBoundingClientRect();
                return glyph === undefined || title === undefined
                  ? []
                  : [glyph.right <= title.left && glyph.top < title.bottom];
              }),
            });
          })
        )
      );
      assert(laid.beside.length > 0, "the wall holds cards with glyphs");
      assertEquals(
        new Set(laid.beside).size,
        1,
        `at ${width}px every benefit card is set the same way`,
      );
      seen.push({
        width,
        columns: laid.columns,
        beside: laid.beside[0] === true,
      });
    }
    assert(
      seen.some((size) => size.columns === 1) &&
        seen.some((size) => size.columns > 1),
      "the sizes tried cover a wall of one column and of several",
    );
    assertEquals(
      seen.filter((size) => size.beside !== (size.columns === 1)),
      [],
      "the glyph is beside the words in one column, and above them in several",
    );
  });
});
