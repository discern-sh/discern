/**
 * What a view transition on the wall costs the page beyond what a visitor
 * sees of it. While a sheet opens or closes, or a lens re-sorts the wall, the
 * browser draws the page from pictures, and work done on the page under them
 * is drawn again every frame and seen by nobody.
 *
 * A real browser opens a card by a pointer that travels to it and presses,
 * and closes it again, far and near, at the laptop size and at a size where
 * the wall has five columns. It counts what happens while each transition is
 * active. The stylesheets and the sources are held to the rules a browser
 * that the gate cannot launch depends on.
 */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import type { Page } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Card, CARD_LIGHT } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { LIGHT_PROPERTIES } from "../site/wall/use_light.ts";
import {
  OPENING_ATTRIBUTE,
  SHEET_MOVING_ATTRIBUTE,
} from "../site/wall/use_open_card.ts";
import {
  dropFocus,
  FAR_WALL,
  isAt,
  lightNow,
  lightSettled,
  LIVE_WALL,
  markedCards,
  motionSettled,
  NEAR_WALL,
  OPEN_SHEET,
  openerOf,
  openLiveWall,
  OUTSIDE_Y,
  placeOnWall,
  type Press,
  pressableCard,
  scrollToWall,
  sheetGone,
  VIEWPORTS,
  WIDE_VIEWPORT,
  withBrowser,
} from "./site_wall_browser.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import {
  conditionsOf,
  declared,
  MOTION_PROPERTY,
  selectsCardItem,
  type SheetRule,
  splitOutside,
  wallRules,
} from "./wall_stylesheets.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

/** The module that begins every view transition, and marks each as over. */
const TRANSITIONS_HOME = "site/wall/use_open_card.ts";

Deno.test("one function begins every view transition on the site, and whoever begins one waits for it to end", async () => {
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_transition_test.ts#view-transitions",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the site's own modules run in a visitor's browser, where a view transition can begin.",
        include: (path) => path.startsWith("site/"),
      },
    }),
  );
  assert(sources.length > 0);
  // The pointer light holds still while a transition runs, and it knows one
  // is running only through the function that begins them all. A transition
  // begun anywhere else would run with the light still writing under it.
  assertEquals(
    sources.flatMap(({ path, source }) =>
      [...source.matchAll(/\.startViewTransition\(/g)].map(() => path)
    ),
    [TRANSITIONS_HOME],
    "one line of the site begins a view transition",
  );
  // A transition is over once `transitionEnded` has seen it end. One that
  // was begun and never waited for there would be running for good, and the
  // light would never move again.
  const begun = sources.flatMap(({ path, source }) =>
    [...source.matchAll(/(?<!function )\bbeginTransition\(/g)].map(() => path)
  );
  assert(begun.length >= 2, "the sheet and the lens each begin a transition");
  assertEquals(
    sources.flatMap(({ path, source }) =>
      [...source.matchAll(/\bawait transitionEnded\(/g)].map(() => path)
    ),
    begun,
    "each module waits through `transitionEnded` for every transition it begins",
  );
});

Deno.test("a box the light moves anchors no scroll", async () => {
  // A browser keeps the page still under a reader by picking a box in view
  // and scrolling after it when it moves. WebKit counts a box that script
  // moves, and scrolls the page after the light's disc whenever a write of
  // the light's place meets a layout: at the end of a view transition, and
  // on a click outside a sheet that is still arriving.
  const written: readonly string[] = [
    ...LIGHT_PROPERTIES.room,
    ...LIGHT_PROPERTIES.card,
  ];
  const moved = (await wallRules()).filter(({ rule }) =>
    rule.declarations.some(([property, value]) =>
      MOTION_PROPERTY.test(property) &&
      written.some((name) => value.includes(`var(${name})`))
    )
  );
  assert(moved.length > 0, "the light moves a box across the wall");
  assertEquals(
    moved.filter(({ rule }) => declared(rule, "overflow-anchor") !== "none")
      .map(({ sheet, rule }) =>
        `${sheet}: ${
          [...conditionsOf(rule), rule.prelude].join(" ")
        } moves with the light and may anchor the page's scroll`
      ),
    [],
  );
});

/** A rule as written: its stylesheet, its conditions, its selectors, and its block. */
function written({ sheet, rule }: SheetRule): string {
  const block = rule.declarations.map(([property, value]) =>
    `${property}: ${value}`
  ).join("; ");
  return `${sheet}: ${
    [...conditionsOf(rule), rule.prelude].join(" ")
  } { ${block} }`;
}

/** The page's root while a sheet's transition is past its first picture. */
const MOVING_ROOT = `:root[${SHEET_MOVING_ATTRIBUTE}]`;

/** A card marked as an opened card's source, in either state of the mark. */
const MARKED_CARD = `.wall-card[${OPENING_ATTRIBUTE}]`;

/**
 * A marked card in the state that gives it the sheet's transition name, as
 * the stylesheet selects it. The stylesheet says which state that is.
 */
async function namedCard(): Promise<string> {
  const naming = (await wallRules()).flatMap(({ rule }) =>
    declared(rule, "view-transition-name") === undefined
      ? []
      : rule.selectors.filter((selector) =>
        selectsCardItem(selector) &&
        selector.startsWith(`.wall-card[${OPENING_ATTRIBUTE}=`)
      )
  );
  assertEquals(naming.length, 1, "one state of the mark names the card");
  return naming[0] ?? "";
}

const NAMED_CARD = await namedCard();

/** The face of a card, which is the one box of a card that moves. */
const FACE = ".wall-card-face";

Deno.test("the page's root leaves a sheet's transition once its old picture is taken", async () => {
  // A root that keeps its transition name is pictured in the new state too.
  // WebKit draws that picture afresh on every frame of the transition, the
  // whole viewport of it, and its main thread waits for each one. With no
  // name from the moment the page changes, the old picture fades out over
  // the page itself, which is the same cross-fade to the eye.
  //
  // The mark also says when the page has changed. Until it has, a card that
  // carries the sheet's name is the one an opening pictures, and it keeps
  // the lit face it was pressed with. Every rule that reads the mark is
  // named here, so a new reader is a decision.
  assertEquals(
    (await wallRules()).filter(({ rule }) =>
      rule.selectors.some((selector) =>
        selector.includes(`[${SHEET_MOVING_ATTRIBUTE}]`)
      )
    ).map(written),
    [
      `wall-interactions.css: @media (hover: hover) :root:not([${SHEET_MOVING_ATTRIBUTE}]) ${NAMED_CARD} ${FACE}::before { opacity: 1 }`,
      `wall-interactions.css: ${MOVING_ROOT} { view-transition-name: none }`,
    ],
  );
});

/**
 * What holds a box still, by each property that would move the box, promise
 * that it will, or give a change of its look some time to take.
 */
const STILL: Readonly<Record<string, string>> = {
  transform: "none",
  "will-change": "auto",
  transition: "none",
  animation: "none",
};

/** Every card of the deck as the page's list holds it. */
function deckMarkup(): Document {
  const list = createElement(
    "ul",
    null,
    WALL_DECK.map((card) =>
      createElement(Card, {
        key: card.id,
        card,
        receded: false,
        onOpen: () => {},
      })
    ),
  );
  return new JSDOM(renderToStaticMarkup(list)).window.document;
}

/**
 * The box a selector styles, as a class with any pseudo-element, when that
 * box lies inside a card: `.wall-card-face::before`. A box outside every
 * card has no name here, and neither has the card's own list item.
 */
function boxInCard(selector: string, deck: Document): string | undefined {
  const subject = splitOutside(selector, " ").at(-1) ?? "";
  const name = /^\.[\w-]+/.exec(subject)?.[0];
  if (name === undefined || deck.querySelector(`.wall-card ${name}`) === null) {
    return undefined;
  }
  return `${name}${/::[\w-]+/.exec(subject)?.[0] ?? ""}`;
}

Deno.test("every box in a card that moves or takes time holds still while the card is an opened card's source, and the root has left the transition by then", async () => {
  const rules = await wallRules();
  const deck = deckMarkup();
  // Whatever a rule gives a box inside a card to move it, or to take time
  // over a change, the marked card must take away again by the same
  // property. A marked card is a stacking context that nobody sees, and the
  // browser reports the pointer gone from it as its transition begins. A
  // face easing out of its hover pose in there has a layer of its own that
  // cannot rise above the wall, so the browser lifts every card after it
  // into further layers and draws them all again.
  const moved = new Map<string, Set<string>>();
  for (const { rule } of rules) {
    for (const [property, value] of rule.declarations) {
      const still = Object.entries(STILL).find(([name]) =>
        property === name || property.startsWith(`${name}-`)
      );
      if (still === undefined || value === still[1]) continue;
      for (const selector of rule.selectors) {
        const box = boxInCard(selector, deck);
        if (box === undefined) continue;
        moved.set(box, (moved.get(box) ?? new Set()).add(still[0]));
      }
    }
  }
  assert(
    moved.get(FACE)?.has("transform") === true && moved.size > 1,
    "a card's face moves, and other boxes in a card take time over a change",
  );
  const held = (box: string, property: string): boolean =>
    rules.some(({ rule }) =>
      rule.selectors.includes(`${MARKED_CARD} ${box}`) &&
      conditionsOf(rule).length === 0 &&
      declared(rule, property) === STILL[property]
    );
  assertEquals(
    [...moved].flatMap(([box, properties]) =>
      [...properties].filter((property) => !held(box, property)).map((
        property,
      ) =>
        `${MARKED_CARD} ${box} needs ${property}: ${
          STILL[property]
        }, for every reader`
      )
    ),
    [],
  );

  // Holding the face still is safe only with the root out of the sheet's
  // transition. While WebKit still pictures the root on every frame, a face
  // that holds still makes each of those pictures dearer, and frames that
  // were on time come late.
  const leaves = rules.some(({ rule }) =>
    rule.selectors.includes(MOVING_ROOT) &&
    declared(rule, "view-transition-name") === "none"
  );
  assert(
    leaves,
    `${MARKED_CARD} ${FACE} holds still, so ${MOVING_ROOT} must take the root's transition name away: the face rule without the root rule is a WebKit regression`,
  );
});

/** What the page did while one view transition was active. */
interface Watched {
  /** How many frames the transition was seen on. */
  readonly frames: number;
  /** Each box the light writes on that took a style write, once per write. */
  readonly writes: string[];
  /** Every part of the transition that animated, by its pseudo-element. */
  readonly parts: string[];
  /** Each animation that ran on the marked card or inside it, once by name. */
  readonly moving: string[];
  /** Each transform the marked card's face carried, other than none. */
  readonly posed: string[];
  /**
   * How far up the face's lit layer was while the card carried the sheet's
   * name and the page had not yet changed: the card as an opening pictures
   * it. Once per value.
   */
  readonly pressed: string[];
  /**
   * How far up the face's lit layer and its deeper shadow were while the
   * card carried the sheet's name and the page had changed: the card a
   * sheet returns to. Once per pair of values.
   */
  readonly returning: string[];
}

/** The boxes a watch looks at, as selectors. */
interface Watch {
  /** The wall root, where the light writes its place on the canvas. */
  readonly room: string;
  /** A card's light box, where the light writes its place on that card. */
  readonly light: string;
  /** A card marked as an opened card's source. */
  readonly marked: string;
  /** A marked card while it carries the sheet's transition name. */
  readonly named: string;
  /** A card's face, inside its card. */
  readonly face: string;
  /** The page's root once a sheet's transition has changed the page. */
  readonly changed: string;
}

const WATCH: Watch = {
  room: LIVE_WALL,
  light: `.${CARD_LIGHT}`,
  marked: MARKED_CARD,
  named: NAMED_CARD,
  face: FACE,
  changed: MOVING_ROOT,
};

/**
 * Runs in the page: watch from now until a view transition has come and
 * gone, and answer with what happened while it was active. A page that never
 * runs one answers with no frames once its patience has run out.
 */
function watchTransition(watch: Watch): Promise<Watched> {
  return new Promise((resolve) => {
    const page = document.documentElement;
    const active = (): boolean => page.matches(":active-view-transition");
    const writes: string[] = [];
    const parts = new Set<string>();
    const moving = new Set<string>();
    const posed = new Set<string>();
    const pressed = new Set<string>();
    const returning = new Set<string>();
    let frames = 0;
    const lookAtMarkedCard = (): void => {
      const face = document.querySelector(`${watch.marked} ${watch.face}`);
      if (face === null) return;
      const transform = getComputedStyle(face).transform;
      if (transform !== "none") posed.add(transform);
      if (face.closest(watch.named) === null) return;
      const lit = getComputedStyle(face, "::before").opacity;
      const shadow = getComputedStyle(face, "::after").opacity;
      if (page.matches(watch.changed)) returning.add(`${lit} ${shadow}`);
      else pressed.add(lit);
    };
    const written = new MutationObserver((records) => {
      if (!active()) return;
      for (const { target } of records) {
        if (!(target instanceof Element)) continue;
        if (target.matches(watch.room)) writes.push("the wall root");
        else if (target.matches(watch.light)) writes.push("a card's light");
      }
    });
    written.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
    const look = (patience: number): void => {
      if (active()) {
        frames++;
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect)) continue;
          const part = effect.pseudoElement;
          const target = effect.target;
          if (part?.startsWith("::view-transition") === true) {
            parts.add(part);
          } else if (
            animation.playState === "running" && target !== null &&
            target.closest(watch.marked) !== null
          ) {
            const changes = animation instanceof CSSTransition
              ? animation.transitionProperty
              : animation.id;
            moving.add(`${target.classList[0] ?? ""}${part ?? ""} ${changes}`);
          }
        }
        lookAtMarkedCard();
      } else if (frames > 0 || patience === 0) {
        written.disconnect();
        resolve({
          frames,
          writes,
          parts: [...parts],
          moving: [...moving],
          posed: [...posed],
          pressed: [...pressed],
          returning: [...returning],
        });
        return;
      }
      requestAnimationFrame(() => look(patience - 1));
    };
    look(600);
  });
}

/**
 * Watch the one view transition `act` starts. The page is first left to
 * settle, so a transition still on its way out is not taken for it.
 */
async function during(
  page: Page,
  act: () => Promise<void>,
): Promise<Watched> {
  await motionSettled(page);
  const watched = page.evaluate(watchTransition, WATCH);
  await act();
  return await watched;
}

/** A point of the viewport. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Bring the pointer to a point as a hand does: from a little way off, across
 * several moves, and then at rest until whatever it touched has finished
 * answering. The light must come up under it: a light that a transition
 * left held for good would rest where it last stood.
 */
async function travelTo(page: Page, to: Point, where: string): Promise<void> {
  await page.mouse.move(to.x - 90, to.y + 30);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await lightSettled(page);
  assert(
    isAt(await lightNow(page), await placeOnWall(page, to)),
    `${where}: the light follows the pointer to where it rests`,
  );
  await motionSettled(page);
}

/** Hold a transition to having run, with the light writing nothing under it. */
function assertLightHeld(watched: Watched, where: string): void {
  assert(watched.frames > 0, `${where}: a view transition ran`);
  assertEquals(
    watched.writes,
    [],
    `${where}: the light wrote on the wall while the transition ran`,
  );
}

/** The two pictures of the page's root a view transition can animate. */
const ROOT_PICTURES = [
  "::view-transition-old(root)",
  "::view-transition-new(root)",
] as const;

/** Which of the root's two pictures a transition animated, old before new. */
function rootPictures(watched: Watched): string[] {
  return ROOT_PICTURES.filter((picture) => watched.parts.includes(picture));
}

/**
 * Hold a sheet's transition to one picture of the page: the old one, which
 * fades out over the page itself. The root is the page's own again once the
 * transition has ended.
 */
async function assertPagePicturedOnce(
  page: Page,
  watched: Watched,
  where: string,
): Promise<void> {
  const [old] = ROOT_PICTURES;
  assertEquals(
    rootPictures(watched),
    [old],
    `${where}: the page's old picture fades over the page, and no new picture of the page is drawn`,
  );
  assertEquals(
    await page.locator(MOVING_ROOT).count(),
    0,
    `${where}: the root keeps the mark of a transition that has ended`,
  );
}

/** Hold a transition to a marked card in which nothing moves or eases. */
function assertMarkedCardStill(watched: Watched, where: string): void {
  assertEquals(
    watched.moving,
    [],
    `${where}: something eased inside the opened card's source`,
  );
  assertEquals(
    watched.posed,
    [],
    `${where}: the face of the opened card's source carried a transform`,
  );
}

/**
 * Open a card by a pointer that travels to it and presses, close it by a
 * click outside the sheet, and hold both transitions to their cost. The
 * pointer then travels on across the wall, and the light must follow it.
 */
async function assertOpensAndClosesCheaply(
  page: Page,
  press: Press,
  where: string,
): Promise<void> {
  await travelTo(page, press, where);
  const opening = await during(page, async () => {
    await page.mouse.down();
    await page.mouse.up();
    await page.locator(OPEN_SHEET).waitFor();
  });
  assertLightHeld(opening, `${where}, opening`);
  await assertPagePicturedOnce(page, opening, `${where}, opening`);
  assertMarkedCardStill(opening, `${where}, opening`);
  const grown = await page.locator(NEAR_WALL).count() === 1;
  assertEquals(
    await markedCards(page),
    grown ? [`${press.id}:held`] : [],
    `${where}: a flat card grows into its sheet, and no other does`,
  );
  // Where a pointer can hover, the visitor pressed a lit card, and the
  // browser has let go of the hover by the time it pictures the card.
  assertEquals(
    opening.pressed,
    grown ? ["1"] : [],
    `${where}: the card is pictured lit, as it was pressed`,
  );

  const closing = await during(page, async () => {
    await page.mouse.click(press.x, OUTSIDE_Y);
    await sheetGone(page, where);
  });
  assertLightHeld(closing, `${where}, closing`);
  await assertPagePicturedOnce(page, closing, `${where}, closing`);
  assertMarkedCardStill(closing, `${where}, closing`);
  // The pointer is off the card and the keyboard never reached it, so
  // nothing lights the card the sheet returns to.
  assertEquals(
    closing.returning,
    grown ? ["0 0"] : [],
    `${where}: the card the sheet returns to arrives unlit`,
  );

  await travelTo(page, { x: press.x + 48, y: press.y + 24 }, where);
}

const [, LAPTOP] = VIEWPORTS;

Deno.test("while a card opens or closes the light and the card hold still and the page is pictured once, and a lens cross-fades two pictures of the page", async () => {
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  for (const size of [LAPTOP, WIDE_VIEWPORT]) {
    await withBrowser(async (browser) => {
      const { page, faults } = await openLiveWall(
        await browser.newContext({
          viewport: { width: size.width, height: size.height },
          reducedMotion: "no-preference",
        }),
      );

      // Far: the sheet arrives and leaves where it stands, over a wall the
      // light crosses without reaching a card.
      await page.locator(FAR_WALL).waitFor();
      await assertOpensAndClosesCheaply(
        page,
        await pressableCard(page, size, "bottom"),
        `${size.name}, far`,
      );
      await dropFocus(page);

      // Near: the card grows into the sheet and the sheet returns to it,
      // under a light that reaches the cards round the pointer.
      await scrollToWall(page);
      await page.locator(NEAR_WALL).waitFor();
      const near = await pressableCard(page, size, "top");
      await assertOpensAndClosesCheaply(page, near, `${size.name}, near`);

      // Two requests in one task: the later one wins, and the earlier one
      // still makes its change, before the winner takes its first picture.
      const other = await pressableCard(page, size, "top", near.id);
      const overtaking = await during(page, async () => {
        await page.evaluate((openers) => {
          for (const opener of openers) {
            document.querySelector<HTMLElement>(opener)?.click();
          }
        }, [openerOf(near.id), openerOf(other.id)]);
        await page.locator(OPEN_SHEET).waitFor();
      });
      await assertPagePicturedOnce(
        page,
        overtaking,
        `${size.name}, a request that overtakes another`,
      );
      await page.mouse.click(near.x, OUTSIDE_Y);
      await sheetGone(page, `${size.name}, a request that overtakes another`);

      // A lens: the page cross-fades from one order to the other.
      const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
      const box = await chip.boundingBox();
      assert(box !== null, `${size.name}: the ${lens.id} chip has a box`);
      await travelTo(page, {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      }, `${size.name}, a lens`);
      const sorting = await during(page, async () => {
        await page.mouse.down();
        await page.mouse.up();
        await chip.and(page.locator("[aria-pressed='true']")).waitFor();
      });
      assertLightHeld(sorting, `${size.name}, a lens`);
      assertEquals(
        rootPictures(sorting),
        [...ROOT_PICTURES],
        `${size.name}, a lens: the page cross-fades from its old picture to its new one`,
      );
      await travelTo(page, near, `${size.name}, a lens`);
      assertEquals(faults, [], size.name);
    });
  }
});
