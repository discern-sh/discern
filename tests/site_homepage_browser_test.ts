/**
 * Real-browser homepage checks against the production handler, at phone and
 * laptop sizes. The wall's content must be complete before any script runs, and
 * the island must then hydrate that same markup under the site's Content
 * Security Policy without one page or console error, and without a word from
 * a development build of React. The same pages hold the wall's motion
 * contract: the approach on a large screen, a flat wall on a phone, under
 * reduced motion, and under the keyboard's focus, a pointer that moves
 * nothing, and a lens that re-sorts the wall with no card seen to travel.
 * Layout, script policy, motion, focus, and reflow need a real browser to
 * judge. The opened card has its own file, `site_wall_sheet_browser_test.ts`.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import type { Locator, Page } from "playwright-core";
import { DISCERN_CATEGORY_LINE, LANDING_HEADLINE } from "../site/brand.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { bundleBrowserModule } from "../site/page-src/format-generated.ts";
import {
  WALL_ISLAND_ENTRY,
  wallIslandContentHash,
} from "../site/wall/assets.ts";
import { cardHeading, RECEDED_ATTRIBUTE } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { linkRoute } from "../site/wall/host.ts";
import {
  LENS_REST,
  lensGroups,
  lensRecedes,
  lensStatus,
} from "../site/wall/Lens.tsx";
import { WALL_KNOBS, wallKnobProperty } from "../site/wall/tuning/knobs.ts";
import type { WallLens } from "../site/wall/types.ts";
import { NEAR_ATTRIBUTE } from "../site/wall/use_stage.ts";
import { MANUAL_START } from "../site/wall/WallPage.tsx";
import {
  atEachViewport,
  countSheets,
  dropFocus,
  eventually,
  FAR_WALL,
  LIVE_WALL,
  motionSettled,
  NEAR_WALL,
  OPEN_SHEET,
  openerOf,
  openLiveWall,
  openPage,
  ORIGIN,
  OUTSIDE_Y,
  planeTransform,
  pressableCard,
  RECEDED_CARD,
  sampleWall,
  scrolled,
  scrollToWall,
  SHEET,
  sheetGone,
  sheetName,
  sheetsMounted,
  type Viewport,
  VIEWPORTS,
  wallAtRest,
  watchTransition,
  withBrowser,
} from "./site_wall_browser.ts";
import { declared, readWallSheet, styleRules } from "./wall_stylesheets.ts";

/** The most a hovered card's own box may differ from its box at rest, in pixels. */
const HOVER_TRAVEL = 6;

/** A receded card can still be read and opened, so it keeps at least this opacity. */
const RECEDED_OPACITY_FLOOR = 0.7;

/**
 * Whether the first card is drawn exactly where layout put it, at its layout
 * size. A tilted or scaled plane fails this whatever its transform reads as.
 */
function firstCardIsFlat(page: Page): Promise<boolean> {
  return page.locator(".wall-list > .wall-card").first().evaluate((card) => {
    if (!(card instanceof HTMLElement)) return false;
    const drawn = card.getBoundingClientRect();
    return Math.abs(drawn.width - card.offsetWidth) < 0.5 &&
      Math.abs(drawn.height - card.offsetHeight) < 0.5;
  });
}

/** How far the document extends past the viewport sideways, and its height. */
function documentExtent(
  page: Page,
): Promise<{ readonly overflowX: number; readonly height: number }> {
  return page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight,
  }));
}

/** Everything in the lens bar that cannot be seen, the bar itself included. */
function hiddenControls(page: Page): Promise<string[]> {
  return page.locator(".wall-controls, .wall-controls *").evaluateAll((
    controls,
  ) =>
    controls.filter((control) =>
      getComputedStyle(control).visibility !== "visible"
    ).map((control) => `${control.tagName}.${control.className}`)
  );
}

/** The lens bar as a pointer finds it. */
interface LensBar {
  /** How far the bar has faded in: "0" is unseen and "1" is whole. */
  readonly opacity: string;
  /** Whether a press on its first chip would reach that chip. */
  readonly pressable: boolean;
  /** Whether any part of that chip lies in the viewport. */
  readonly inView: boolean;
}

/** The lens bar's look, and what a press on its first chip would hit. */
function lensBar(page: Page): Promise<LensBar> {
  return page.locator(".wall-controls").evaluate((bar) => {
    const chip = bar.querySelector(".wall-chip");
    const box = chip?.getBoundingClientRect();
    const hit = box === undefined ? null : document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return {
      opacity: getComputedStyle(bar).opacity,
      pressable: chip !== null && hit !== null && chip.contains(hit),
      inView: box !== undefined && box.bottom > 0 && box.top < innerHeight,
    };
  });
}

/** The lens bar, whole and ready to press. */
const WHOLE_BAR: LensBar = { opacity: "1", pressable: true, inView: true };

/** What holds the focus, and how the page stands around it. */
interface Focus {
  /** The focused card's id, or the focused control's class. */
  readonly on: string;
  /** Whether the focus is drawn as the keyboard's. */
  readonly keyboard: boolean;
  /** Whether the whole focused box lies in the viewport. */
  readonly inView: boolean;
  /** Whether the focused box is drawn at the size it was laid out at. */
  readonly flat: boolean;
}

/** Runs in the page: describe the focused element as `Focus` does. */
function readFocus(): Focus {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) {
    return { on: "", keyboard: false, inView: false, flat: false };
  }
  const box = focused.getBoundingClientRect();
  return {
    on: focused.closest<HTMLElement>(".wall-card")?.dataset.card ??
      focused.className,
    keyboard: focused.matches(":focus-visible"),
    inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 &&
      box.right <= innerWidth,
    flat: Math.abs(box.width - focused.offsetWidth) < 1 &&
      Math.abs(box.height - focused.offsetHeight) < 1,
  };
}

/**
 * The wall's motion contract for one viewport. It leaves the page scrolled to
 * the wall with the plane flat, which is where the lens and the cards are
 * exercised.
 */
async function assertStage(page: Page, size: Viewport): Promise<void> {
  if (size.name === "phone") {
    // A phone gets the flat wall from the start: no approach to scroll through.
    await page.locator(NEAR_WALL).waitFor();
    assertEquals(await planeTransform(page), "none", "phone: flat at the top");
    assert(await firstCardIsFlat(page), "phone: cards at their layout size");
    // The lens is there from the start, with no approach to bring it in.
    assertEquals(await hiddenControls(page), [], "phone: the lens is whole");
    assertEquals((await lensBar(page)).opacity, "1", "phone: the lens is seen");
    assertEquals(await scrolled(page), 0, "phone: at the top");
    assertEquals((await documentExtent(page)).overflowX, 0, "phone");
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    assertEquals(await planeTransform(page), "none", "phone: flat when read");
    return;
  }

  // Far: at the top of the page the plane is tilted away, the stage has not
  // called it near, and the lens has not arrived. The lens is unseen, not
  // gone: assistive technology finds its group, and an unseen chip takes no
  // press meant for the floor it lies over.
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: tilted at top");
  assertEquals(
    await firstCardIsFlat(page),
    false,
    "laptop: the far rows are small",
  );
  assertEquals(
    await lensBar(page),
    { opacity: "0", pressable: false, inView: true },
    "laptop: the lens stays out of the far view",
  );
  assertEquals(
    await page.getByRole("group").and(page.locator(".wall-lens")).count(),
    1,
    "laptop: the lens is in the accessibility tree at the top of the page",
  );
  const far = await documentExtent(page);
  assertEquals(
    far.overflowX,
    0,
    "laptop: the far plane does not widen the page",
  );

  // The pointer light's place is written on the wall root and is not
  // inherited, so a pointer crossing the first viewport restyles the root's
  // own boxes and hands that place to nothing under it.
  await page.mouse.move(size.width / 2, size.height - 120);
  const lit = "--wall-light-x";
  await page.waitForFunction(
    (name) =>
      document.querySelector<HTMLElement>(".wall")?.style.getPropertyValue(
        name,
      ) !== "",
    lit,
  );
  const places = await page.evaluate((name) => {
    const place = (selector: string): string => {
      const element = document.querySelector<HTMLElement>(selector);
      return element === null
        ? "missing"
        : getComputedStyle(element).getPropertyValue(name).trim();
    };
    return {
      root: place(".wall"),
      under: [".wall-pool", ".wall-plane", ".wall-card-face"].map(place),
    };
  }, lit);
  for (const place of places.under) {
    assertNotEquals(place, "missing");
    assertNotEquals(
      place,
      places.root,
      "laptop: the pointer light's place stops short of the far plane",
    );
  }

  // Near: once the pool has scrolled away the plane carries no transform at
  // all, the stage says so, and the lens is there to use, whole, at once.
  await scrollToWall(page);
  await page.locator(NEAR_WALL).waitFor();
  assertEquals(await planeTransform(page), "none", "laptop: flat when near");
  assert(await firstCardIsFlat(page), "laptop: cards at their layout size");
  assertEquals(await hiddenControls(page), [], "laptop: the lens has arrived");
  assertEquals(await lensBar(page), WHOLE_BAR, "laptop: the lens is whole");
  assertEquals(
    (await documentExtent(page)).height,
    far.height,
    "laptop: the approach does not change the page's height",
  );

  // Scrolling back up tilts the plane away again.
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: far again");

  // The keyboard reaches the lens from the top of the page. Its focus on the
  // stage lays the plane flat where it stands, so nothing scrolls, the lens
  // shows whole, and everything scoped to the flat wall agrees: the stage
  // marks the root near, and the pointer light reaches card borders.
  await page.locator(".wall-pool .wall-cta").focus();
  await page.keyboard.press("Tab");
  assertEquals(
    await page.evaluate(readFocus),
    { on: "wall-skip", keyboard: true, inView: true, flat: true },
    "laptop: after the call to action, Tab lands on the link past the cards",
  );
  await page.keyboard.press("Tab");
  assertEquals(
    await page.evaluate(readFocus),
    { on: "wall-chip", keyboard: true, inView: true, flat: true },
    "laptop: the next Tab lands on a lens chip",
  );
  assertEquals(await scrolled(page), 0, "laptop: the lens is at the top");
  assertEquals(await lensBar(page), WHOLE_BAR, "laptop: the focused lens");
  assertEquals(await planeTransform(page), "none", "laptop: flat under focus");
  assert(await firstCardIsFlat(page), "laptop: cards at their layout size");
  await page.locator(NEAR_WALL).waitFor();
  assertNotEquals(
    await page.locator(".wall").evaluate((wall) =>
      getComputedStyle(wall).getPropertyValue("--wall-light-reach").trim()
    ),
    "0px",
    "laptop: the light reaches cards on a wall the keyboard has laid flat",
  );

  // The far view returns when the keyboard's focus leaves the stage.
  await dropFocus(page);
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: far once more");
  assertEquals((await lensBar(page)).opacity, "0", "laptop: the lens leaves");

  // Reduced motion: flat and near at the top, both when the preference
  // changes under a loaded page and from the start of a fresh load.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(NEAR_WALL).waitFor();
  assertEquals(await planeTransform(page), "none", "reduced motion: flat");
  await page.reload();
  await page.locator(NEAR_WALL).waitFor();
  assertEquals(await scrolled(page), 0);
  assertEquals(await planeTransform(page), "none", "reduced motion: at load");
  assert(await firstCardIsFlat(page), "reduced motion: cards at layout size");
  // The lens is there from the start, with no approach to bring it in.
  assertEquals(await hiddenControls(page), [], "reduced motion: the lens");
  assertEquals(await lensBar(page), WHOLE_BAR, "reduced motion: the lens");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "motion allowed again");

  await scrollToWall(page);
  await page.locator(NEAR_WALL).waitFor();
}

/**
 * Calm: with the wall flat, pointer travel moves no card. A card the pointer
 * has not touched keeps its exact box and look at every stop; a card it has
 * touched stays within a few pixels of rest; and once the pointer has left,
 * every card is back exactly where it began.
 */
async function assertCalm(page: Page, size: Viewport): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const baseline = await wallAtRest(page, size);
  const atRest = new Map(baseline.cards.map((card) => [card.id, card]));
  assertEquals(atRest.size, WALL_DECK.length);

  // A zigzag over the visible wall, below the lens bar.
  const stops = Array.from({ length: 14 }, (_, index) => ({
    x: Math.round(size.width * (0.06 + 0.88 * ((index * 5) % 14) / 13)),
    y: Math.round(size.height * (0.2 + 0.72 * index / 13)),
  }));
  const touched = new Set<string>();
  for (const stop of stops) {
    await page.mouse.move(stop.x, stop.y);
    const { cards, under } = await sampleWall(page, stop);
    if (under !== null) touched.add(under);
    for (const card of cards) {
      const was = atRest.get(card.id);
      assert(was !== undefined, `${card.id} was on the wall at rest`);
      const where = `pointer at ${stop.x},${stop.y}`;
      if (!touched.has(card.id)) {
        assertEquals(card.box, was.box, `${card.id} moved with the ${where}`);
        assertEquals(card.look, was.look, `${card.id} changed, ${where}`);
        continue;
      }
      card.box.forEach((value, index) => {
        const drift = Math.abs(value - (was.box[index] ?? 0));
        assert(
          drift <= HOVER_TRAVEL,
          `${card.id} moved ${drift}px under the ${where}`,
        );
      });
    }
  }
  assert(touched.size >= 4, "the sweep crossed several cards");

  assertEquals(
    await wallAtRest(page, size),
    baseline,
    "every card is back exactly at rest once the pointer has left",
  );
}

/** One item of the wall's list as the page orders and draws it. */
interface WallItem {
  /** The card's id, or nothing for the divider. */
  readonly id: string | null;
  /** The divider's words; a card's are not read here. */
  readonly words: string;
  readonly receded: boolean;
  /** The item's box on the page itself, which scrolling leaves alone. */
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

/** The wall's list, item by item, in the page's own order. */
function wallItems(page: Page): Promise<WallItem[]> {
  return page.locator(".wall-list > *").evaluateAll(
    (items, receded) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        const id = item instanceof HTMLElement ? item.dataset.card : undefined;
        return {
          id: id ?? null,
          words: id === undefined ? (item.textContent ?? "") : "",
          receded: item.hasAttribute(receded),
          top: box.top + scrollY,
          bottom: box.bottom + scrollY,
          width: box.width,
        };
      }),
    RECEDED_ATTRIBUTE,
  );
}

/** How far the stage's top edge lies below the top of the viewport. */
function stageTop(page: Page): Promise<number> {
  return page.locator(".wall-stage").evaluate((stage) =>
    stage.getBoundingClientRect().top
  );
}

/** Whether the card with this id shows at least half of itself under the lens bar. */
function cardInView(page: Page, id: string): Promise<boolean> {
  return page.locator(`.wall-card[data-card="${id}"]`).evaluate((card) => {
    const bar = document.querySelector(".wall-controls")
      ?.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const shown = Math.min(box.bottom, innerHeight) -
      Math.max(box.top, bar?.bottom ?? 0);
    return shown * 2 >= box.height;
  });
}

/**
 * Press a chip where it lies in the lens bar. The strip is first scrolled, by
 * itself, until the chip is in it, as a visitor's swipe would do. Asking the
 * browser to bring the chip into view would move the page as well, which no
 * press does, and the lens is judged by where the page then stands.
 */
async function pressChip(page: Page, chip: Locator): Promise<void> {
  await chip.evaluate((button) =>
    button.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "instant",
    })
  );
  const box = await chip.boundingBox();
  assert(box !== null, "the chip has a box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * A receded card is still a card: it stays legible, and the keyboard can
 * reach it and open it.
 */
async function assertRecededStillWorks(
  page: Page,
  lens: WallLens,
): Promise<void> {
  const receded = WALL_DECK.find((card) => lensRecedes(lens, card));
  assert(receded !== undefined, `${lens.id} lets some card recede`);
  await motionSettled(page);
  const faintest = Math.min(
    ...await page.locator(RECEDED_CARD).evaluateAll((cards) =>
      cards.map((card) => Number(getComputedStyle(card).opacity))
    ),
  );
  assert(
    faintest >= RECEDED_OPACITY_FLOOR,
    `a receded card is drawn at ${faintest}, too faint to read`,
  );
  await page.locator(openerOf(receded.id)).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: sheetName(receded), exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.locator(SHEET).waitFor({ state: "detached" });
}

/** The chip that chooses this lens, or "Everything" for no lens. */
function chipOf(page: Page, lens: WallLens | undefined): Locator {
  return page.locator(
    lens === undefined
      ? ".wall-chip:not([data-lens])"
      : `.wall-chip[data-lens="${lens.id}"]`,
  );
}

/** Press a lens's chip and wait until the wall has taken the choice. */
async function chooseLens(
  page: Page,
  lens: WallLens | undefined,
): Promise<void> {
  const chip = chipOf(page, lens);
  await pressChip(page, chip);
  await chip.and(page.locator("[aria-pressed='true']")).waitFor();
}

/**
 * Hold the wall to the order a lens gives it: the cards it kept, one divider
 * across every column, then the rest, receded, each group in the deck's own
 * order. With no lens the wall is the deck, with no divider and nothing
 * receded. The status says the same in words.
 */
async function assertWallOrder(
  page: Page,
  lens: WallLens | undefined,
  where: string,
): Promise<void> {
  const kept = WALL_DECK.filter((card) => !lensRecedes(lens, card));
  const rest = WALL_DECK.filter((card) => lensRecedes(lens, card));
  const items = await wallItems(page);
  const divider = { id: null, words: LENS_REST, receded: false };
  assertEquals(
    items.map(({ id, words, receded }) => ({ id, words, receded })),
    [
      ...kept.map(({ id }) => ({ id, words: "", receded: false })),
      ...(lens === undefined ? [] : [divider]),
      ...rest.map(({ id }) => ({ id, words: "", receded: true })),
    ],
    `${where}: the wall's order`,
  );
  assertEquals(
    await page.locator(".wall-lens").getByRole("status").textContent(),
    lensStatus(lens, lensGroups(lens, WALL_DECK)),
    `${where}: what the lens says it did`,
  );
  if (lens === undefined) return;

  // The divider is drawn where the list has it: one row as wide as the wall,
  // under every card the lens kept and over every card it set aside.
  const line = items[kept.length];
  assert(line !== undefined && line.id === null, `${where}: the divider`);
  const wide = await page.locator(".wall-list").evaluate((list) =>
    list.getBoundingClientRect().width
  );
  assert(Math.abs(line.width - wide) <= 1, `${where}: the divider spans`);
  assert(
    items.slice(0, kept.length).every((card) => card.bottom <= line.top + 1) &&
      items.slice(kept.length + 1).every((card) => card.top >= line.bottom - 1),
    `${where}: the divider lies between the two groups`,
  );
}

/**
 * The lens: one row of chips. Choosing one leads the wall with the cards it
 * kept and sets the rest after a divider, and choosing it again, or
 * "Everything", gives the deck's order back exactly. No card is removed. A
 * reader at the head of the wall stays there, and a reader further down is
 * brought back to it. Where motion is welcome the page cross-fades once, as
 * one picture, and a press made while it fades still lands.
 */
async function assertLens(page: Page, size: Viewport): Promise<void> {
  assertEquals(
    await page.locator(".wall-chip").evaluateAll((chips) =>
      new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)))
        .size
    ),
    1,
    `${size.name}: the chips share one row`,
  );
  assertEquals(
    (await documentExtent(page)).overflowX,
    0,
    `${size.name}: the row of chips does not widen the page`,
  );
  await assertWallOrder(page, undefined, `${size.name}, no lens`);

  for (const lens of WALL_LENSES) {
    const where = `${size.name}, ${lens.id}`;
    const [leader] = WALL_DECK.filter((card) => !lensRecedes(lens, card));
    assert(leader !== undefined, `${where}: the lens keeps a card`);

    // From the head of the wall: the cards the lens kept arrive under the
    // bar, and the page stays where it is.
    await scrollToWall(page);
    const from = await scrolled(page);
    assertEquals(
      await chipOf(page, lens).getAttribute("aria-pressed"),
      "false",
      where,
    );
    await chooseLens(page, lens);
    assertEquals(
      await chipOf(page, undefined).getAttribute("aria-pressed"),
      "false",
      where,
    );
    await assertWallOrder(page, lens, where);
    assertEquals(await scrolled(page), from, `${where}: the page stays put`);
    assert(
      await cardInView(page, leader.id),
      `${where}: the first card the lens kept is in view`,
    );
    assertEquals(
      (await documentExtent(page)).overflowX,
      0,
      `${where}: the divider does not widen the page`,
    );

    if (lens === WALL_LENSES[0]) {
      await assertRecededStillWorks(page, lens);
      await chooseLens(page, undefined);
    } else {
      // Pressing the pressed chip lets the lens go.
      await pressChip(page, chipOf(page, lens));
      await chipOf(page, undefined).and(page.locator("[aria-pressed='true']"))
        .waitFor();
    }
    await assertWallOrder(page, undefined, `${where}, let go`);
    assertEquals(await scrolled(page), from, `${where}: let go in place`);
  }

  // From further down the wall, choosing a lens and letting it go each bring
  // the page back to the head of the wall, where the re-sorted cards begin.
  const [first, second] = WALL_LENSES;
  assert(first !== undefined && second !== undefined, "two lenses to choose");
  for (const lens of [first, undefined]) {
    const where = `${size.name}, ${lens?.id ?? "no lens"}, from down the wall`;
    await page.evaluate(() => scrollBy({ top: 1500, behavior: "instant" }));
    assert(await stageTop(page) < -1000, `${where}: the reader is down it`);
    await chooseLens(page, lens);
    await assertWallOrder(page, lens, where);
    assert(
      Math.abs(await stageTop(page)) <= 1,
      `${where}: the page comes back to the head of the wall`,
    );
  }

  // Requests a frame apart, each made before the last has been shown: the
  // last one stands, and a cross-fade that another cut short is no fault.
  const hurried = WALL_LENSES.slice(0, 4);
  const last = hurried.at(-1);
  assert(last !== undefined && hurried.length > 2, "lenses to hurry through");
  await page.evaluate(async (ids) => {
    for (const id of ids) {
      document.querySelector<HTMLElement>(`.wall-chip[data-lens="${id}"]`)
        ?.click();
      await new Promise((frame) => requestAnimationFrame(frame));
    }
  }, hurried.map(({ id }) => id));
  await chipOf(page, last).and(page.locator("[aria-pressed='true']")).waitFor();
  await assertWallOrder(page, last, `${size.name}, hurried`);
  await chooseLens(page, undefined);

  // One cross-fade of the whole page: no card has a transition part of its
  // own, so none can be seen to travel. A second press made at once, while
  // the page is fading, ends the fade and reaches the chip it was aimed at.
  const fade = page.evaluate(watchTransition);
  await pressChip(page, chipOf(page, first));
  await chooseLens(page, second);
  const parts = await fade;
  assert(parts.length > 0, `${size.name}: a lens cross-fades the page`);
  assertEquals(
    parts.filter((part) => !part.endsWith("(root)")),
    [],
    `${size.name}: only the page itself cross-fades`,
  );
  await assertWallOrder(page, second, `${size.name}, pressed mid-fade`);
  await chooseLens(page, undefined);
  await assertWallOrder(page, undefined, `${size.name}, at the end`);
  await motionSettled(page);
}

/**
 * The sheet is named as its card's own button is: a numeral leads the
 * heading. Its link, where the card names a page, is named by that page's
 * title in the manual, so the link says where it goes. Where nothing has to
 * finish moving, every card in the deck is opened by keyboard, asked its
 * name and its link's, and closed, with focus back on it.
 */
async function assertEverySheetIsNamed(page: Page): Promise<void> {
  const manual = await loadDocsSite();
  const titles = new Map(
    [manual.landing, ...manual.pages].map((
      each,
    ) => [each.route, each.entry.title]),
  );
  await countSheets(page);
  for (const card of WALL_DECK) {
    const opener = page.locator(openerOf(card.id));
    await opener.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", {
      name: sheetName(card),
      exact: true,
    });
    await sheet.waitFor();
    // A page the manual does not publish has no title, and reads as no name.
    const named = card.href === undefined ? [] : [{
      href: card.href,
      name: titles.get(linkRoute(card.href)) ?? "",
    }];
    assert(
      named.every((link) => link.name.length > 0),
      `${card.id}: ${card.href} leads to a manual page with a title`,
    );
    assertEquals(
      await sheet.getByRole("link").evaluateAll((links) =>
        links.map((link) => ({
          href: link.getAttribute("href") ?? "",
          // The arrow after the words is decoration, hidden from the name.
          name: [...link.childNodes].filter((node) =>
            !(node instanceof Element && node.ariaHidden === "true")
          ).map((node) => node.textContent ?? "").join("").trim(),
        }))
      ),
      named,
      `${card.id}: the sheet's link is named by the manual page it leads to`,
    );
    await page.keyboard.press("Escape");
    await sheetGone(page, card.id);
    assert(
      await opener.evaluate((button) => button === document.activeElement),
      `${card.id}: focus returns to the card`,
    );
  }
  assertEquals(await sheetsMounted(page), WALL_DECK.length);
}

/**
 * Runs in the page before its own scripts: note every transition that starts
 * on the lens bar or inside it, where the page can read the notes back.
 */
function noteControlTransitions(): void {
  document.addEventListener("transitionrun", (event) => {
    const target = event.target;
    if (
      !(target instanceof Element) || target.closest(".wall-controls") === null
    ) return;
    const root = document.documentElement;
    root.dataset.testControlTransitions = `${
      root.dataset.testControlTransitions ?? ""
    }${event.propertyName} on .${target.className}${event.pseudoElement}; `;
  }, true);
}

/**
 * Runs in the page before its own scripts: note every view transition the
 * page asks for, and every transition or animation that starts on an item of
 * the wall's list, where the page can read the notes back. An item is what a
 * lens recedes and re-sorts; what a card's face does under a pointer is the
 * card's own affair.
 */
function noteWallMotion(): void {
  const note = (what: string): void => {
    const root = document.documentElement;
    root.dataset.testWallMotion = `${
      root.dataset.testWallMotion ?? ""
    }${what}; `;
  };
  const start = Document.prototype.startViewTransition;
  if (typeof start === "function") {
    Document.prototype.startViewTransition = new Proxy(start, {
      apply(target, page, args): unknown {
        note("a view transition");
        return Reflect.apply(target, page, args);
      },
    });
  }
  for (const type of ["transitionrun", "animationstart"]) {
    document.addEventListener(type, (event) => {
      const target = event.target;
      if (target instanceof Element && target.matches(".wall-list > *")) {
        note(`${type} on .${target.className}`);
      }
    }, true);
  }
}

/**
 * At the foot of the page the lens bar has gone. It is unseen and takes no
 * press, so no part of it is left cut by the viewport's edge, and it is whole
 * again back up the wall.
 */
async function assertLensLeavesAtTheEnd(
  page: Page,
  size: Viewport,
): Promise<void> {
  const fadedTo = (opacity: string): Promise<unknown> =>
    page.waitForFunction((wanted) => {
      const bar = document.querySelector(".wall-controls");
      return bar !== null && getComputedStyle(bar).opacity === wanted;
    }, opacity);
  await page.evaluate(() =>
    scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    })
  );
  await fadedTo("0");
  const end = await lensBar(page);
  assertEquals(
    [end.opacity, end.pressable],
    ["0", false],
    `${size.name}: the lens bar is still there at the foot of the page`,
  );
  await scrollToWall(page);
  await fadedTo("1");
  assertEquals(
    await lensBar(page),
    WHOLE_BAR,
    `${size.name}: back up the wall`,
  );
}

/**
 * Runs in the page: how many frames draw the plane with a transform on it,
 * of this frame and the `frames` that follow.
 */
function tiltedFrames(frames: number): Promise<number> {
  return new Promise((resolve) => {
    const plane = document.querySelector(".wall-plane");
    let tilted = 0;
    const look = (left: number): void => {
      if (plane === null || getComputedStyle(plane).transform !== "none") {
        tilted++;
      }
      if (left === 0) resolve(tilted);
      else requestAnimationFrame(() => look(left - 1));
    };
    look(frames);
  });
}

/**
 * How many frames a step of the keyboard is watched for where the page jumps
 * under it: over half a second, which outlasts any scroll the step starts.
 */
const JUMP_FRAMES = 40;

/**
 * Press a key and hold the wall to a flat plane as the key lands and on each
 * of the `frames` that follow, then to a focus that is the keyboard's, wholly
 * in view, and at its reading size. A browser scrolls to a focused card by
 * where the card is drawn, so a plane that tilts under the step leaves the
 * focus somewhere else.
 */
async function assertStep(
  page: Page,
  key: string,
  where: string,
  frames = 0,
): Promise<Focus> {
  await page.keyboard.press(key);
  assertEquals(
    await page.evaluate(tiltedFrames, frames),
    0,
    `${where}: the plane tilted under ${key}`,
  );
  const focus = await page.evaluate(readFocus);
  assert(
    focus.keyboard && focus.inView && focus.flat,
    `${where}: after ${key} the focus is on ${focus.on}, ${
      focus.inView ? "in view" : "out of view"
    } and ${focus.flat ? "flat" : "tilted"}`,
  );
  return focus;
}

/** The index of the first card in each column of the wall, in the deck's order. */
function columnHeads(page: Page): Promise<number[]> {
  return page.locator(".wall-card").evaluateAll((cards) =>
    cards.flatMap((card, index) => {
      const before = cards[index - 1];
      return before instanceof HTMLElement && card instanceof HTMLElement &&
          before.offsetLeft === card.offsetLeft
        ? []
        : [index];
    })
  );
}

/**
 * The text spacing a reader may set for themselves, which a page must take
 * without losing words: WCAG 2.2 success criterion 1.4.12.
 */
const READER_TEXT_SPACING =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; " +
  "word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

/**
 * Runs in the page: the start of every run of words in the room that the
 * room's own edge cuts off. Words that are never drawn, and words in a strip
 * that scrolls sideways by design, are not counted.
 */
function cutWords(): string[] {
  const wall = document.querySelector(".wall");
  if (wall === null) return ["the page has no wall"];
  const room = wall.getBoundingClientRect();
  const cut: string[] = [];
  const walker = document.createTreeWalker(wall, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const words = (node.textContent ?? "").trim();
    if (words === "") continue;
    let drawn = true;
    for (
      let box = node.parentElement;
      drawn && box !== null && box !== wall;
      box = box.parentElement
    ) {
      const style = getComputedStyle(box);
      drawn = style.clipPath === "none" && style.visibility === "visible" &&
        style.overflowX !== "auto" && style.overflowX !== "scroll";
    }
    if (!drawn) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const outside = [...range.getClientRects()].some((rect) =>
      rect.width > 0 &&
      (rect.left < room.left - 1 || rect.right > room.right + 1)
    );
    if (outside) cut.push(words.slice(0, 40));
  }
  return cut;
}

/** The alpha of the first color a CSS value writes with one, or 1. */
function alphaOf(color: string): number {
  const alpha = /\/\s*([\d.]+)\s*\)/.exec(color)?.[1];
  return alpha === undefined ? 1 : Number(alpha);
}

Deno.test("the homepage is complete before any script runs", async () => {
  await atEachViewport({ javaScriptEnabled: false }, async (context, size) => {
    const { page, faults } = await openPage(context);
    const response = await page.goto(`${ORIGIN}/`);
    assertEquals(response?.status(), 200);

    assertEquals(await page.locator("h1").allTextContents(), [
      LANDING_HEADLINE,
    ]);
    assert(await page.locator("h1").isVisible(), size.name);
    assert(
      await page.getByText(DISCERN_CATEGORY_LINE).first().isVisible(),
      `${size.name}: the category line is readable`,
    );
    assert(
      await page.locator(`main a[href="${MANUAL_START}"]`).first().isVisible(),
      `${size.name}: the call to action is reachable`,
    );

    // The first paint is already the right one: far on a large screen, flat
    // on a phone. Nothing waits for script, so nothing can flash.
    assertEquals(
      await firstCardIsFlat(page),
      size.name === "phone",
      `${size.name}: the first paint's plane`,
    );
    assertEquals((await documentExtent(page)).overflowX, 0, size.name);

    // The keyboard's focus on the stage lays the plane flat by stylesheet
    // alone. The link past the cards comes first; the lens needs script, so
    // the first card is next, in view and at its reading size.
    if (size.name === "laptop") {
      const [leader] = WALL_DECK;
      assert(leader !== undefined, "the deck has a first card");
      await page.locator(".wall-pool .wall-cta").focus();
      await page.keyboard.press("Tab");
      assertEquals(
        await page.evaluate(readFocus),
        { on: "wall-skip", keyboard: true, inView: true, flat: true },
        "no script: Tab reaches the link past the cards",
      );
      assert(await firstCardIsFlat(page), "no script: flat under that focus");
      await page.keyboard.press("Tab");
      assertEquals(
        await page.evaluate(readFocus),
        { on: leader.id, keyboard: true, inView: true, flat: true },
        "no script: the next Tab reaches the first card, flat and in view",
      );
      await dropFocus(page);
      await eventually(
        page,
        async () => !(await firstCardIsFlat(page)),
        "no script: the far view never returns once the focus has gone",
      );
    }

    // Reading distance: scrolled to the wall, every card is flat and legible
    // with no script to bring it there.
    await scrollToWall(page);
    await eventually(
      page,
      () => firstCardIsFlat(page),
      `${size.name}: flat at the wall`,
    );
    const cards = page.locator(".wall-list > .wall-card");
    assertEquals(await cards.count(), WALL_DECK.length, size.name);
    for (const card of WALL_DECK) {
      const item = page.locator(`.wall-card[data-card="${card.id}"]`);
      assert(await item.isVisible(), `${size.name}: ${card.id} is visible`);
      const text = await item.innerText();
      const copy = card.kind === "statement"
        ? [cardHeading(card)]
        : [cardHeading(card), card.line];
      for (const words of copy) {
        assert(
          text.includes(words),
          `${size.name}: ${card.id} reads "${words}"`,
        );
      }
    }

    // Nothing a reader reads is left hidden or faded once the wall is flat:
    // the entrance has finished, and what the far view laid over the floor
    // is gone. No script ran, so no script took any of it away.
    const faded = (): Promise<string[]> =>
      page.evaluate(() => {
        const dimmed = [...document.querySelectorAll(
          "main, .wall, .wall-pool, .wall-pool *, .wall-stage, .wall-plane, " +
            ".wall-list, .wall-card, .wall-card-face, .wall-card-face > *, " +
            ".wall-card-open, .wall-closing, .wall-closing *",
        )].filter((element) => {
          const style = getComputedStyle(element);
          return style.opacity !== "1" || style.visibility !== "visible";
        }).map((element) => `${element.tagName}.${element.className}`);
        const plane = document.querySelector(".wall-plane");
        const veils = plane === null ? [] : ["::before", "::after"].filter(
          (pseudo) => {
            const style = getComputedStyle(plane, pseudo);
            return style.content !== "none" && style.opacity !== "0";
          },
        ).map((pseudo) => `.wall-plane${pseudo}`);
        return [...dimmed, ...veils];
      });
    await eventually(
      page,
      async () => (await faded()).length === 0,
      `${size.name}: the entrance never finishes`,
    );
    assertEquals(await faded(), [], `${size.name}: left hidden or faded`);

    // Controls that need script stay out of sight, and no button that is in
    // sight invites a press it could not answer. A card's button is still
    // its heading, so it shows; it just offers nothing.
    assertEquals(
      await page.locator(`${LIVE_WALL}, .wall[${NEAR_ATTRIBUTE}]`).count(),
      0,
      `${size.name}: only script marks the wall live or near`,
    );
    const buttons = await page.locator(".wall button").evaluateAll((all) =>
      all.filter((button) => {
        const style = getComputedStyle(button);
        return style.visibility === "visible" &&
          button.getClientRects().length > 0;
      }).map((button) => ({
        opensCard: button.matches(".wall-card-open"),
        invites: getComputedStyle(button).cursor === "pointer",
      }))
    );
    assertEquals(
      buttons.filter((button) => !button.opensCard || button.invites),
      [],
      `${size.name}: a control that needs script offers itself`,
    );
    assertEquals(buttons.length, WALL_DECK.length, size.name);

    // The call to action is a plain link, and it leads into the manual.
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator(".wall-pool .wall-cta").click();
    await page.waitForURL(`${ORIGIN}${MANUAL_START}`);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("the island hydrates the served wall, the stage brings it near, and the lens responds", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    // Deferred scripts run after the document turns interactive, so this
    // marks the server's own wall root before the island can touch it.
    await context.addInitScript(() => {
      document.addEventListener("readystatechange", () => {
        const wall = document.querySelector(".wall");
        if (
          wall instanceof HTMLElement && wall.dataset.wallLive === undefined
        ) {
          wall.dataset.testServerRendered = "";
        }
      }, { once: true });
    });
    const { page, faults } = await openPage(context);
    const response = await page.goto(`${ORIGIN}/`);
    assertEquals(response?.status(), 200);
    assert(
      (response?.headers()["content-security-policy"] ?? "").includes(
        "script-src 'self'",
      ),
      "the page is served under the production script policy",
    );

    // Hydration adopted the server's element instead of rendering a new one.
    await page.locator(`${LIVE_WALL}[data-test-server-rendered]`).waitFor();
    assertEquals(
      await page.locator(".wall-list > .wall-card").count(),
      WALL_DECK.length,
    );

    // Nothing on the wall moves by itself, so there is nothing to pause.
    assertEquals(await page.locator(".wall-pause").count(), 0, size.name);

    await assertStage(page, size);
    if (size.name === "laptop") await assertCalm(page, size);
    await assertLens(page, size);
    await assertLensLeavesAtTheEnd(page, size);

    assertEquals(await page.locator(".wall-tune").count(), 0);
    assertEquals(faults, [], size.name);
  });
});

/** The wall island's browser entry, by absolute path. */
const ISLAND_ENTRY = join(
  fromFileUrl(new URL("../", import.meta.url)),
  WALL_ISLAND_ENTRY,
);

Deno.test("a development build of React hydrates the served wall and has nothing to say", async () => {
  // The built island carries React's production build, which keeps the
  // server's attributes without a word when the browser's first render
  // disagrees with them. Only a development build says so, on the console,
  // so the served wall is hydrated once more with one.
  const development = await bundleBrowserModule(ISLAND_ENTRY, {
    minify: false,
  });
  assert(
    !development.includes("Minified React error"),
    "an unminified bundle of the island carries React's development build",
  );
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  const [kept] = lensGroups(lens, WALL_DECK).kept;
  assert(kept !== undefined, `${lens.id} keeps a card`);

  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openPage(context);
    const said: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "log" && message.type() !== "info") {
        said.push(`${message.type()}: ${message.text()}`);
      }
    });
    let served = 0;
    await page.route(
      (url) =>
        wallIslandContentHash(
          url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
        ) !== undefined,
      async (route) => {
        served++;
        await route.fulfill({
          contentType: "text/javascript; charset=utf-8",
          body: development,
        });
      },
    );
    await page.goto(`${ORIGIN}/`);
    await page.locator(LIVE_WALL).waitFor();
    assertEquals(served, 1, `${size.name}: the page loaded the island once`);

    // Hydration, a lens that re-sorts the list, and a sheet that mounts and
    // goes: each is a render a development build checks.
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    await chooseLens(page, lens);
    await assertWallOrder(page, lens, `${size.name}, development React`);
    await page.locator(openerOf(kept.id)).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: sheetName(kept), exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await sheetGone(page, `${size.name}, development React`);
    await chooseLens(page, undefined);
    await motionSettled(page);
    assertEquals(said, [], `${size.name}: development React spoke up`);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("under reduced motion the lens arrives whole and re-sorts the wall with a cut, and every card opens at once under its own name", async () => {
  await atEachViewport(
    { javaScriptEnabled: true, reducedMotion: true },
    async (context, size) => {
      await context.addInitScript(noteControlTransitions);
      await context.addInitScript(noteWallMotion);
      const { page, faults } = await openPage(context);
      await page.goto(`${ORIGIN}/`);

      // The wall is flat from the start, so the lens is there the moment
      // the island is live: all of it, with nothing left to arrive.
      await page.locator(NEAR_WALL).waitFor();
      assertEquals(await hiddenControls(page), [], `${size.name}: at once`);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await motionSettled(page);
      assertEquals(
        await page.evaluate(() =>
          document.documentElement.dataset.testControlTransitions ?? ""
        ),
        "",
        `${size.name}: part of the lens bar arrived by a transition of its own`,
      );
      if (size.name === "laptop") await assertEverySheetIsNamed(page);

      // A lens re-sorts the wall at once, and so does letting it go.
      await scrollToWall(page);
      const [lens] = WALL_LENSES;
      assert(lens !== undefined, "the wall has a lens");
      const motion = (): Promise<string> =>
        page.evaluate(() =>
          document.documentElement.dataset.testWallMotion ?? ""
        );
      await chooseLens(page, lens);
      await assertWallOrder(page, lens, `${size.name}, reduced motion`);
      await chooseLens(page, undefined);
      await assertWallOrder(page, undefined, `${size.name}, reduced motion`);
      assertEquals(
        await motion(),
        "",
        `${size.name}: under reduced motion a lens ran a view transition, or an item of the wall faded`,
      );

      // With no transition to cover it, a click outside closes just as soon.
      const press = await pressableCard(page, size, "top");
      await page.mouse.click(press.x, press.y);
      await page.locator(OPEN_SHEET).waitFor();
      await page.mouse.click(size.width / 2, OUTSIDE_Y);
      await sheetGone(page, "reduced motion");
      await motionSettled(page);
      assertEquals(
        await motion(),
        "",
        `${size.name}: under reduced motion a card opened through a view transition`,
      );
      assertEquals(faults, [], size.name);
    },
  );
});

/** The sizes the keyboard is walked at: both stage the approach. */
const KEYBOARD_VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900 },
  { name: "small laptop", width: 1280, height: 720 },
] as const;

Deno.test("the keyboard walks a flat wall: every card it reaches is in view at reading size, and no step shows the plane tilted", async () => {
  for (const size of KEYBOARD_VIEWPORTS) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        reducedMotion: "no-preference",
      });
      const { page, faults } = await openLiveWall(context);
      await page.locator(FAR_WALL).waitFor();
      const openers = page.locator(".wall-card-open");
      const cardAt = (index: number): string => WALL_DECK[index]?.id ?? "";

      // The stage's first control leads past all the cards, to the closing
      // section's heading.
      await page.locator(".wall-pool .wall-cta").focus();
      const skip = await assertStep(page, "Tab", `${size.name}, from the top`);
      assertEquals(skip.on, "wall-skip", `${size.name}: the first control`);
      await page.keyboard.press("Enter");
      assert(
        await page.locator(".wall-closing-title").evaluate((title) =>
          title === document.activeElement &&
          title.getBoundingClientRect().top >= 0 &&
          title.getBoundingClientRect().bottom <= innerHeight
        ),
        `${size.name}: the link past the cards hands the closing heading the focus, in view`,
      );
      await dropFocus(page);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.locator(FAR_WALL).waitFor();

      // Down the first column: the link, the chips, then card after card.
      await page.locator(".wall-pool .wall-cta").focus();
      const controls = 1 + 1 + WALL_LENSES.length;
      const reached = 12;
      let focus = skip;
      for (let stop = 0; stop < controls + reached; stop++) {
        focus = await assertStep(page, "Tab", `${size.name}, stop ${stop}`);
      }
      assertEquals(focus.on, cardAt(reached - 1), `${size.name}: twelve cards`);

      // Home brings the pool back into view under a focused card. The wall
      // stays flat for the keyboard, so the next card is where it is drawn.
      await page.keyboard.press("Home");
      await page.waitForFunction(() => scrollY === 0);
      focus = await assertStep(
        page,
        "Tab",
        `${size.name}, after Home`,
        JUMP_FRAMES,
      );
      assertEquals(focus.on, cardAt(reached), `${size.name}: the next card`);

      // Across a change of column the page jumps most of its own height,
      // and back again going backward.
      const heads = await columnHeads(page);
      const [, second] = heads;
      assert(second !== undefined && second > 1, `${size.name}: two columns`);
      await openers.nth(second - 1).focus();
      focus = await assertStep(
        page,
        "Tab",
        `${size.name}, to column two`,
        JUMP_FRAMES,
      );
      assertEquals(focus.on, cardAt(second), `${size.name}: its first card`);
      focus = await assertStep(
        page,
        "Shift+Tab",
        `${size.name}, and back`,
        JUMP_FRAMES,
      );
      assertEquals(focus.on, cardAt(second - 1), `${size.name}: the foot`);

      // A key released in the frame it was pressed in, which is how these
      // presses are made, is the hardest case for anything that waits on the
      // key's release.
      await openers.nth(second + 1).focus();
      for (const expected of [second, second - 1]) {
        focus = await assertStep(
          page,
          "Shift+Tab",
          `${size.name}, hurried`,
          JUMP_FRAMES,
        );
        assertEquals(focus.on, cardAt(expected), `${size.name}: hurried`);
      }

      // Backward up the whole wall, no focused card sits under the pinned
      // lens bar: its button starts below the bar's foot.
      await page.locator(".wall-closing .wall-cta").focus();
      const covered: string[] = [];
      for (let stop = 0; stop < WALL_DECK.length; stop++) {
        await page.keyboard.press("Shift+Tab");
        const under = await page.evaluate(() => {
          const bar = document.querySelector(".wall-controls")
            ?.getBoundingClientRect();
          const button = document.activeElement;
          const card = button?.closest<HTMLElement>(".wall-card");
          return button !== null && bar !== undefined &&
              button.getBoundingClientRect().top < bar.bottom
            ? card?.dataset.card ?? "no card"
            : null;
        });
        if (under !== null) covered.push(under);
      }
      assertEquals(
        await page.evaluate(readFocus),
        { on: cardAt(0), keyboard: true, inView: true, flat: true },
        `${size.name}: the walk ends on the first card`,
      );
      assertEquals(covered, [], `${size.name}: focused under the lens bar`);
      assertEquals(faults, [], size.name);
    });
  }
});

/** Narrow and re-spaced rooms, each of which must still show every word. */
const TIGHT_ROOMS = [
  { name: "a phone at 200% zoom", width: 195, height: 422, spaced: false },
  { name: "320 wide, re-spaced", width: 320, height: 640, spaced: true },
  { name: "a laptop at 400% zoom", width: 320, height: 256, spaced: false },
] as const;

Deno.test("a narrow, zoomed, or re-spaced room cuts off no word, and a short one does not pin the lens bar", async () => {
  for (const room of TIGHT_ROOMS) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: room.width, height: room.height },
        reducedMotion: "no-preference",
      });
      const { page, faults } = await openLiveWall(context);
      if (room.spaced) {
        // A constructed sheet is how a reader's own style reaches the page
        // under the site's Content Security Policy.
        await page.evaluate((css) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }, READER_TEXT_SPACING);
      }
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      assertEquals(await page.evaluate(cutWords), [], `${room.name}: cut off`);
      assertEquals((await documentExtent(page)).overflowX, 0, room.name);

      // A pinned bar on a short screen would cover a third of it.
      const pinned = await page.locator(".wall-controls").evaluate((bar) =>
        getComputedStyle(bar).position
      );
      const short = await page.evaluate(() =>
        matchMedia("(max-height: 30rem)").matches
      );
      assertEquals(pinned, short ? "static" : "sticky", room.name);
      assertEquals(faults, [], room.name);
    });
  }
  assert(
    TIGHT_ROOMS.some((room) => room.height <= 480) &&
      TIGHT_ROOMS.some((room) => room.height > 480),
    "the rooms cover a short screen and a tall one",
  );
});

/**
 * The widest viewport, in pixels, at which the lens stylesheet closes the
 * chips up so that the row still fits.
 */
async function chipsCloseUpAt(): Promise<number> {
  const closing = styleRules(await readWallSheet("wall-interactions.css"))
    .find((rule) =>
      rule.selectors.includes(".wall-lens") &&
      declared(rule, "gap") !== undefined &&
      rule.context.some((query) => query.includes("max-width"))
    );
  const rem = /^@media \(max-width: ([\d.]+)rem\)$/.exec(
    closing?.context.at(-1) ?? "",
  )?.[1];
  assert(rem !== undefined, "the chips close up under a width given in rem");
  return Number(rem) * 16;
}

Deno.test("the row of chips fits a laptop screen whole, on both sides of the width where the chips close up", async () => {
  // A row a pixel or two too wide for its screen becomes a strip that scrolls
  // sideways, with its ends faded and its last chip cut.
  const closeUp = await chipsCloseUpAt();
  const [, laptop] = VIEWPORTS;
  for (const width of [1280, closeUp, closeUp + 1]) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width, height: laptop.height },
        reducedMotion: "no-preference",
      });
      const { page, faults } = await openLiveWall(context);
      assertEquals(
        await page.locator(".wall-lens").evaluate((lens) => ({
          rows: new Set(
            [...lens.querySelectorAll(".wall-chip")].map((chip) =>
              Math.round(chip.getBoundingClientRect().top)
            ),
          ).size,
          scrolls: lens.scrollWidth - lens.clientWidth,
        })),
        { rows: 1, scrolls: 0 },
        `${width} pixels wide: the chips are one row, and the row does not scroll`,
      );
      assertEquals(faults, [], `${width} pixels wide`);
    });
  }
});

Deno.test("a reader who asks for more contrast gets firmer inks and edges, and a receded card still reads as set aside", async () => {
  const [, laptop] = VIEWPORTS;
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      reducedMotion: "no-preference",
    });
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    await chooseLens(page, lens);
    const read = async (): Promise<Record<string, number>> => {
      await motionSettled(page);
      return await page.evaluate((receded) => {
        const style = (selector: string): CSSStyleDeclaration | undefined => {
          const element = document.querySelector(selector);
          return element === null ? undefined : getComputedStyle(element);
        };
        return {
          facts: style(".wall-facts")?.color ?? "",
          line: style(".wall-card-line")?.color ?? "",
          chip: style(".wall-chip[aria-pressed='false']")?.borderTopColor ?? "",
          divider: style(".wall-rest")?.borderTopColor ?? "",
          receded: style(receded)?.opacity ?? "",
        };
      }, RECEDED_CARD).then((seen) => ({
        facts: alphaOf(seen.facts),
        line: alphaOf(seen.line),
        chip: alphaOf(seen.chip),
        divider: alphaOf(seen.divider),
        receded: Number(seen.receded),
      }));
    };
    const plain = await read();
    await page.emulateMedia({ contrast: "more" });
    const firm = await read();
    for (const [part, alpha] of Object.entries(firm)) {
      assert(
        alpha > (plain[part] ?? 1),
        `more contrast leaves the ${part} at ${alpha}, from ${plain[part]}`,
      );
    }
    assert(
      (firm.receded ?? 1) < 1,
      "a receded card still reads as set aside under more contrast",
    );
    assertEquals(faults, []);
  });
});

Deno.test("a finger drawn across the wall changes nothing on it", async () => {
  const [phone] = VIEWPORTS;
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: phone.width, height: phone.height },
      reducedMotion: "no-preference",
      hasTouch: true,
    });
    const { page, faults } = await openLiveWall(context);
    await page.locator(NEAR_WALL).waitFor();
    await scrollToWall(page);

    // The light, wherever it is drawn, cannot move unless something on the
    // wall is rewritten. So note every attribute the wall or anything in it
    // has rewritten, and every move of a finger the page is told about.
    await page.evaluate(() => {
      const root = document.documentElement;
      const wall = document.querySelector(".wall");
      if (wall === null) return;
      root.dataset.testTouchMoves = "0";
      document.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "touch") return;
        root.dataset.testTouchMoves = String(
          Number(root.dataset.testTouchMoves) + 1,
        );
      }, true);
      new MutationObserver((records) => {
        root.dataset.testWallWrites = `${root.dataset.testWallWrites ?? ""}${
          records.map((record) =>
            `${record.attributeName} on ${
              record.target instanceof Element ? record.target.className : ""
            }; `
          ).join("")
        }`;
      }).observe(wall, { attributes: true, subtree: true });
    });

    const finger = await context.newCDPSession(page);
    const y = phone.height / 2;
    await finger.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 60, y }],
    });
    for (let x = 80; x <= 320; x += 40) {
      await finger.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
    }
    await finger.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await motionSettled(page);

    const seen = await page.evaluate(() => ({
      moves: Number(document.documentElement.dataset.testTouchMoves),
      writes: document.documentElement.dataset.testWallWrites ?? "",
    }));
    assert(seen.moves > 0, "the page was told the finger moved");
    assertEquals(seen.writes, "", "a finger's travel rewrote the wall");
    assertEquals(await page.locator(SHEET).count(), 0, "a drag opens no card");
    assertEquals(faults, []);
  });
});

Deno.test("the tuning panel appears only on request and edits the wall root in place", async () => {
  const knob = WALL_KNOBS.find((each) => each.name === "gap");
  assert(knob !== undefined, "the wall has a gap knob");
  const drift = WALL_KNOBS.find((each) => each.name === "drift");
  assert(drift !== undefined, "the wall has a drift knob");
  assertEquals(drift.default, 0, "nothing drifts unless the knob is turned");
  const property = wallKnobProperty(knob.name);
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "no-preference",
    });
    const { page, faults } = await openPage(context);
    await page.goto(`${ORIGIN}/?tune`);
    await page.locator(LIVE_WALL).waitFor();
    await page.locator(".wall-tune").waitFor();
    const written = (): Promise<string> =>
      page.locator(".wall").evaluate(
        (wall, name) =>
          wall instanceof HTMLElement ? wall.style.getPropertyValue(name) : "",
        property,
      );
    const control = (label: string): Locator =>
      page.locator(".wall-tune-row").filter({ hasText: label }).locator(
        "input",
      );
    assertEquals(await written(), `${knob.default}${knob.unit}`);

    await control(knob.label).focus();
    await page.keyboard.press("End");
    assertEquals(await written(), `${knob.max}${knob.unit}`);

    // Drift is the one thing that moves by itself, and only in the far view.
    // The pause control exists exactly while it runs, and stops it.
    const pause = page.locator(".wall-pause");
    const driftState = (): Promise<string> =>
      page.locator(".wall-stage").evaluate((stage) => {
        const style = getComputedStyle(stage);
        return `${style.animationName} ${style.animationPlayState}`;
      });
    assertEquals(
      await pause.count(),
      0,
      "no pause control with nothing moving",
    );
    assertEquals(await driftState(), "none running");
    await control(drift.label).focus();
    await page.keyboard.press("End");
    await pause.waitFor({ state: "visible" });
    assertEquals(await driftState(), "wall-drift running");
    await pause.click();
    assertEquals(await pause.getAttribute("aria-pressed"), "true");
    await page.locator(".wall[data-wall-paused]").waitFor();
    assertEquals(await driftState(), "wall-drift paused");
    await pause.click();
    assertEquals(await driftState(), "wall-drift running");
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    assertEquals(await driftState(), "none running", "a near plane is still");
    assertEquals(await pause.isVisible(), false, "nothing to pause when near");
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator(FAR_WALL).waitFor();

    await page.locator(".wall-tune-actions button", { hasText: "Reset" })
      .click();
    assertEquals(await written(), `${knob.default}${knob.unit}`);
    assertEquals(await pause.count(), 0, "reset leaves nothing moving");
    assertEquals(faults, []);
  });
});
