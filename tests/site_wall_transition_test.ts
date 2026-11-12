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
import type { Page } from "playwright-core";
import { CARD_LIGHT } from "../site/wall/Card.tsx";
import { WALL_LENSES } from "../site/wall/deck.ts";
import { LIGHT_PROPERTIES } from "../site/wall/use_light.ts";
import { SHEET_MOVING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
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
  type SheetRule,
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

Deno.test("the page's root leaves a sheet's transition once its old picture is taken", async () => {
  // A root that keeps its transition name is pictured in the new state too.
  // WebKit draws that picture afresh on every frame of the transition, the
  // whole viewport of it, and its main thread waits for each one. With no
  // name from the moment the page changes, the old picture fades out over
  // the page itself, which is the same cross-fade to the eye.
  assertEquals(
    (await wallRules()).filter(({ rule }) =>
      rule.selectors.some((selector) =>
        selector.includes(`[${SHEET_MOVING_ATTRIBUTE}]`)
      )
    ).map(written),
    [`wall-interactions.css: ${MOVING_ROOT} { view-transition-name: none }`],
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
}

/** The boxes a watch looks at, as selectors. */
interface Watch {
  /** The wall root, where the light writes its place on the canvas. */
  readonly room: string;
  /** A card's light box, where the light writes its place on that card. */
  readonly light: string;
}

const WATCH: Watch = { room: LIVE_WALL, light: `.${CARD_LIGHT}` };

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
    let frames = 0;
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
        for (const { effect } of document.getAnimations()) {
          const part = effect instanceof KeyframeEffect
            ? effect.pseudoElement
            : null;
          if (part?.startsWith("::view-transition") === true) parts.add(part);
        }
      } else if (frames > 0 || patience === 0) {
        written.disconnect();
        resolve({ frames, writes, parts: [...parts] });
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
  const grown = await page.locator(NEAR_WALL).count() === 1;
  assertEquals(
    await markedCards(page),
    grown ? [`${press.id}:held`] : [],
    `${where}: a flat card grows into its sheet, and no other does`,
  );

  const closing = await during(page, async () => {
    await page.mouse.click(press.x, OUTSIDE_Y);
    await sheetGone(page, where);
  });
  assertLightHeld(closing, `${where}, closing`);
  await assertPagePicturedOnce(page, closing, `${where}, closing`);

  await travelTo(page, { x: press.x + 48, y: press.y + 24 }, where);
}

const [, LAPTOP] = VIEWPORTS;

Deno.test("while a card opens or closes the light holds still and the page is pictured once, and a lens cross-fades two pictures of the page", async () => {
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
