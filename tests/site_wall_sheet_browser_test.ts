/**
 * Real-browser checks of the opened card against the production handler, at
 * phone and laptop sizes: the sheet a card opens as, and everything a visitor
 * can do to it. Every way out leaves the page exactly as it was. The card's
 * mark crosses to the sheet as an object of its own. Hurried, modified, and
 * overlapping input leaves one whole sheet or none, and a double click is
 * one act wherever its second click lands. A pointer's press on a wall the
 * keyboard has laid flat lands. A window resized as the sheet opens is no
 * fault, and a browser that refuses a transition still gets the change.
 * Paper gets the wall, a finger gets full-sized controls, and a sheet too
 * tall for its screen keeps its close control in reach. Modal dialogs,
 * focus, view transitions, and print need a real browser to judge.
 */
import { assert, assertEquals, fail } from "@std/assert";
import type { Page } from "playwright-core";
import { cardGlyph, cardNumeral } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { lensRecedes } from "../site/wall/Lens.tsx";
import type { WallCard, WallLens } from "../site/wall/types.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import {
  atEachViewport,
  countSheets,
  dropFocus,
  eventually,
  FAR_WALL,
  markedCards,
  motionSettled,
  NEAR_WALL,
  OPEN_SHEET,
  openerOf,
  openLiveWall,
  OUTSIDE_Y,
  parkPointer,
  planeTransform,
  type Press,
  pressableCard,
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

/**
 * Hold the page to where it stands for a moment. A smooth scroll that has
 * been started shows within its first frames, so this is long enough to
 * catch one and short enough to ask often.
 */
async function assertHoldsStill(page: Page, message: string): Promise<void> {
  const at = await scrolled(page);
  await page.waitForTimeout(200);
  assertEquals(await scrolled(page), at, message);
}

interface WayOut {
  readonly name: string;
  readonly leave: (page: Page, size: Viewport) => Promise<void>;
}

/**
 * Every way a visitor leaves the sheet. Each is taken the moment the sheet
 * exists, while it is still arriving. The one exception is the pointer on the
 * close control, which has to see the control before it can press it.
 */
const WAYS_OUT: readonly WayOut[] = [
  { name: "Escape", leave: (page) => page.keyboard.press("Escape") },
  {
    name: "Enter on the close control",
    leave: (page) => page.keyboard.press("Enter"),
  },
  {
    name: "a click on the close control",
    leave: (page) => page.locator(`${OPEN_SHEET} .wall-open-close`).click(),
  },
  {
    name: "a click outside the sheet",
    leave: (page, size) => page.mouse.click(size.width / 2, OUTSIDE_Y),
  },
];

/**
 * Open a card by pointer, leave by every way out in turn, and hold the page
 * to what it was each time: the same scroll, the same plane, every card where
 * it was drawn, none marked, and focus back on the card. While the sheet is
 * open the card that became it is the one card held, which happens only where
 * the card lay flat to begin with. In the far view the plane is compared
 * once the returned focus has been let go.
 */
async function assertEveryWayOut(
  page: Page,
  size: Viewport,
  press: Press,
  held: boolean,
): Promise<void> {
  for (const way of WAYS_OUT) {
    const where = `${size.name}, ${
      held ? "near" : "far"
    }, leaving by ${way.name}`;
    const before = await wallAtRest(page, size);
    await page.mouse.click(press.x, press.y);
    await page.locator(OPEN_SHEET).waitFor();
    assertEquals(
      await markedCards(page),
      held ? [`${press.id}:held`] : [],
      `${where}: the card that became the sheet`,
    );
    const sheet = await page.locator(OPEN_SHEET).boundingBox();
    assert(sheet !== null, "the sheet has a box");
    assert(
      Math.abs(sheet.x + sheet.width / 2 - size.width / 2) <= 1 &&
        sheet.y > OUTSIDE_Y,
      `${where}: the sheet sits centered, clear of the top edge`,
    );

    // The pointer leaves the card's place first. Left there it would light
    // the card again as the sheet goes, and that light would then have to
    // fade before the page could be compared.
    await parkPointer(page, size);
    await way.leave(page, size);
    await sheetGone(page, where);
    assert(
      await page.locator(openerOf(press.id)).evaluate((button) =>
        button === document.activeElement
      ),
      `${where}: focus returns to the card that was opened`,
    );
    assertEquals(
      await scrolled(page),
      before.scrollY,
      `${where}: the page scrolled`,
    );
    // A far card that gets its focus back from a key holds the keyboard's
    // focus, and the wall lies flat under that. The far view is what it was
    // once the focus has gone.
    if (!held) await dropFocus(page);
    assertEquals(
      await wallAtRest(page, size),
      before,
      `${where}: the page is not where it was`,
    );
  }
}

/**
 * Runs in the page: hand an element focus as a script does, afresh, and
 * without the browser scrolling to it.
 */
function takeFocus(element: Element): void {
  if (!(element instanceof HTMLElement)) return;
  element.blur();
  element.focus({ preventScroll: true });
}

/**
 * In the far view focus reaches a card in ways that are not a step of the
 * keyboard: a script hands it over, or a closing sheet hands it back. None of
 * them scrolls the page. Where the focus is drawn as the keyboard's, the wall
 * lies flat under it, and the far view returns when that focus goes.
 */
async function assertHandedFocusScrollsNothing(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  const opener = page.locator(openerOf(press.id));
  const before = await wallAtRest(page, size);
  assertEquals(before.near, false, "the far view is where this is checked");

  await opener.evaluate(takeFocus);
  await page.keyboard.press("Enter");
  await page.locator(OPEN_SHEET).waitFor();
  await page.keyboard.press("Escape");
  await sheetGone(page, "far, opened by keyboard");
  await opener.evaluate(takeFocus);
  assert(
    await opener.evaluate((button) => button.matches(":focus-visible")),
    "the far card holds the keyboard's focus, drawn as such",
  );
  await assertHoldsStill(page, "focus handed to a far card scrolled the page");
  assertEquals(await scrolled(page), before.scrollY, "the page scrolled");
  await page.locator(NEAR_WALL).waitFor();
  assertEquals(
    await planeTransform(page),
    "none",
    "the wall lies flat under the keyboard's focus",
  );
  await dropFocus(page);
  assertEquals(
    await wallAtRest(page, size),
    before,
    "the far view did not return when the focus went",
  );
}

/** The second click of a double click, where the pointer already is. */
async function clickAgain(page: Page): Promise<void> {
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  // Long enough for whatever the click asked for to have begun.
  await page.waitForTimeout(250);
  await motionSettled(page);
}

/**
 * A double click is one act. On a card it opens the card once and leaves it
 * open, though its second click lands outside the sheet while the sheet is
 * still arriving. Outside the open sheet it closes the sheet and stops there,
 * though its second click lands on the card that lies under it.
 */
async function assertDoubleClickOpensOnce(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  await countSheets(page);
  await page.mouse.click(press.x, press.y);
  await page.locator(OPEN_SHEET).waitFor();
  const sheet = await page.locator(OPEN_SHEET).boundingBox();
  assert(
    sheet !== null && (press.x < sheet.x || press.y < sheet.y),
    `${size.name}: the pressed card lies outside the sheet's resting place`,
  );
  await clickAgain(page);
  assertEquals(
    [await sheetsMounted(page), await markedCards(page)],
    [1, [`${press.id}:held`]],
    `${size.name}: a double click opens the card once and leaves it open`,
  );
  await page.mouse.click(press.x, press.y);
  await page.locator(SHEET).waitFor({ state: "detached" });
  await clickAgain(page);
  assertEquals(
    [await sheetsMounted(page), await page.locator(SHEET).count()],
    [1, 0],
    `${size.name}: a double click that dismisses the sheet opens no card`,
  );
  await sheetGone(page, `${size.name}, after a double click`);
}

/**
 * While the sheet is on its way out the page is the visitor's again. A press
 * made then, with the sheet still returning to its card, reaches the card it
 * was aimed at, and that card opens and takes the focus.
 */
async function assertPressWhileLeavingLands(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  const next = await pressableCard(page, size, "bottom");
  const card = WALL_DECK.find((each) => each.id === next.id);
  assert(card !== undefined && next.id !== press.id, "a second card to press");
  await page.mouse.click(press.x, press.y);
  await page.locator(OPEN_SHEET).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(SHEET).waitFor({ state: "detached" });
  await page.mouse.click(next.x, next.y);
  await page.getByRole("dialog", { name: sheetName(card), exact: true })
    .waitFor();
  assertEquals(
    await markedCards(page),
    [`${next.id}:held`],
    `${size.name}: a press while the sheet leaves opens the card under it`,
  );
  await page.keyboard.press("Escape");
  await sheetGone(page, `${size.name}, after a press while leaving`);
  assert(
    await page.locator(openerOf(next.id)).evaluate((button) =>
      button === document.activeElement
    ),
    `${size.name}: focus returns to the card the press opened`,
  );
}

/** Whether the focus is on the open sheet or on something inside it. */
function focusInSheet(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.activeElement?.closest("dialog") instanceof HTMLDialogElement
  );
}

/**
 * Open a card by pointer and hold its arriving sheet where it starts, so a
 * press cannot miss the arrival. Answers with the middle of the place where
 * one of the sheet's parts comes to rest.
 */
async function holdArrivingSheet(
  page: Page,
  press: Press,
  part: string,
  where: string,
): Promise<Point> {
  await page.evaluate(holdNextTransition);
  await page.mouse.click(press.x, press.y);
  await page.waitForFunction(() =>
    document.documentElement.dataset.testHeld !== undefined
  );
  const box = await page.locator(`${OPEN_SHEET} ${part}`).boundingBox();
  assert(box !== null, `${where}: ${part} has a resting place`);
  assert(
    await page.evaluate(transitionParts) > 0,
    `${where}: the sheet is still arriving`,
  );
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The sheet answers a press from the moment it mounts, while it is still
 * arriving. A press on its words ends the arrival and leaves the sheet open
 * with the focus inside it. A press where the close control comes to rest
 * closes the sheet and returns the focus to the card.
 */
async function assertPressOnTheArrivingSheetLands(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  const where = `${size.name}, a press on the arriving sheet`;
  const words = await holdArrivingSheet(
    page,
    press,
    ".wall-open-title",
    where,
  );
  await page.mouse.click(words.x, words.y);
  await page.evaluate(nextFrame);
  assertEquals(
    {
      arriving: await page.evaluate(transitionParts),
      open: await page.locator(OPEN_SHEET).count(),
      focusInSheet: await focusInSheet(page),
    },
    { arriving: 0, open: 1, focusInSheet: true },
    `${where}: a press on its words`,
  );
  await page.keyboard.press("Escape");
  await sheetGone(page, where);

  const close = await holdArrivingSheet(
    page,
    press,
    ".wall-open-close",
    where,
  );
  await page.mouse.click(close.x, close.y);
  await eventually(
    page,
    async () => await page.locator(SHEET).count() === 0,
    `${where}: the close control did not answer`,
  );
  await sheetGone(page, where);
  assert(
    await page.locator(openerOf(press.id)).evaluate((button) =>
      button === document.activeElement
    ),
    `${where}: focus returns to the card that was opened`,
  );
}

/** How many times a held key repeats in the check below. */
const HELD_KEY_REPEATS = 14;

/**
 * A key held down on a card opens the sheet once and leaves it open, however
 * long it repeats: across the open, and on whatever takes focus in the sheet.
 */
async function assertHeldKeyOpensOnce(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  await countSheets(page);
  await page.locator(openerOf(press.id)).focus();
  for (let repeat = 0; repeat < HELD_KEY_REPEATS; repeat++) {
    await page.keyboard.down("Enter");
    await page.waitForTimeout(30);
  }
  await page.keyboard.up("Enter");
  await motionSettled(page);
  assertEquals(
    [await sheetsMounted(page), await page.locator(OPEN_SHEET).count()],
    [1, 1],
    `${size.name}: a held Enter opens the sheet once and leaves it open`,
  );
  await page.keyboard.press("Escape");
  await sheetGone(page, `${size.name}, after a held key`);
}

/**
 * Requests that overlap settle whole. Opens and closes sent faster than any
 * of them can finish end with at most one sheet, modal and open, its card
 * held and no other marked; and once that sheet is closed the page is where
 * it began.
 */
async function assertRequestsSettleWhole(
  page: Page,
  size: Viewport,
  press: Press,
): Promise<void> {
  const where = `${size.name}, overlapping requests`;
  const before = await wallAtRest(page, size);
  for (const request of ["open", "close", "open", "close"] as const) {
    await (request === "open"
      ? page.mouse.click(press.x, press.y)
      : page.keyboard.press("Escape"));
    await page.waitForTimeout(40);
  }
  await eventually(
    page,
    () =>
      page.evaluate(({ sheet, attribute }) => {
        const moving = document.getAnimations().some((animation) =>
          animation.playState === "running" &&
          animation.timeline instanceof DocumentTimeline &&
          animation.effect?.getTiming().iterations !== Infinity
        );
        const sheets = document.querySelectorAll(sheet).length;
        const marks = [...document.querySelectorAll(`[${attribute}]`)].map((
          card,
        ) => card.getAttribute(attribute));
        return !moving && sheets <= 1 &&
          sheets === document.querySelectorAll(`${sheet}[open]:modal`).length &&
          marks.length <= sheets && marks.every((mark) => mark === "held");
      }, { sheet: SHEET, attribute: OPENING_ATTRIBUTE }),
    `${where}: the page is left between states`,
  );
  await page.keyboard.press("Escape");
  await sheetGone(page, where);
  assertEquals(
    await wallAtRest(page, size),
    before,
    `${where}: the page is not where it was`,
  );
}

Deno.test("a card opens as a sheet, and every way out leaves the page exactly as it was", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);

    // Far: a tilted card opens where the sheet stands, with no card held,
    // and closing it never scrolls the page.
    if (size.name === "laptop") {
      await page.locator(FAR_WALL).waitFor();
      const far = await pressableCard(page, size, "bottom");
      await assertEveryWayOut(page, size, far, false);
      await assertHandedFocusScrollsNothing(page, size, far);
    }

    // Near: the card grows into the sheet and the sheet returns to it.
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const near = await pressableCard(page, size, "top");
    await assertEveryWayOut(page, size, near, true);
    assertEquals(faults, [], size.name);
  });
});

/**
 * Runs in the page: from now on, stop every part of a view transition where
 * it starts, and say on the root once one is held. A held transition lasts
 * until something ends it.
 */
function holdNextTransition(): void {
  const root = document.documentElement;
  delete root.dataset.testHeld;
  const look = (): void => {
    const parts = document.getAnimations().filter((animation) =>
      animation.effect instanceof KeyframeEffect &&
      animation.effect.pseudoElement?.startsWith("::view-transition") === true
    );
    if (parts.length === 0) {
      requestAnimationFrame(look);
      return;
    }
    for (const part of parts) part.pause();
    root.dataset.testHeld = "";
  };
  requestAnimationFrame(look);
}

/** Runs in the page: how many parts of a view transition are running or held. */
function transitionParts(): number {
  return document.getAnimations().filter((animation) =>
    animation.effect instanceof KeyframeEffect &&
    animation.effect.pseudoElement?.startsWith("::view-transition") === true
  ).length;
}

/** Runs in the page: resolve once the browser has drawn its next frame. */
function nextFrame(): Promise<void> {
  return new Promise((drawn) => requestAnimationFrame(() => drawn()));
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The presses that are not a plain click: each asks the browser for
 * something of its own, such as a link opened in a new tab.
 */
const OTHER_PRESSES: readonly {
  readonly name: string;
  readonly press: (page: Page, at: Point) => Promise<void>;
}[] = [
  {
    name: "a click with a modifier key held",
    press: async (page, at) => {
      await page.keyboard.down("Meta");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.up("Meta");
    },
  },
  {
    name: "a click of the middle button",
    press: (page, at) => page.mouse.click(at.x, at.y, { button: "middle" }),
  },
];

/** Runs in the page: how many clicks have reached the element `countClicks` watches. */
function clicksCounted(): number {
  return Number(document.documentElement.dataset.testClicks ?? 0);
}

/**
 * Runs in the page: count every click that reaches this element, and keep
 * each from doing anything, so a link that is clicked is counted and not
 * followed.
 */
function countClicks(element: Element): void {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    const root = document.documentElement;
    root.dataset.testClicks = String(Number(root.dataset.testClicks ?? 0) + 1);
  });
}

/**
 * A press made while the sheet leaves is handed on only when it is a plain
 * click. Any other press ends the sheet's leaving, so the page answers for
 * itself again, and goes nowhere: it reaches no link and opens no card.
 * This is checked at the foot of the wall, where a card to open and a link
 * to press share the view, with the leaving sheet held so that the press
 * cannot miss it.
 */
async function assertOnlyAPlainPressIsHandedOn(
  page: Page,
  size: Viewport,
): Promise<void> {
  const link = page.locator(".wall-closing .wall-cta");
  await link.evaluate((cta) =>
    cta.scrollIntoView({ block: "end", behavior: "instant" })
  );
  await page.locator(NEAR_WALL).waitFor();
  const press = await pressableCard(page, size, "top");
  const box = await link.boundingBox();
  assert(box !== null, `${size.name}: the closing link has a box`);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await link.evaluate(countClicks);
  await countSheets(page);
  for (const other of OTHER_PRESSES) {
    const where = `${size.name}, ${other.name} while the sheet leaves`;
    await page.mouse.click(press.x, press.y);
    await page.locator(OPEN_SHEET).waitFor();
    await motionSettled(page);
    await parkPointer(page, size);
    await page.evaluate(holdNextTransition);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.documentElement.dataset.testHeld !== undefined
    );
    await other.press(page, at);
    await page.evaluate(nextFrame);
    assertEquals(
      {
        leaving: await page.evaluate(transitionParts),
        handedOn: await page.evaluate(clicksCounted),
      },
      { leaving: 0, handedOn: 0 },
      `${where}: the press ends the sheet's leaving and is handed to nothing`,
    );
    await sheetGone(page, where);
  }
  assertEquals(
    await sheetsMounted(page),
    OTHER_PRESSES.length,
    `${size.name}: a press that is not a plain click opens no card`,
  );
  await page.mouse.click(at.x, at.y);
  assertEquals(
    await page.evaluate(clicksCounted),
    1,
    `${size.name}: the page answers a plain click for itself again`,
  );
}

Deno.test("a double click, a press on the arriving sheet, a held key, a press that is not a plain click, and requests that overlap each leave one whole sheet or none", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const press = await pressableCard(page, size, "top");
    await assertDoubleClickOpensOnce(page, size, press);
    await assertPressWhileLeavingLands(page, size, press);
    await assertPressOnTheArrivingSheetLands(page, size, press);
    await assertHeldKeyOpensOnce(page, size, press);
    await assertRequestsSettleWhole(page, size, press);
    await assertOnlyAPlainPressIsHandedOn(page, size);
    assertEquals(faults, [], size.name);
  });
});

/**
 * Press and release at a point as a hand does, with the button down across
 * two drawn frames. Whatever a press sets moving has moved by the time the
 * button comes up, so the click lands only on a page that held still.
 */
async function pressAsAHand(page: Page, at: Point): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.evaluate(nextFrame);
  await page.evaluate(nextFrame);
  await page.mouse.up();
}

/** Press a lens's chip as a hand does, and require the chip to be pressed. */
async function assertChipPressLands(
  page: Page,
  lens: WallLens,
  where: string,
): Promise<void> {
  const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
  const box = await chip.boundingBox();
  assert(box !== null, `${where}: the chip has a box`);
  await pressAsAHand(page, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  await eventually(
    page,
    async () => await chip.getAttribute("aria-pressed") === "true",
    `${where}: the press did not reach the chip`,
  );
  await motionSettled(page);
}

/** Require the wall to be marked near, with no transform on its plane. */
async function assertLiesFlat(page: Page, where: string): Promise<void> {
  assertEquals(
    [await page.locator(NEAR_WALL).count(), await planeTransform(page)],
    [1, "none"],
    `${where}: the wall lies flat`,
  );
}

/**
 * A far card opened by pointer and closed with Escape gets its focus back as
 * the keyboard's, and the wall lies flat under it. A pointer's press on
 * another card takes the focus without the keyboard's mark. The wall holds
 * still under that press, so the press opens the card it was aimed at, and
 * the far view returns only when the focus leaves the stage.
 */
async function assertCardPressLandsOnAFlatWall(
  page: Page,
  size: Viewport,
): Promise<void> {
  const far = await pressableCard(page, size, "bottom");
  await page.mouse.click(far.x, far.y);
  await page.locator(OPEN_SHEET).waitFor();
  await page.keyboard.press("Escape");
  await sheetGone(page, "far, closed with Escape");
  await page.locator(NEAR_WALL).waitFor();
  await motionSettled(page);

  const next = await pressableCard(page, size, "bottom", far.id);
  const card = WALL_DECK.find((each) => each.id === next.id);
  assert(card !== undefined, "a second card lies under the pointer");
  await pressAsAHand(page, next);
  const sheet = page.getByRole("dialog", {
    name: sheetName(card),
    exact: true,
  });
  await eventually(
    page,
    async () => await sheet.count() === 1,
    `a press on the flat wall did not open ${next.id}, the card under it`,
  );
  await page.keyboard.press("Escape");
  await sheetGone(page, "flat for the keyboard, opened by pointer");
  await assertLiesFlat(page, "with the focus back on the pressed card");
  await dropFocus(page);
  await page.locator(FAR_WALL).waitFor();
}

/**
 * Tab from the pool reaches the lens bar. At the top of the page the wall is
 * far until that focus lays it flat and shows the bar.
 */
async function tabIntoTheBar(page: Page): Promise<void> {
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.locator(".wall-pool .wall-cta").focus();
  await page.locator(FAR_WALL).waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(() =>
      document.activeElement?.matches(".wall-chip:focus-visible") === true
    ),
    "Tab reaches the lens bar",
  );
  await page.locator(NEAR_WALL).waitFor();
}

/** Whether the lens bar takes a press where the page stands. */
function barTakesAPress(page: Page): Promise<boolean> {
  return page.locator(".wall-lens").evaluate((lens) =>
    getComputedStyle(lens).pointerEvents !== "none"
  );
}

/**
 * At the foot of the page the lens bar has gone, and the keyboard's focus
 * inside it shows it whole. A pointer's press on a chip there takes that
 * focus, and the bar stays under the press.
 */
async function assertChipPressLandsAtTheFoot(
  page: Page,
  lens: WallLens,
): Promise<void> {
  const toTheFoot = (): Promise<void> =>
    page.evaluate(() =>
      scrollTo({ top: document.body.scrollHeight, behavior: "instant" })
    );
  await dropFocus(page);
  await toTheFoot();
  await eventually(
    page,
    async () => !(await barTakesAPress(page)),
    "at the foot of the page the lens bar takes no press",
  );
  await page.locator(".wall-card-open").first().focus();
  await page.keyboard.press("Shift+Tab");
  await toTheFoot();
  await eventually(
    page,
    () => barTakesAPress(page),
    "the keyboard's focus shows the lens bar whole at the foot of the page",
  );
  await assertChipPressLands(page, lens, "at the foot of the page");
}

/**
 * Runs in the page: from now on a press gives nothing the focus and takes it
 * from whatever held it. Some browsers treat a pressed button so.
 */
function pressesTakeTheFocusAway(): void {
  document.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, { capture: true });
}

Deno.test("a pointer's press on a wall the keyboard has laid flat finds the wall still under it, and lands", async () => {
  const [, laptop] = VIEWPORTS;
  const [first, second, third] = WALL_LENSES;
  assert(
    first !== undefined && second !== undefined && third !== undefined,
    "the wall has three lenses",
  );
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      reducedMotion: "no-preference",
    });
    const { page, faults } = await openLiveWall(context);
    await page.locator(FAR_WALL).waitFor();
    await assertCardPressLandsOnAFlatWall(page, laptop);

    await tabIntoTheBar(page);
    await assertChipPressLands(page, first, "after Tab to the bar");
    await assertLiesFlat(page, "with the focus on the pressed chip");

    await assertChipPressLandsAtTheFoot(page, second);

    // A browser that gives a pressed button no focus leaves the focus
    // nowhere as the press lands. The stage is still the visitor's.
    await tabIntoTheBar(page);
    await page.evaluate(pressesTakeTheFocusAway);
    await assertChipPressLands(page, third, "with the focus taken away");
    assert(
      await page.evaluate(() => document.activeElement === document.body),
      "the press left the focus nowhere, which is what this case is about",
    );
    await assertLiesFlat(page, "after a press that took the focus away");
    assertEquals(faults, []);
  });
});

/** A box of the viewport, as a locator measures one. */
interface Box extends Point {
  readonly width: number;
  readonly height: number;
}

/**
 * Open a card by keyboard, read where one of its sheet's controls comes to
 * rest, and close the card again.
 */
async function restingPlace(
  page: Page,
  id: string,
  control: string,
): Promise<Box> {
  await page.locator(openerOf(id)).focus();
  await page.keyboard.press("Enter");
  await page.locator(OPEN_SHEET).waitFor();
  const box = await page.locator(`${OPEN_SHEET} ${control}`).boundingBox();
  assert(box !== null, `${id}: its sheet shows ${control}`);
  await page.keyboard.press("Escape");
  await sheetGone(page, `${id}, measured`);
  await motionSettled(page);
  return box;
}

/**
 * Runs in the page: the cards, in the list's order, that a span of the
 * viewport's width crosses.
 */
function cardsAcross(span: { left: number; right: number }): string[] {
  return [...document.querySelectorAll<HTMLElement>(".wall-card")]
    .filter((card) => {
      const box = card.getBoundingClientRect();
      return Math.min(box.right, span.right) - Math.max(box.left, span.left) >
        8;
    }).map((card) => card.dataset.card ?? "");
}

/**
 * Runs in the page: scroll until this card lies under the middle of a box of
 * the viewport, and name a point the two share. Null where they share none:
 * the card is in another column, or the page cannot scroll that far.
 */
function bringUnder(card: Element, box: Box): Point | null {
  const middle = box.y + box.height / 2;
  const before = card.getBoundingClientRect();
  scrollBy({
    top: before.top + before.height / 2 - middle,
    behavior: "instant",
  });
  const now = card.getBoundingClientRect();
  const left = Math.max(now.left, box.x);
  const right = Math.min(now.right, box.x + box.width);
  const at = { x: (left + right) / 2, y: middle };
  const under = document.elementFromPoint(at.x, at.y)?.closest(".wall-card");
  return right - left > 8 && under === card ? at : null;
}

/**
 * Bring a card under the place where one of its own sheet's controls comes
 * to rest, and name the point to press: a press there lands on the card, and
 * a second one lands on that control once the sheet is open.
 */
async function cardUnderItsOwn(
  page: Page,
  control: string,
  cards: readonly WallCard[],
): Promise<Press> {
  const [any] = cards;
  assert(any !== undefined, `a card's sheet shows ${control}`);
  const rough = await restingPlace(page, any.id, control);
  const across = await page.evaluate(cardsAcross, {
    left: rough.x,
    right: rough.x + rough.width,
  });
  for (const id of across) {
    if (!cards.some((card) => card.id === id)) continue;
    const box = await restingPlace(page, id, control);
    const at = await page.locator(`.wall-card[data-card="${id}"]`).evaluate(
      bringUnder,
      box,
    );
    if (at !== null) return { id, ...at };
  }
  return fail(`no card can lie under its own sheet's ${control}`);
}

/** The second press of a double click, where the pointer already is. */
async function pressAgain(page: Page): Promise<void> {
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.evaluate(nextFrame);
  await motionSettled(page);
}

/**
 * A double click on a card is one act wherever its second click lands, and
 * here it lands on one of the opened sheet's own controls. The sheet opens
 * once and stays open, nothing on the page hears the second click, and the
 * focus stays in the sheet. A double click on the resting sheet's close
 * control then closes it once: the card that lies under the control stays
 * shut, and keeps the focus the sheet handed back.
 */
async function assertDoubleClickStopsAtTheSheet(
  page: Page,
  control: string,
  where: string,
): Promise<void> {
  const press = await cardUnderItsOwn(
    page,
    control,
    WALL_DECK.filter((card) => card.href !== undefined),
  );
  await countSheets(page);
  const heard = await page.evaluate(clicksCounted);
  await page.mouse.click(press.x, press.y);
  await page.locator(OPEN_SHEET).waitFor();
  await pressAgain(page);
  assertEquals(
    {
      heard: await page.evaluate(clicksCounted) - heard,
      sheets: await sheetsMounted(page),
      open: await page.locator(OPEN_SHEET).count(),
      focusInSheet: await focusInSheet(page),
    },
    { heard: 1, sheets: 1, open: 1, focusInSheet: true },
    `${where}: a double click on ${press.id} that ends on its sheet's ${control}`,
  );
  const close = await page.locator(`${OPEN_SHEET} .wall-open-close`)
    .boundingBox();
  assert(close !== null, `${where}: the sheet shows its close control`);
  await page.mouse.click(
    close.x + close.width / 2,
    close.y + close.height / 2,
  );
  await page.locator(SHEET).waitFor({ state: "detached" });
  await pressAgain(page);
  assertEquals(
    {
      heard: await page.evaluate(clicksCounted) - heard,
      sheets: await sheetsMounted(page),
      focusOnCard: await page.locator(openerOf(press.id)).evaluate((button) =>
        button === document.activeElement
      ),
    },
    { heard: 2, sheets: 1, focusOnCard: true },
    `${where}: a double click on the close control of ${press.id}'s sheet`,
  );
  await sheetGone(page, where);
}

/** A double click on a lens's chip chooses the lens, and does not let it go. */
async function assertDoubleClickChoosesOnce(
  page: Page,
  lens: WallLens,
  where: string,
): Promise<void> {
  await scrollToWall(page);
  const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
  await chip.dblclick();
  await motionSettled(page);
  assertEquals(
    await chip.getAttribute("aria-pressed"),
    "true",
    `${where}: a double click on a chip chooses its lens once`,
  );
}

Deno.test("a double click is one act with motion and without it, wherever its second click lands", async () => {
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  const visitors = [
    { javaScriptEnabled: true, reducedMotion: true },
    { javaScriptEnabled: true },
  ] as const;
  for (const visitor of visitors) {
    await atEachViewport(visitor, async (context, size) => {
      const where = `${size.name}, ${
        "reducedMotion" in visitor ? "reduced motion" : "motion"
      }`;
      const { page, faults } = await openLiveWall(context);
      await page.locator("html").evaluate(countClicks);
      await scrollToWall(page);
      await page.locator(NEAR_WALL).waitFor();
      for (const control of [".wall-open-link", ".wall-open-close"]) {
        await assertDoubleClickStopsAtTheSheet(page, control, where);
      }
      await assertDoubleClickChoosesOnce(page, lens, where);
      assertEquals(faults, [], where);
    });
  }
});

/**
 * Run `check` on a laptop's wall with motion welcome, scrolled until the wall
 * is near, with a card high in the viewport to press.
 */
async function onANearLaptopWall(
  check: (page: Page, press: Press, faults: string[]) => Promise<void>,
): Promise<void> {
  const [, laptop] = VIEWPORTS;
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      reducedMotion: "no-preference",
    });
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    await check(page, await pressableCard(page, laptop, "top"), faults);
  });
}

/** What the browser says when it refuses a transition in the check below. */
const REFUSAL = "no view transition now";

/**
 * Runs in the page: have the browser refuse the next view transition it is
 * asked to begin, by throwing. The page's own `startViewTransition` is back
 * once it has refused.
 */
function refuseNextTransition(refusal: string): void {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: () => {
      Reflect.deleteProperty(document, "startViewTransition");
      throw new DOMException(refusal, "InvalidStateError");
    },
  });
}

/** Whether the refusal `refuseNextTransition` set up has been given. */
function refusalGiven(page: Page): Promise<boolean> {
  return page.evaluate(() => !Object.hasOwn(document, "startViewTransition"));
}

Deno.test("a browser that refuses to begin a view transition still gets the card open and the lens chosen, as a cut", async () => {
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  await onANearLaptopWall(async (page, press, faults) => {
    await page.evaluate(refuseNextTransition, REFUSAL);
    await page.mouse.click(press.x, press.y);
    await eventually(
      page,
      async () => await page.locator(OPEN_SHEET).count() === 1,
      "a refused transition left the card unopened",
    );
    assertEquals(
      [await refusalGiven(page), await markedCards(page)],
      [true, []],
      "the card opens as a cut, with no card marked for a morph",
    );
    await page.keyboard.press("Escape");
    await sheetGone(page, "after a refused opening");

    const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
    await page.evaluate(refuseNextTransition, REFUSAL);
    await chip.click();
    await eventually(
      page,
      async () => await chip.getAttribute("aria-pressed") === "true",
      "a refused transition left the lens unchosen",
    );
    assert(await refusalGiven(page), "the lens asked for a transition");
    assertEquals(
      faults,
      [`page error: ${REFUSAL}`, `page error: ${REFUSAL}`],
      "each refusal is reported once, and nothing else is a fault",
    );
  });
});

/** The names the sheet and a card's mark go by in a view transition. */
const SHEET_NAME = "wall-open";
const MARK_NAME = "wall-open-mark";

/** Whether any of a view transition's parts belongs to the object with this name. */
function carries(parts: readonly string[], name: string): boolean {
  return parts.some((part) => part.endsWith(`(${name})`));
}

/**
 * Every part of the page, other than the page itself, that a view
 * transition animates while `act` runs. The page is first left to settle, so
 * that a transition still on its way out is not taken for the one `act`
 * starts.
 */
async function partsDuring(
  page: Page,
  act: () => Promise<void>,
): Promise<string[]> {
  await motionSettled(page);
  const seen = page.evaluate(watchTransition);
  await act();
  return (await seen).filter((part) => !part.endsWith("(root)"));
}

/** Whether a card leads with a mark: a glyph, or a numeral. */
function hasMark(card: WallCard): boolean {
  return cardGlyph(card) !== undefined || cardNumeral(card) !== undefined;
}

/**
 * Open the card with this id by pointer and close it again, well down the
 * flat wall, and name the parts that each change animates.
 */
async function openAndClose(
  page: Page,
  id: string,
): Promise<{ readonly opening: string[]; readonly closing: string[] }> {
  const card = page.locator(`.wall-card[data-card="${id}"]`);
  await card.evaluate((item) =>
    item.scrollIntoView({ block: "center", behavior: "instant" })
  );
  await page.locator(NEAR_WALL).waitFor();
  const box = await card.boundingBox();
  assert(box !== null, `${id} has a box`);
  const opening = await partsDuring(page, async () => {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator(OPEN_SHEET).waitFor();
  });
  assertEquals(await markedCards(page), [`${id}:held`], `${id} grows open`);
  const closing = await partsDuring(page, async () => {
    await page.keyboard.press("Escape");
    await sheetGone(page, id);
  });
  return { opening, closing };
}

Deno.test("a card's mark crosses to the sheet and back as an object of its own, wherever the card itself does", async () => {
  const [lens] = WALL_LENSES;
  assert(lens !== undefined, "the wall has a lens");
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);

    // Far: the sheet arrives where it stands, and its mark stays in its
    // own picture.
    if (size.name === "laptop") {
      await page.locator(FAR_WALL).waitFor();
      const far = await pressableCard(page, size, "bottom");
      const arriving = await partsDuring(page, async () => {
        await page.mouse.click(far.x, far.y);
        await page.locator(OPEN_SHEET).waitFor();
      });
      assertEquals(
        [carries(arriving, SHEET_NAME), carries(arriving, MARK_NAME)],
        [true, false],
        "laptop, far: the sheet arrives whole",
      );
      await page.keyboard.press("Escape");
      await sheetGone(page, "laptop, far");
      await dropFocus(page);
    }

    // Near: a card with a glyph or a numeral hands it across both ways, and
    // a card with neither has nothing to hand.
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const kinds = new Set(WALL_DECK.map((card) => card.kind));
    for (const kind of kinds) {
      const card = WALL_DECK.findLast((each) => each.kind === kind);
      assert(card !== undefined, `the deck holds a ${kind} card`);
      const { opening, closing } = await openAndClose(page, card.id);
      for (const [way, parts] of Object.entries({ opening, closing })) {
        assertEquals(
          [carries(parts, SHEET_NAME), carries(parts, MARK_NAME)],
          [true, hasMark(card)],
          `${size.name}, ${way} a ${kind} card: the mark's own crossing`,
        );
      }
    }
    assert(
      [...kinds].some((kind) =>
        WALL_DECK.some((card) => card.kind === kind && hasMark(card))
      ) && WALL_DECK.some((card) => !hasMark(card)),
      "the deck holds cards with a mark and cards without",
    );

    // A receded card keeps its mark in its own picture, where the mark
    // stays as dim as the card.
    const receded = WALL_DECK.findLast((card) =>
      lensRecedes(lens, card) && hasMark(card)
    );
    assert(receded !== undefined, `${lens.id} sets a marked card aside`);
    const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
    await scrollToWall(page);
    await chip.click();
    await chip.and(page.locator("[aria-pressed='true']")).waitFor();
    await motionSettled(page);
    const { opening, closing } = await openAndClose(page, receded.id);
    assertEquals(
      [
        carries(opening, SHEET_NAME),
        carries(closing, SHEET_NAME),
        carries([...opening, ...closing], MARK_NAME),
      ],
      [true, true, false],
      `${size.name}: a receded card grows open with its mark in its own picture`,
    );
    assertEquals(faults, [], size.name);
  });
});

/**
 * Runs in the page before its own scripts: let a test hold a view transition
 * between the page's change and the transition's first frame. While the root
 * carries `data-test-hold`, a transition whose change has been made waits
 * there, says so on the root, and goes on when the page hears `test-release`.
 * A browser draws no frame for a page whose transition waits like this.
 */
function holdTransitionsAtTheChange(): void {
  const start = Document.prototype.startViewTransition;
  if (typeof start !== "function") return;
  Document.prototype.startViewTransition = new Proxy(start, {
    apply(target, page, args): unknown {
      const [change] = args;
      const held = async (): Promise<void> => {
        if (typeof change === "function") await change();
        const root = document.documentElement;
        if (root.dataset.testHold === undefined) return;
        root.dataset.testHolding = "";
        await new Promise((release) =>
          document.addEventListener("test-release", release, { once: true })
        );
        delete root.dataset.testHolding;
      };
      return Reflect.apply(target, page, [held]);
    },
  });
}

Deno.test("a window resized as a card opens is no fault, and the page settles whole", async () => {
  const [, laptop] = VIEWPORTS;
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: laptop.width, height: laptop.height },
      reducedMotion: "no-preference",
    });
    await context.addInitScript(holdTransitionsAtTheChange);
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const press = await pressableCard(page, laptop, "top");

    // The window changes size after the page has changed and before the
    // transition's first frame, which is when a browser ends a transition
    // for it. No frame is drawn while the transition waits, so the wait
    // for it asks by the clock.
    await page.evaluate(() => {
      document.documentElement.dataset.testHold = "";
    });
    await page.mouse.click(press.x, press.y);
    await page.waitForFunction(
      () => document.documentElement.dataset.testHolding !== undefined,
      undefined,
      { polling: 50 },
    );
    await page.setViewportSize({
      width: laptop.width - 260,
      height: laptop.height - 80,
    });
    await page.evaluate(() => {
      delete document.documentElement.dataset.testHold;
      document.dispatchEvent(new Event("test-release"));
    });
    await page.locator(OPEN_SHEET).waitFor();
    // A transition that went on would be animating by its second frame.
    await page.evaluate(nextFrame);
    await page.evaluate(nextFrame);
    assertEquals(
      await page.evaluate(transitionParts),
      0,
      "the browser ends a transition whose window changed size, which is what this case is about",
    );
    assertEquals(
      await markedCards(page),
      [`${press.id}:held`],
      "the sheet is open and its card held, as if the transition had run",
    );
    assertEquals(
      faults,
      [],
      "a window resized as the sheet opened was reported as a fault",
    );
    await page.keyboard.press("Escape");
    await sheetGone(page, "after a resize");
    assertEquals(faults, []);
  });
});

Deno.test("printing with a card open prints the wall and leaves the sheet off the paper", async () => {
  await onANearLaptopWall(async (page, press, faults) => {
    await page.mouse.click(press.x, press.y);
    await page.locator(OPEN_SHEET).waitFor();
    await motionSettled(page);
    assertEquals(await markedCards(page), [`${press.id}:held`]);

    await page.emulateMedia({ media: "print" });
    const paper = await page.evaluate((sheet) => {
      const dialog = document.querySelector(sheet);
      const root = getComputedStyle(document.documentElement);
      return {
        sheetBoxes: dialog?.getClientRects().length ?? -1,
        backdrop: dialog === null
          ? ""
          : getComputedStyle(dialog, "::backdrop").display,
        pageOverflow: root.overflowY,
        pageShift: root.paddingInlineEnd,
        cardsUnseen: [...document.querySelectorAll<HTMLElement>(".wall-card")]
          .filter((card) =>
            getComputedStyle(card).opacity !== "1" ||
            card.getClientRects().length === 0
          ).map((card) => card.dataset.card ?? ""),
      };
    }, SHEET);
    assertEquals(
      paper,
      {
        sheetBoxes: 0,
        backdrop: "none",
        pageOverflow: "visible",
        pageShift: "0px",
        cardsUnseen: [],
      },
      "on paper: no sheet, no backdrop, the page at full length and width, and every card, the opened one too",
    );

    await page.emulateMedia({ media: "screen" });
    await page.keyboard.press("Escape");
    await sheetGone(page, "after printing");
    assertEquals(faults, []);
  });
});

/** The smallest side a control may have and still be easy for a finger: WCAG 2.5.5. */
const FINGER_TARGET = 44;

Deno.test("on a wide screen that is touched, the sheet's controls are as large as a finger needs", async () => {
  const card = WALL_DECK.findLast((each) => each.href !== undefined);
  assert(card !== undefined, "a card leads into the manual");
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      reducedMotion: "no-preference",
      hasTouch: true,
    });
    const { page, faults } = await openLiveWall(context);
    assertEquals(
      await page.evaluate(() => [
        matchMedia("(pointer: coarse)").matches,
        matchMedia("(max-width: 42rem)").matches,
      ]),
      [true, false],
      "a screen that is touched and is not narrow",
    );
    const opener = page.locator(openerOf(card.id));
    await opener.evaluate((button) =>
      button.scrollIntoView({ block: "center", behavior: "instant" })
    );
    await opener.tap();
    await page.locator(OPEN_SHEET).waitFor();
    const sides = await page.locator(
      `${OPEN_SHEET} :is(.wall-open-close, .wall-open-link)`,
    ).evaluateAll((controls) =>
      controls.map((control) => {
        const box = control.getBoundingClientRect();
        return {
          control: control.className,
          // A link is as wide as its words; its height is what a finger needs.
          least: control.matches("a")
            ? box.height
            : Math.min(box.width, box.height),
        };
      })
    );
    assertEquals(sides.map((side) => side.control), [
      "wall-open-close",
      "wall-open-link",
    ]);
    for (const side of sides) {
      assert(
        side.least >= FINGER_TARGET,
        `.${side.control} is ${side.least}px on a touched screen: a finger needs ${FINGER_TARGET}`,
      );
    }
    await page.locator(`${OPEN_SHEET} .wall-open-close`).tap();
    await sheetGone(page, "touched");
    assertEquals(faults, []);
  });
});

/** Screens too short for a sheet, each of which makes the sheet scroll inside itself. */
const SHORT_ROOMS = [
  { name: "a laptop at 400% zoom", width: 320, height: 256 },
  { name: "a phone at 200% zoom", width: 195, height: 422 },
] as const;

/** The sheet as a reader who has to scroll it finds it. */
interface ScrolledSheet {
  /** The class of whatever holds the focus. */
  readonly focused: string;
  /** How far the sheet's words run past its foot, and past its side. */
  readonly below: number;
  readonly beside: number;
  /** How far the sheet has been scrolled. */
  readonly scrolled: number;
  /** The close control's corner, measured from the sheet's own. */
  readonly close: readonly number[];
  /** Whether the whole close control lies inside the sheet. */
  readonly closeInReach: boolean;
}

/** Runs in the page: read the open sheet as `ScrolledSheet` does. */
function readScrolledSheet(): ScrolledSheet {
  const face = document.querySelector(".wall-open-face");
  const close = face?.querySelector(".wall-open-close");
  if (!(face instanceof HTMLElement) || close === null || close === undefined) {
    return {
      focused: "",
      below: 0,
      beside: 0,
      scrolled: 0,
      close: [],
      closeInReach: false,
    };
  }
  const sheet = face.getBoundingClientRect();
  const box = close.getBoundingClientRect();
  return {
    focused: document.activeElement?.className ?? "",
    below: face.scrollHeight - face.clientHeight,
    beside: face.scrollWidth - face.clientWidth,
    scrolled: face.scrollTop,
    close: [Math.round(box.left - sheet.left), Math.round(box.top - sheet.top)],
    closeInReach: box.top >= sheet.top && box.bottom <= sheet.bottom &&
      box.left >= sheet.left && box.right <= sheet.right,
  };
}

Deno.test("a sheet too tall for its screen scrolls inside itself, with its close control focused, in its corner, and in reach", async () => {
  const card = WALL_DECK.find((each) =>
    each.kind === "benefit" && each.more !== undefined &&
    each.href !== undefined
  );
  assert(card !== undefined, "a card with every part a sheet can show");
  for (const room of SHORT_ROOMS) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: room.width, height: room.height },
        reducedMotion: "no-preference",
      });
      const { page, faults } = await openLiveWall(context);
      await page.locator(openerOf(card.id)).focus();
      await page.keyboard.press("Enter");
      await page.locator(OPEN_SHEET).waitFor();
      await motionSettled(page);

      const opened = await page.evaluate(readScrolledSheet);
      assert(opened.below > 0, `${room.name}: the sheet has to scroll`);
      assertEquals(
        {
          focused: opened.focused,
          beside: opened.beside,
          closeInReach: opened.closeInReach,
        },
        { focused: "wall-open-close", beside: 0, closeInReach: true },
        `${room.name}: the close control holds the focus, and no word runs past the sheet's side`,
      );

      // The keyboard scrolls the sheet from the close control, and the
      // control keeps its corner while the words pass under it.
      await page.keyboard.press("End");
      await page.waitForFunction(() =>
        (document.querySelector(".wall-open-face")?.scrollTop ?? 0) > 0
      );
      const scrolledDown = await page.evaluate(readScrolledSheet);
      assertEquals(
        {
          focused: scrolledDown.focused,
          close: scrolledDown.close,
          closeInReach: scrolledDown.closeInReach,
        },
        { focused: "wall-open-close", close: opened.close, closeInReach: true },
        `${room.name}: the close control left its corner as the sheet scrolled`,
      );
      await page.keyboard.press("Enter");
      await sheetGone(page, room.name);
      assertEquals(faults, [], room.name);
    });
  }
});
