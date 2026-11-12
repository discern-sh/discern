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
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
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
  sheetsMounted,
  type Viewport,
  VIEWPORTS,
  wallAtRest,
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

Deno.test("a double click, a press on the arriving sheet, and requests that overlap each leave one whole sheet or none", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const press = await pressableCard(page, size, "top");
    await assertDoubleClickOpensOnce(page, size, press);
    await assertPressOnTheArrivingSheetLands(page, size, press);
    await assertRequestsSettleWhole(page, size, press);
    assertEquals(faults, [], size.name);
  });
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
