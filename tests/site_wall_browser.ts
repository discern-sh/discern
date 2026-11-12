/**
 * What the wall's real-browser tests share: the production handler behind a
 * page that records every fault, the viewports, and how a test reads the
 * wall at rest, finds a card to press, and waits for a sheet to go.
 */
import { z } from "@zod/zod";
import { assert, assertEquals } from "@std/assert";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { handler } from "../site/serve.ts";
import {
  cardHeading,
  cardNumeral,
  RECEDED_ATTRIBUTE,
} from "../site/wall/Card.tsx";
import type { WallCard } from "../site/wall/types.ts";
import { LIGHT_PROPERTIES } from "../site/wall/use_light.ts";
import { OPENING_ATTRIBUTE } from "../site/wall/use_open_card.ts";
import { NEAR_ATTRIBUTE } from "../site/wall/use_stage.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";

export const ORIGIN = "http://127.0.0.1:18899";

export const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

/**
 * A full-width window on a large laptop's own screen. The wall has five
 * columns here, one more than the laptop viewport gives it.
 */
export const WIDE_VIEWPORT = {
  name: "wide",
  width: 1728,
  height: 1000,
} as const;

export type Viewport = (typeof VIEWPORTS)[number] | typeof WIDE_VIEWPORT;

/** The live wall root: present once the island has hydrated. */
export const LIVE_WALL = ".wall[data-wall-live]";

/** The live wall while the plane is flat and carries no transform. */
export const NEAR_WALL = `${LIVE_WALL}[${NEAR_ATTRIBUTE}]`;

/** The live wall while the plane is tilted away. */
export const FAR_WALL = `${LIVE_WALL}:not([${NEAR_ATTRIBUTE}])`;

/** A card the active lens set aside. */
export const RECEDED_CARD = `.wall-card[${RECEDED_ATTRIBUTE}]`;

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

/** The plane's computed transform: "none" exactly when it carries none at all. */
export function planeTransform(page: Page): Promise<string> {
  return page.locator(".wall-plane").evaluate((plane) =>
    getComputedStyle(plane).transform
  );
}

/** Scroll until the stage's top edge meets the top of the viewport. */
export function scrollToWall(page: Page): Promise<void> {
  return page.locator(".wall-stage").evaluate((stage) =>
    stage.scrollIntoView({ block: "start", behavior: "instant" })
  );
}

/** How far down the page the viewport has scrolled. */
export function scrolled(page: Page): Promise<number> {
  return page.evaluate(() => scrollY);
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

/**
 * Hold the pointer light to coming fully up and falling still: what it wrote
 * on the wall root has stayed the same over several frames. A light that
 * never rests there is a failure, named as one, and never an endless wait.
 */
export async function lightSettled(page: Page): Promise<void> {
  const settled = await page.locator(".wall").evaluate(
    (root, names) =>
      new Promise<boolean>((resolve) => {
        let last = "";
        let still = 0;
        const look = (patience: number): void => {
          const now = names.map((name) => root.style.getPropertyValue(name))
            .join(" ");
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 3 && now.endsWith(" 1.000")) resolve(true);
          else if (patience === 0) resolve(false);
          else requestAnimationFrame(() => look(patience - 1));
        };
        look(600);
      }),
    [...LIGHT_PROPERTIES.room],
  );
  assert(settled, "the light comes fully up under the pointer and rests there");
}

/** Where a viewport point lies from the wall root's corner, as the light writes it. */
export function placeOnWall(
  page: Page,
  point: { readonly x: number; readonly y: number },
): Promise<{ readonly x: number; readonly y: number }> {
  return page.locator(".wall").evaluate((root, point) => {
    const rect = root.getBoundingClientRect();
    return {
      x: point.x - rect.left - root.clientLeft,
      y: point.y - rect.top - root.clientTop,
    };
  }, point);
}

/** Whether a recorded place is `place`, to within the light's own rounding. */
export function isAt(
  [x = "", y = ""]: readonly string[],
  place: { readonly x: number; readonly y: number },
): boolean {
  return Math.abs(parseFloat(x) - place.x) <= 0.6 &&
    Math.abs(parseFloat(y) - place.y) <= 0.6;
}

/** What the light has written on the wall root: its place, and how far up. */
export function lightNow(page: Page): Promise<string[]> {
  return page.locator(".wall").evaluate(
    (root, names) =>
      root instanceof HTMLElement
        ? names.map((name) => root.style.getPropertyValue(name))
        : [],
    [...LIGHT_PROPERTIES.room],
  );
}

/** Let go of the focus, as a click on the page's margin does. */
export function dropFocus(page: Page): Promise<void> {
  return page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

/** One card as drawn: its item's box, its face's box, and how it is lit. */
export interface CardSample {
  readonly id: string;
  /** Left, top, width, and height of the list item, then of the face. */
  readonly box: readonly number[];
  /** The item's opacity and filter, which a lens and nothing else may change. */
  readonly look: string;
}

/** Sample every card as drawn, and name the card at a viewport point. */
export function sampleWall(
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
export interface WallAtRest {
  readonly scrollY: number;
  readonly near: boolean;
  readonly cards: readonly CardSample[];
}

/** Park the pointer in the room's margin, where it touches no card. */
export async function parkPointer(
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
export async function wallAtRest(
  page: Page,
  size: Viewport,
): Promise<WallAtRest> {
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

/** The button that opens the card with this id. */
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

/** A card under a point of the viewport, and that point. */
export interface Press {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Find a card the pointer can press. Scanning from the top finds one high in
 * the viewport, above where a sheet comes to rest; scanning from the bottom
 * finds one of the far view's nearest rows. The card named by `except` is
 * passed over.
 */
export async function pressableCard(
  page: Page,
  size: Viewport,
  from: "top" | "bottom",
  except = "",
): Promise<Press> {
  const found = await page.evaluate(({ width, height, upward, except }) => {
    for (let row = 0; row < 14; row++) {
      const y = upward ? height - 60 - row * 40 : height * 0.16 + row * 40;
      for (const across of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const x = Math.round(width * across);
        const id = document.elementFromPoint(x, y)?.closest<HTMLElement>(
          ".wall-card",
        )?.dataset.card;
        if (id !== undefined && id !== except) return { id, x, y };
      }
    }
    return null;
  }, {
    width: size.width,
    height: size.height,
    upward: from === "bottom",
    except,
  });
  assert(found !== null, `${size.name}: a card lies under the pointer`);
  return found;
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

/** Count the sheets the page mounts from now on, starting again from none. */
export function countSheets(page: Page): Promise<void> {
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
export function sheetsMounted(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(document.documentElement.dataset.testSheets)
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

/**
 * Runs in the page: resolve with the name of every view-transition part that
 * animates from now until a transition has come and gone. A page that never
 * runs one answers with none once its patience has run out.
 */
export function watchTransition(): Promise<string[]> {
  return new Promise((resolve) => {
    const seen = new Set<string>();
    const look = (patience: number): void => {
      const parts = document.getAnimations().flatMap((animation) => {
        const part = animation.effect instanceof KeyframeEffect
          ? animation.effect.pseudoElement
          : null;
        return part?.startsWith("::view-transition") === true ? [part] : [];
      });
      for (const part of parts) seen.add(part);
      if ((seen.size > 0 && parts.length === 0) || patience === 0) {
        resolve([...seen]);
      } else {
        requestAnimationFrame(() => look(patience - 1));
      }
    };
    look(600);
  });
}

/** Resolve once the page has drawn `frames` more frames. */
export function drawn(page: Page, frames: number): Promise<void> {
  return page.evaluate((frames) =>
    new Promise<void>((resolve) => {
      const next = (left: number): void => {
        if (left === 0) resolve();
        else requestAnimationFrame(() => next(left - 1));
      };
      next(frames);
    }), frames);
}

/** Whether a value read from a trace is an object with named fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const TRACE_EVENTS = z.array(z.record(z.string(), z.unknown()));

/** A trace as the browser writes it: its events, bare or under one key. */
const TRACE = z.union([
  TRACE_EVENTS,
  z.looseObject({ traceEvents: TRACE_EVENTS }),
]);

/**
 * Every event the browser put on its own timeline, in the named trace
 * categories, while `act` ran and for two frames after it.
 */
export async function traced(
  browser: Browser,
  page: Page,
  categories: readonly string[],
  act: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
  await browser.startTracing(page, { categories: [...categories] });
  let trace: Uint8Array;
  try {
    await act();
    await drawn(page, 2);
  } finally {
    trace = await browser.stopTracing();
  }
  const decoded = decodeWith(TRACE, new TextDecoder().decode(trace));
  return Array.isArray(decoded) ? decoded : decoded.traceEvents;
}
