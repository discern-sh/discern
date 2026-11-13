import { assert } from "@std/assert";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { handler } from "../site/serve.ts";
import { cardHeading, cardNumeral } from "../site/wall/Card.tsx";
import type { WallCard } from "../site/wall/types.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import { NEAR_ATTRIBUTE } from "../site/wall/use_stage.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";
export const ORIGIN = "http://127.0.0.1:18899";

export const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1440, height: 900 },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];

/** The live wall root: present once the island has hydrated. */
export const LIVE_WALL = ".wall[data-wall-live]";

/** The live wall while the plane is flat and carries no transform. */
export const NEAR_WALL = `${LIVE_WALL}[${NEAR_ATTRIBUTE}]`;
/** The opened card's sheet, and the sheet once it is open. */
export const SHEET = "dialog.wall-open";
export const OPEN_SHEET = `${SHEET}[open]`;

/** How far down the viewport a click lands that is meant for no sheet: above every sheet. */
export const OUTSIDE_Y = 8;

/** Open a page on the production handler and record every fault it reports. */
export async function openPage(
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
export async function withBrowser(
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
export async function atEachViewport(
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
export async function openLiveWall(
  context: BrowserContext,
): Promise<{ readonly page: Page; readonly faults: string[] }> {
  const opened = await openPage(context);
  await opened.page.goto(`${ORIGIN}/`);
  await opened.page.locator(LIVE_WALL).waitFor();
  await opened.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return opened;
}

/** Scroll until the stage's top edge meets the top of the viewport. */
export function scrollToWall(page: Page): Promise<void> {
  return page.locator(".wall-stage").evaluate((stage) =>
    stage.scrollIntoView({ block: "start", behavior: "instant" })
  );
}

/** Resolve once no clock-driven, finite animation or transition is running. */
export async function motionSettled(page: Page): Promise<void> {
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
export async function eventually(
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

/** The heading control of the card with this id, before or after hydration. */
export function openerOf(id: string): string {
  return `.wall-card[data-card="${id}"] .wall-card-open`;
}

/** The name a card's sheet goes by: its numeral, when it has one, then its heading. */
export function sheetName(card: WallCard): string {
  const numeral = cardNumeral(card);
  return numeral === undefined
    ? cardHeading(card)
    : `${numeral} ${cardHeading(card)}`;
}

/** Every card marked as an opened card's source, as `id:state`. */
export function markedCards(page: Page): Promise<string[]> {
  return page.locator(`[${OPENING_ATTRIBUTE}]`).evaluateAll(
    (cards, attribute) =>
      cards.map((card) =>
        `${card.getAttribute("data-card")}:${card.getAttribute(attribute)}`
      ),
    OPENING_ATTRIBUTE,
  );
}

/** Wait for the sheet to go, and for the card it came from to be let go. */
export async function sheetGone(page: Page, where: string): Promise<void> {
  await page.locator(SHEET).waitFor({ state: "detached" });
  await eventually(
    page,
    async () => (await markedCards(page)).length === 0,
    `${where}: a card stays marked after its sheet has gone`,
  );
}
