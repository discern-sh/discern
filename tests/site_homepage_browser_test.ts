/**
 * Real-browser homepage checks against the production handler, at phone and
 * laptop sizes. The wall's content must be complete before any script runs, and
 * the island must then hydrate that same markup under the site's Content
 * Security Policy without one page or console error. The same pages hold the
 * wall's motion contract: the approach on a large screen, a flat wall on a
 * phone and under reduced motion, and a pointer that moves nothing. They hold
 * the opened card's too: every way out of the sheet leaves the page exactly
 * as it was. Layout, script policy, motion, modal dialogs, and focus need a
 * real browser to judge.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import { DISCERN_CATEGORY_LINE, LANDING_HEADLINE } from "../site/brand.ts";
import { handler } from "../site/serve.ts";
import { cardHeading, cardNumeral } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { lensRecedes } from "../site/wall/Lens.tsx";
import { WALL_KNOBS, wallKnobProperty } from "../site/wall/tuning/knobs.ts";
import type { WallCard, WallLens } from "../site/wall/types.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import { MANUAL_START } from "../site/wall/WallPage.tsx";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";

const ORIGIN = "http://127.0.0.1:18899";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

/** The live wall root: present once the island has hydrated. */
const LIVE_WALL = ".wall[data-wall-live]";

/** The live wall while the plane is flat and carries no transform. */
const NEAR_WALL = `${LIVE_WALL}[data-wall-near]`;

/** The live wall while the plane is tilted away. */
const FAR_WALL = `${LIVE_WALL}:not([data-wall-near])`;

/** The opened card's sheet, and the sheet once it is open. */
const SHEET = "dialog.wall-open";
const OPEN_SHEET = `${SHEET}[open]`;

/** The most a hovered card's own box may differ from its box at rest, in pixels. */
const HOVER_TRAVEL = 6;

/** A receded card can still be read and opened, so it keeps at least this opacity. */
const RECEDED_OPACITY_FLOOR = 0.7;

/** How far down the viewport a click lands that is meant for no sheet: above every sheet. */
const OUTSIDE_Y = 8;

/** Open a page on the production handler and record every fault it reports. */
async function openPage(
  context: BrowserContext,
): Promise<{ readonly page: Page; readonly faults: string[] }> {
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  await serveThroughHandler(page, ORIGIN, handler);
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    // A hydration mismatch and a Content Security Policy refusal both arrive
    // on the console; neither is tolerated as a warning either.
    if (message.type() === "error" || message.type() === "warning") {
      faults.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    faults.push(`request failed: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      faults.push(`${response.status()}: ${response.url()}`);
    }
  });
  return { page, faults };
}

/** Run `check` against a fresh browser, and close it whatever happens. */
async function withBrowser(
  check: (browser: Browser) => Promise<void>,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    await check(browser);
  } finally {
    await browser.close();
  }
}

interface Visitor {
  readonly javaScriptEnabled: boolean;
  /** The visitor asked for reduced motion. Motion is welcome unless this is set. */
  readonly reducedMotion?: true;
}

/**
 * Run `check` at every viewport, each in a browser of its own. An installed
 * Chrome that has been up for more than about twenty seconds takes as long
 * again to close, so no browser here is kept for more than one viewport.
 */
async function atEachViewport(
  visitor: Visitor,
  check: (context: BrowserContext, viewport: Viewport) => Promise<void>,
): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await withBrowser(async (browser) => {
      await check(
        await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          reducedMotion: visitor.reducedMotion ? "reduce" : "no-preference",
          javaScriptEnabled: visitor.javaScriptEnabled,
        }),
        viewport,
      );
    });
  }
}

/** Open the homepage and wait until its island is live and its type is in. */
async function openLiveWall(
  context: BrowserContext,
): Promise<{ readonly page: Page; readonly faults: string[] }> {
  const opened = await openPage(context);
  await opened.page.goto(`${ORIGIN}/`);
  await opened.page.locator(LIVE_WALL).waitFor();
  await opened.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return opened;
}

/** The plane's computed transform: "none" exactly when it carries none at all. */
function planeTransform(page: Page): Promise<string> {
  return page.locator(".wall-plane").evaluate((plane) =>
    getComputedStyle(plane).transform
  );
}

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

/** Scroll until the stage's top edge meets the top of the viewport. */
function scrollToWall(page: Page): Promise<void> {
  return page.locator(".wall-stage").evaluate((stage) =>
    stage.scrollIntoView({ block: "start", behavior: "instant" })
  );
}

/** How far down the page the viewport has scrolled. */
function scrolled(page: Page): Promise<number> {
  return page.evaluate(() => scrollY);
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

/** Resolve once no clock-driven, finite animation or transition is running. */
async function motionSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) =>
      animation.playState !== "running" ||
      !(animation.timeline instanceof DocumentTimeline) ||
      animation.effect?.getTiming().iterations === Infinity
    )
  );
}

/**
 * Resolve once `check` holds, asking again each frame or so for a few
 * seconds. A scroll-driven animation answers a scroll at the next frame, not
 * within the call that scrolled, and a page with script off has no state of
 * its own to wait on.
 */
async function eventually(
  page: Page,
  check: () => Promise<boolean>,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  assert(await check(), message);
}

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

/** One card as drawn: its item's box, its face's box, and how it is lit. */
interface CardSample {
  readonly id: string;
  /** Left, top, width, and height of the list item, then of the face. */
  readonly box: readonly number[];
  /** The item's opacity and filter, which a lens and nothing else may change. */
  readonly look: string;
}

/** Sample every card as drawn, and name the card at a viewport point. */
function sampleWall(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<
  { readonly cards: readonly CardSample[]; readonly under: string | null }
> {
  return page.evaluate(({ x, y }) => {
    const cards = [...document.querySelectorAll<HTMLElement>(".wall-card")]
      .map((card) => {
        const item = card.getBoundingClientRect();
        const face = card.querySelector(".wall-card-face")
          ?.getBoundingClientRect();
        const style = getComputedStyle(card);
        return {
          id: card.dataset.card ?? "",
          box: [
            item.x,
            item.y,
            item.width,
            item.height,
            face?.x ?? 0,
            face?.y ?? 0,
            face?.width ?? 0,
            face?.height ?? 0,
          ],
          look: `${style.opacity} ${style.filter}`,
        };
      });
    const under = document.elementFromPoint(x, y)?.closest<HTMLElement>(
      ".wall-card",
    )?.dataset.card ?? null;
    return { cards, under };
  }, point);
}

/** The page as it stands once nothing is moving and the pointer is off the wall. */
interface WallAtRest {
  readonly scrollY: number;
  readonly near: boolean;
  readonly cards: readonly CardSample[];
}

/** Park the pointer in the room's margin, where it touches no card. */
async function parkPointer(
  page: Page,
  size: Viewport,
): Promise<{ readonly x: number; readonly y: number }> {
  const rest = { x: 2, y: size.height - 2 };
  await page.mouse.move(rest.x, rest.y);
  return rest;
}

/**
 * Park the pointer, wait for motion to end, and sample the page: its scroll,
 * whether the plane is near, and every card as drawn.
 */
async function wallAtRest(page: Page, size: Viewport): Promise<WallAtRest> {
  const rest = await parkPointer(page, size);
  await motionSettled(page);
  const { cards, under } = await sampleWall(page, rest);
  assertEquals(under, null, "the pointer rests off the wall");
  return {
    scrollY: await scrolled(page),
    near: await page.locator(NEAR_WALL).count() === 1,
    cards,
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
    assertEquals(await scrolled(page), 0, "phone: at the top");
    assertEquals((await documentExtent(page)).overflowX, 0, "phone");
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    assertEquals(await planeTransform(page), "none", "phone: flat when read");
    return;
  }

  // Far: at the top of the page the plane is tilted away, the stage has not
  // called it near, and the lens has not arrived.
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: tilted at top");
  assertEquals(
    await firstCardIsFlat(page),
    false,
    "laptop: the far rows are small",
  );
  assertEquals(
    await page.locator(".wall-chip").first().isVisible(),
    false,
    "laptop: the lens stays out of the far view",
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
  assertEquals(
    (await documentExtent(page)).height,
    far.height,
    "laptop: the approach does not change the page's height",
  );

  // Scrolling back up tilts the plane away again.
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: far again");

  // A card the keyboard steps onto in the far view is too small to read, so
  // the wall comes to the focus instead of leaving it out there.
  await page.locator(".wall-pool .wall-cta").focus();
  await page.keyboard.press("Tab");
  assert(
    await page.locator(".wall-plane").evaluate((plane) =>
      plane.contains(document.activeElement)
    ),
    "laptop: after the call to action, Tab lands on a card, not a hidden chip",
  );
  await page.locator(NEAR_WALL).waitFor();
  assert(
    await page.evaluate(() => {
      const box = document.activeElement?.getBoundingClientRect();
      return box !== undefined && box.top >= 0 && box.bottom <= innerHeight;
    }),
    "laptop: the focused card is in view at reading size",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator(FAR_WALL).waitFor();

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

/** The button that opens the card with this id. */
function openerOf(id: string): string {
  return `.wall-card[data-card="${id}"] .wall-card-open`;
}

/** The name a card's sheet goes by: its numeral, when it has one, then its heading. */
function sheetName(card: WallCard): string {
  const numeral = cardNumeral(card);
  return numeral === undefined
    ? cardHeading(card)
    : `${numeral} ${cardHeading(card)}`;
}

/** How many of these cards lie at least half in view under the lens bar. */
function inView(page: Page, ids: readonly string[]): Promise<number> {
  return page.evaluate((wanted) => {
    const bar = document.querySelector(".wall-controls")
      ?.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".wall-card")].filter(
      (card) => {
        const box = card.getBoundingClientRect();
        const shown = Math.min(box.bottom, innerHeight) -
          Math.max(box.top, bar?.bottom ?? 0);
        return wanted.includes(card.dataset.card ?? "") &&
          shown * 2 >= box.height;
      },
    ).length;
  }, ids);
}

/** Every card's box on the page itself, which scrolling leaves alone. */
function cardPlaces(page: Page): Promise<string[]> {
  return page.locator(".wall-card").evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return [box.left + scrollX, box.top + scrollY, box.width, box.height]
        .map((length) => length.toFixed(1)).join(" ");
    })
  );
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
    ...await page.locator(".wall-card[data-receded]").evaluateAll((cards) =>
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

/**
 * The lens: one row of chips, each of which recedes the cards outside it,
 * removes and moves none, and lets go when pressed again. A lens that leaves
 * nothing it chose in view brings the page to the nearest card it did choose.
 */
async function assertLens(page: Page, size: Viewport): Promise<void> {
  const everything = page.locator(".wall-chip:not([data-lens])");
  const receded = page.locator(".wall-card[data-receded]");
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
  const places = await cardPlaces(page);
  let brought = 0;

  for (const lens of WALL_LENSES) {
    const where = `${size.name}, ${lens.id}`;
    const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
    const forward = WALL_DECK.filter((card) => !lensRecedes(lens, card)).map((
      { id },
    ) => id);
    await scrollToWall(page);
    const from = await scrolled(page);
    const alreadyShown = await inView(page, forward) > 0;
    assertEquals(await chip.getAttribute("aria-pressed"), "false", where);

    await pressChip(page, chip);
    assertEquals(await chip.getAttribute("aria-pressed"), "true", where);
    assertEquals(await everything.getAttribute("aria-pressed"), "false", where);
    assertEquals(
      await receded.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-card"))
      ),
      WALL_DECK.filter((card) => lensRecedes(lens, card)).map(({ id }) => id),
      where,
    );
    assertEquals(
      await page.locator(".wall-list > .wall-card").count(),
      WALL_DECK.length,
      `${where}: a lens never removes a card`,
    );

    // The visitor sees what the lens chose. Where a card it chose was in
    // view already the page stays put; otherwise the page comes to one.
    await eventually(
      page,
      async () => await inView(page, forward) > 0,
      `${where}: no card the lens kept forward is in view`,
    );
    if (alreadyShown) {
      assertEquals(await scrolled(page), from, `${where}: nothing to find`);
    } else {
      brought += 1;
    }
    assertEquals(
      await cardPlaces(page),
      places,
      `${where}: a lens never moves a card`,
    );

    if (lens === WALL_LENSES[0]) {
      await assertRecededStillWorks(page, lens);
      await pressChip(page, everything);
    } else {
      // Pressing the pressed chip lets the lens go.
      await pressChip(page, chip);
    }
    assertEquals(await receded.count(), 0, `${where}: the lens lets go`);
    assertEquals(await everything.getAttribute("aria-pressed"), "true", where);
  }
  if (size.name === "phone") {
    assert(
      brought > 0,
      "on a phone some lens starts with none of its cards on screen; if the deck no longer has one, start this check further down the wall",
    );
  }
}

/** A card under a point of the viewport, and that point. */
interface Press {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Find a card the pointer can press. Scanning from the top finds one high in
 * the viewport, above where a sheet comes to rest; scanning from the bottom
 * finds one of the far view's nearest rows.
 */
async function pressableCard(
  page: Page,
  size: Viewport,
  from: "top" | "bottom",
): Promise<Press> {
  const found = await page.evaluate(({ width, height, upward }) => {
    for (let row = 0; row < 14; row++) {
      const y = upward ? height - 60 - row * 40 : height * 0.16 + row * 40;
      for (const across of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const x = Math.round(width * across);
        const id = document.elementFromPoint(x, y)?.closest<HTMLElement>(
          ".wall-card",
        )?.dataset.card;
        if (id !== undefined) return { id, x, y };
      }
    }
    return null;
  }, { width: size.width, height: size.height, upward: from === "bottom" });
  assert(found !== null, `${size.name}: a card lies under the pointer`);
  return found;
}

/** Every card marked as an opened card's source, as `id:state`. */
function markedCards(page: Page): Promise<string[]> {
  return page.locator(`[${OPENING_ATTRIBUTE}]`).evaluateAll(
    (cards, attribute) =>
      cards.map((card) =>
        `${card.getAttribute("data-card")}:${card.getAttribute(attribute)}`
      ),
    OPENING_ATTRIBUTE,
  );
}

/** Count the sheets the page mounts from now on, starting again from none. */
function countSheets(page: Page): Promise<void> {
  return page.evaluate((sheet) => {
    const root = document.documentElement;
    const counting = root.dataset.testSheets !== undefined;
    root.dataset.testSheets = "0";
    if (counting) return;
    new MutationObserver((records) => {
      const mounted = records.flatMap((record) => [...record.addedNodes])
        .filter((node) => node instanceof Element && node.matches(sheet));
      root.dataset.testSheets = String(
        Number(root.dataset.testSheets) + mounted.length,
      );
    }).observe(document.body, { childList: true, subtree: true });
  }, SHEET);
}

/** How many sheets the page has mounted since `countSheets`. */
function sheetsMounted(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(document.documentElement.dataset.testSheets)
  );
}

/** Wait for the sheet to go, and for the card it came from to be let go. */
async function sheetGone(page: Page, where: string): Promise<void> {
  await page.locator(SHEET).waitFor({ state: "detached" });
  await eventually(
    page,
    async () => (await markedCards(page)).length === 0,
    `${where}: a card stays marked after its sheet has gone`,
  );
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
 * the card lay flat to begin with.
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
 * them may bring the wall near, however the focus is then drawn.
 */
async function assertHandedFocusMovesNothing(
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
  assertEquals(
    await wallAtRest(page, size),
    before,
    "focus handed to a far card moved the wall",
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

/**
 * The sheet is named as its card's own button is: a numeral leads the
 * heading. Where nothing has to finish moving, every card in the deck is
 * opened by keyboard, asked its name, and closed, with focus back on it.
 */
async function assertEverySheetIsNamed(page: Page): Promise<void> {
  await countSheets(page);
  for (const card of WALL_DECK) {
    const opener = page.locator(openerOf(card.id));
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: sheetName(card), exact: true })
      .waitFor();
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
      await page.locator(`${LIVE_WALL}, .wall[data-wall-near]`).count(),
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

    assertEquals(await page.locator(".wall-tune").count(), 0);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("a card opens as a sheet, and every way out leaves the page exactly as it was", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);

    // Far: a tilted card opens where the sheet stands, with no card held,
    // and closing it never brings the wall near.
    if (size.name === "laptop") {
      await page.locator(FAR_WALL).waitFor();
      const far = await pressableCard(page, size, "bottom");
      await assertEveryWayOut(page, size, far, false);
      await assertHandedFocusMovesNothing(page, size, far);
    }

    // Near: the card grows into the sheet and the sheet returns to it.
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const near = await pressableCard(page, size, "top");
    await assertEveryWayOut(page, size, near, true);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("a double click, a held key, and requests that overlap each leave one whole sheet or none", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.locator(NEAR_WALL).waitFor();
    const press = await pressableCard(page, size, "top");
    await assertDoubleClickOpensOnce(page, size, press);
    await assertPressWhileLeavingLands(page, size, press);
    await assertHeldKeyOpensOnce(page, size, press);
    await assertRequestsSettleWhole(page, size, press);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("under reduced motion the lens arrives whole, and every card opens at once under its own name", async () => {
  await atEachViewport(
    { javaScriptEnabled: true, reducedMotion: true },
    async (context, size) => {
      await context.addInitScript(noteControlTransitions);
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

      // With no transition to cover it, a click outside closes just as soon.
      await scrollToWall(page);
      const press = await pressableCard(page, size, "top");
      await page.mouse.click(press.x, press.y);
      await page.locator(OPEN_SHEET).waitFor();
      await page.mouse.click(size.width / 2, OUTSIDE_Y);
      await sheetGone(page, "reduced motion");
      assertEquals(faults, [], size.name);
    },
  );
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
