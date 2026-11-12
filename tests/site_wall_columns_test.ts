/**
 * The wall's cards are the boxes of one multi-column list. Safari's engine
 * misdraws a box of such a list once the box paints through a layer of its
 * own: a card whose ink reaches above the top of its column is drawn in the
 * column before, and the cards after an uncontained layer are left out of
 * the page's picture. Three rules keep every card drawn in its own place,
 * and each is read here from the stylesheets, because the gate's browser is
 * Chrome and Chrome draws the wall whole with or without them:
 *
 * - the list is one stacking context, so the browser lifts it as one layer;
 * - the gap above a card lies inside the card's own line, so no card's ink
 *   reaches above its column;
 * - a card that paints through a layer of its own contains its paint.
 *
 * The last case loads the built page in a real browser at four columns and
 * at five, and measures what those rules lay out.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { RECEDED_ATTRIBUTE } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import {
  openLiveWall,
  VIEWPORTS,
  WIDE_VIEWPORT,
  withBrowser,
} from "./site_wall_browser.ts";
import {
  conditionsOf,
  declared,
  selectsBox,
  selectsCardItem,
  type StyleRule,
  styleRules,
  wallSheets,
} from "./wall_stylesheets.ts";

/** One rule of a wall stylesheet, with the stylesheet it stands in. */
interface SheetRule {
  readonly sheet: string;
  readonly rule: StyleRule;
}

/** Every rule of every wall stylesheet, in cascade order. */
async function wallRules(): Promise<SheetRule[]> {
  return (await wallSheets()).flatMap(({ sheet, text }) =>
    styleRules(text).map((rule) => ({ sheet, rule }))
  );
}

/**
 * Every declaration of a property `held` matches, on a box `chosen` picks
 * out, in any stylesheet and under any at-rule. Each reads as the stylesheet,
 * the conditions the rule applies under, its selector, and the declaration.
 */
function declarationsOn(
  rules: readonly SheetRule[],
  chosen: (selector: string) => boolean,
  held: RegExp,
): string[] {
  return rules.flatMap(({ sheet, rule }) =>
    rule.selectors.filter(chosen).flatMap((selector) =>
      rule.declarations.filter(([property]) => held.test(property)).map((
        [property, value],
      ) =>
        `${sheet}: ${
          [...conditionsOf(rule), selector].join(" ")
        } { ${property}: ${value} }`
      )
    )
  );
}

const MARGIN = /^margin(?:-.+)?$/;

Deno.test("the list of cards is one stacking context, in every state of the wall", async () => {
  // A layer the browser composites beside the list then lifts the list as
  // one layer: the far view's horizon is such a layer, beneath the cards.
  // Left open, WebKit lifts each card over that layer into a layer of its
  // own. So the list isolates itself in its one base rule, and no rule for
  // any state or size of the wall says otherwise.
  assertEquals(
    declarationsOn(
      await wallRules(),
      (selector) => selectsBox(selector, "wall-list"),
      /^isolation$/,
    ),
    ["wall.css: .wall-list { isolation: isolate }"],
  );
});

/** Whether a declaration read by `declarationsOn` applies on paper alone. */
function onPaper(declaration: string): boolean {
  return declaration.includes(": @media print ");
}

Deno.test("the gap above a card lies inside the card's own line, on every screen", async () => {
  const rules = await wallRules();
  // A card is one line of the list: an inline block as wide as its column,
  // whose top margin is the gap. A column breaks between lines, so the line
  // of the card that heads a column starts at the column's top, and the
  // card's own box starts one gap below it. Everything a card draws outside
  // its box is sized to end within the gap, so all of it lies in the column.
  // A margin under the card would put the gap in the line before, and leave
  // a column's head with its ink above the column.
  const card = declarationsOn(
    rules,
    selectsCardItem,
    /^(?:display|vertical-align|inline-size|width|margin(?:-.+)?|break-inside)$/,
  ).toSorted();
  assertEquals(
    card.filter((declaration) => !onPaper(declaration)),
    [
      "wall-card.css: .wall-card { display: inline-block }",
      "wall-card.css: .wall-card { inline-size: 100% }",
      "wall-card.css: .wall-card { margin-block: var(--wall-gap) 0 }",
      "wall-card.css: .wall-card { vertical-align: top }",
    ],
    "one base rule makes a card a line of the list with the gap above it, and no size or state of the wall changes that",
  );

  // The first row would stand one gap low. The list pulls up by the same
  // gap, and the plane keeps that margin inside itself, so the plane's own
  // top edge, which the far view hinges on, stays where it is. A browser
  // keeps two lines of a block together at the head and the foot of a
  // column unless told that one will do, and here a line is a whole card.
  const list = declarationsOn(
    rules,
    (selector) => selectsBox(selector, "wall-list"),
    /^(?:margin(?:-.+)?|orphans|widows)$/,
  );
  assertEquals(
    list.filter((declaration) => !onPaper(declaration)),
    [
      "wall.css: .wall-list { margin-block-start: calc(var(--wall-gap) * -1) }",
      "wall.css: .wall-list { orphans: 1 }",
      "wall.css: .wall-list { widows: 1 }",
    ],
  );
  assertEquals(
    declarationsOn(
      rules,
      (selector) => selectsBox(selector, "wall-plane"),
      /^display$/,
    ),
    ["wall.css: .wall-plane { display: flow-root }"],
  );

  // A lens's divider starts a second run of columns. Its own end margin is
  // written less the gap, so the cards under it keep their distance from it.
  const dividers = declarationsOn(
    rules,
    (selector) => selectsBox(selector, "wall-rest"),
    MARGIN,
  );
  const [divider, ...others] = dividers.filter((declaration) =>
    !onPaper(declaration)
  );
  const whole =
    / \{ margin-block: \S+ calc\(([\d.]+rem) - var\(--wall-gap\)\) \}$/
      .exec(divider ?? "")?.[1];
  assert(
    whole !== undefined && others.length === 0,
    `"${
      dividers.join('", "')
    }" leaves the cards under the divider a gap too low`,
  );

  // Paper has no layers, and a gap at the head of every column of every
  // sheet would cost each sheet a card. So on paper, and nowhere else, a
  // card is a block with the gap under it, kept whole, and the list and the
  // divider give back what they took for the gap.
  assertEquals(
    [card, list, dividers].flatMap((declarations) =>
      declarations.filter(onPaper)
    ),
    [
      "wall-card.css: @media print .wall-card { break-inside: avoid }",
      "wall-card.css: @media print .wall-card { display: list-item }",
      "wall-card.css: @media print .wall-card { margin-block: 0 var(--wall-gap) }",
      "wall.css: @media print .wall-list { margin-block-start: 0 }",
      `wall-interactions.css: @media print .wall-rest { margin-block-end: ${whole} }`,
    ],
  );
});

/**
 * Whether a declaration makes its box paint through a layer of its own: a
 * view-transition name, an opacity under 1, or a filter.
 */
function paintsThroughALayer(
  [property, value]: readonly [string, string],
): boolean {
  if (property === "view-transition-name") return value !== "none";
  if (property === "opacity") return Number(value) !== 1;
  if (property === "filter") return value !== "none";
  return false;
}

/** The attributes a selector asks of its subject or of any box before it. */
function attributesAsked(selector: string): string[] {
  return [...selector.matchAll(/\[([\w-]+)/g)].map((match) => match[1] ?? "");
}

/** Whether a rule keeps its box's paint inside the box. */
function containsPaint(rule: StyleRule): boolean {
  return /\b(?:paint|strict|content)\b/.test(declared(rule, "contain") ?? "");
}

/**
 * Marks whose cards paint through a layer of their own and carry no
 * containment, each with its reason.
 *
 * - The receded mark. A card a lens set aside is still lit and lifted under
 *   the pointer and ringed under the keyboard. It draws all three outside
 *   its box, where containment would cut them off. WebKit draws such a card,
 *   and the cards after it, in place for as long as it rests in the list.
 */
const UNCONTAINED: ReadonlySet<string> = new Set([RECEDED_ATTRIBUTE]);

Deno.test("a card that paints through a layer of its own keeps its paint inside its box", async () => {
  const rules = (await wallRules()).filter(({ rule }) =>
    rule.selectors.some(selectsCardItem)
  );
  // WebKit leaves the cards after such a card out of the page's picture
  // unless the card's paint is contained. A state is contained through the
  // attribute that marks it, so one rule covers every value of the mark.
  const containing = rules.filter(({ rule }) => containsPaint(rule));
  const contained = new Set(
    containing.flatMap(({ rule }) =>
      rule.selectors.filter(selectsCardItem).flatMap(attributesAsked)
    ),
  );
  const layered = rules.filter(({ rule }) =>
    !conditionsOf(rule).some((query) => /^@media\s+print\b/.test(query)) &&
    rule.declarations.some(paintsThroughALayer)
  );
  assert(
    layered.length > 1,
    "the stylesheets give the opening card and the receded card a layer",
  );
  for (const { sheet, rule } of layered) {
    for (const selector of rule.selectors.filter(selectsCardItem)) {
      assert(
        attributesAsked(selector).some((attribute) =>
          contained.has(attribute) || UNCONTAINED.has(attribute)
        ),
        `${sheet}: "${selector}" gives the card a layer of its own (${
          rule.declarations.filter(paintsThroughALayer).map(([property]) =>
            property
          ).join(", ")
        }) and no rule gives a card so marked \`contain: paint\`. WebKit then ` +
          "leaves the cards after it in the list undrawn. Mark the state with " +
          "an attribute and contain it: see project/map/90-site/wall-columns.md.",
      );
    }
  }

  // Containment clips at the box, so a contained card takes the face's own
  // rounded shape, and no later rule takes the containment away.
  for (const { sheet, rule } of containing) {
    assertEquals(
      declared(rule, "border-radius"),
      "var(--wall-radius)",
      `${sheet}: "${rule.prelude}" clips the card to a square box`,
    );
  }
  assertEquals(
    rules.filter(({ rule }) =>
      declared(rule, "contain") !== undefined && !containsPaint(rule)
    ).map(({ sheet, rule }) => `${sheet}: ${rule.prelude}`),
    [],
    "a rule lets a card's paint out of its box again",
  );

  // Every mark the island sets on a card is contained or is listed above
  // with its reason, and a mark that is contained leaves the list.
  assertEquals(
    [OPENING_ATTRIBUTE, RECEDED_ATTRIBUTE].filter((attribute) =>
      !contained.has(attribute) && !UNCONTAINED.has(attribute)
    ),
    [],
    "a mark the island sets on a card has no containment",
  );
  assertEquals(
    [...UNCONTAINED].filter((attribute) => contained.has(attribute)),
    [],
    "a mark listed as uncontained is contained: take it off the list",
  );
});

/** One card as the list lays it out, in page coordinates. */
interface LaidCard {
  readonly id: string;
  /** How many boxes the browser reports for the list item. */
  readonly boxes: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  /**
   * How far above its own box the card may draw, at rest or lit. Each outer
   * shadow of the face, and of the two layers that lie over the face, counts
   * to the whole of its blur, with nothing taken off for a spread that draws
   * it in or an offset that moves it down. A shadow's ink ends short of
   * that, and so does everything a lift or a focus ring adds.
   */
  readonly reach: number;
}

/** One run of columns: the whole list, or the cards on one side of a lens's divider. */
interface ColumnRun {
  /** Where the run's columns begin, down the page. */
  readonly top: number;
  readonly cards: readonly LaidCard[];
}

/** What the browser makes of the list: whether it isolates, and each run of columns. */
interface LaidList {
  readonly isolation: string;
  readonly runs: readonly ColumnRun[];
}

/** Runs in the page: read the list as laid out. */
function readList(): LaidList {
  const px = (length: string): number => Number.parseFloat(length) || 0;
  // A computed shadow reads as its color, two offsets, a blur, and a spread.
  // An inset shadow stays inside its box.
  const shadowReach = (style: CSSStyleDeclaration): number =>
    Math.max(
      0,
      ...style.boxShadow.split(/,(?![^(]*\))/).filter((shadow) =>
        !shadow.includes("inset")
      ).map((shadow) => {
        const [, , blur = 0, spread = 0] = [
          ...shadow.matchAll(/(-?[\d.]+)px/g),
        ].map((length) => Number(length[1]));
        return blur + Math.max(0, spread);
      }),
    );
  const reachOf = (face: Element | null): number =>
    face === null ? 0 : Math.max(
      shadowReach(getComputedStyle(face)),
      ...["::before", "::after"].map((layer) => {
        const style = getComputedStyle(face, layer);
        return shadowReach(style) - px(style.top);
      }),
    );
  const list = document.querySelector(".wall-list");
  if (list === null) return { isolation: "", runs: [] };
  const listStyle = getComputedStyle(list);
  const runs: { top: number; cards: LaidCard[] }[] = [{
    top: list.getBoundingClientRect().top + scrollY +
      px(listStyle.borderTopWidth) + px(listStyle.paddingTop),
    cards: [],
  }];
  for (const item of list.children) {
    // An item taken out of the list's flow is no part of what it lays out.
    const boxes = item.getClientRects().length;
    if (boxes === 0) continue;
    const box = item.getBoundingClientRect();
    if (!(item instanceof HTMLElement) || item.dataset.card === undefined) {
      // The divider spans every column, and the next run of columns begins
      // under its margin.
      runs.push({
        top: box.bottom + scrollY + px(getComputedStyle(item).marginBottom),
        cards: [],
      });
      continue;
    }
    runs.at(-1)?.cards.push({
      id: item.dataset.card,
      boxes,
      left: box.left,
      top: box.top + scrollY,
      bottom: box.bottom + scrollY,
      width: box.width,
      reach: reachOf(item.querySelector(".wall-card-face")),
    });
  }
  return { isolation: listStyle.isolation, runs };
}

/** The cards that head a column of a run: each first card at a new left edge. */
function columnHeads(run: ColumnRun): LaidCard[] {
  return run.cards.filter((card, index) =>
    card.left !== run.cards[index - 1]?.left
  );
}

/**
 * Hold one run of columns to the list's rules.
 *
 * The list's order alone places a card: the cards run down a column and then
 * on to the next, each as wide as its column and in one box.
 *
 * No card's ink starts above the top of its column. The predicate is that a
 * column head's box, less the card's reach, starts at the column's top or
 * below. Every other card of a column lies under its head, so the heads
 * answer for the column.
 */
function assertRun(run: ColumnRun, where: string): void {
  assertEquals(
    run.cards.filter((card) => card.boxes !== 1).map((card) => card.id),
    [],
    `${where}: each card is one box`,
  );
  assertEquals(
    run.cards.toSorted((one, other) =>
      one.left - other.left || one.top - other.top
    ).map((card) => card.id),
    run.cards.map((card) => card.id),
    `${where}: the cards fill each column from its top, in the list's order`,
  );
  const heads = columnHeads(run);
  const [first] = run.cards;
  assertEquals(
    run.cards.filter((card) => Math.abs(card.width - (first?.width ?? 0)) > 0.5)
      .map((card) => card.id),
    [],
    `${where}: each card is as wide as its column`,
  );
  assert(
    heads.every((head) => head.reach > 1),
    `${where}: a card draws a shadow outside its box, so the measure is not empty`,
  );
  assertEquals(
    heads.filter((head) => head.top - head.reach < run.top - 0.5).map((head) =>
      `${head.id}: its ink may start ${
        (run.top - head.top + head.reach).toFixed(1)
      }px above its column`
    ),
    [],
    `${where}: every column head keeps its ink inside its column`,
  );
}

/** Read the list as the page lays it out now. */
function laidList(page: Page): Promise<LaidList> {
  return page.evaluate(readList);
}

/** Leave the first `shown` cards in the list's flow and take the rest out of it. */
function showCards(page: Page, shown: number): Promise<void> {
  return page.locator(".wall-list > .wall-card").evaluateAll(
    (cards, shown) => {
      cards.forEach((card, index) => {
        if (card instanceof HTMLElement) {
          card.style.display = index < shown ? "" : "none";
        }
      });
    },
    shown,
  );
}

const [, LAPTOP] = VIEWPORTS;

/** The sizes the list is measured at, and the columns the wall has at each. */
const COLUMN_SIZES = [
  { ...LAPTOP, columns: 4 },
  { ...WIDE_VIEWPORT, columns: 5 },
] as const;

Deno.test("in a real browser the list isolates itself, and every column head keeps its ink inside its column, with and without a lens", async () => {
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  for (const size of COLUMN_SIZES) {
    await withBrowser(async (browser) => {
      // A reader who asked for less motion gets the flat wall wherever the
      // page stands, and a lens as a cut, so every box is at rest when read.
      const { page, faults } = await openLiveWall(
        await browser.newContext({
          viewport: { width: size.width, height: size.height },
          reducedMotion: "reduce",
        }),
      );
      const whole = await laidList(page);
      assertEquals(whole.isolation, "isolate", `${size.name}: the list`);
      assertEquals(whole.runs.length, 1, `${size.name}: no divider, no lens`);
      const [deck] = whole.runs;
      assert(deck !== undefined);
      assertEquals(deck.cards.length, WALL_DECK.length, size.name);
      assertEquals(columnHeads(deck).length, size.columns, size.name);
      assertRun(deck, `${size.name}, no lens`);

      // A column may hold a single card: two cards alone stand side by side.
      await showCards(page, 2);
      const [pair] = (await laidList(page)).runs;
      assert(pair !== undefined && pair.cards.length === 2, size.name);
      assertEquals(
        columnHeads(pair).length,
        2,
        `${size.name}: two cards alone share one column`,
      );
      await showCards(page, WALL_DECK.length);

      const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
      await chip.click();
      await chip.and(page.locator("[aria-pressed='true']")).waitFor();
      const sorted = await laidList(page);
      const [kept, rest] = sorted.runs;
      assert(
        kept !== undefined && rest !== undefined && sorted.runs.length === 2,
        `${size.name}: a lens divides the list into two runs of columns`,
      );
      assertRun(kept, `${size.name}, the cards ${lens.id} kept`);
      assertEquals(columnHeads(rest).length, size.columns, size.name);
      assertRun(rest, `${size.name}, the cards under the divider`);
      assertEquals(faults, [], size.name);
    });
  }
});
