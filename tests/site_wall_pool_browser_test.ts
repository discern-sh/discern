/**
 * The headline pool at every width a visitor may bring: how the headline and
 * the line below it break, and that nothing leaves the pool. The checks hold
 * what the reader sees and name no breakpoint, so they stand whichever width
 * a stylesheet picks to change at.
 */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { openLiveWall, withBrowser } from "./site_wall_browser.ts";

/** Widths visitors arrive with, and both sides of the wall's own breakpoints. */
const DEVICE_WIDTHS = [
  320,
  360,
  390,
  430,
  540,
  600,
  700,
  768,
  834,
  900,
  959,
  960,
  1024,
  1180,
  1440,
  1728,
];

/** Every device width, and an even sweep between the narrowest and the widest. */
const WIDTHS = [
  ...new Set([
    ...DEVICE_WIDTHS,
    ...Array.from({ length: 71 }, (_, step) => 320 + step * 20),
  ]),
].sort((a, b) => a - b);

/** A tall screen, and the short one a phone on its side has. */
const HEIGHTS = [900, 390];

/** Lines read as being of like length when the shortest is this much of the longest. */
const LIKE_LENGTH = 0.75;

/**
 * The line below the headline may go from two lines to one a little after
 * the headline does. It must have done so once the headline's one line leaves
 * this much of the pool's width spare.
 */
const HANDOVER = 0.03;

/** A run of words as laid out. */
interface Wording {
  /** The width of each line, from the top. */
  readonly lines: readonly number[];
  /** The fewest lines the words can take in the pool's content box. */
  readonly fewest: number;
}

interface Pool {
  /** The width of the pool's content box. */
  readonly width: number;
  readonly headline: Wording;
  readonly category: Wording;
  /** Everything in the pool that reaches past its content box. */
  readonly outside: readonly string[];
  /** How far the page scrolls sideways. */
  readonly sideways: number;
}

/** Measure the pool as laid out at the page's present size. */
function measurePool(page: Page): Promise<Pool> {
  return page.evaluate(() => {
    const lineWidths = (words: Element): number[] => {
      const range = document.createRange();
      range.selectNodeContents(words);
      const lines = new Map<number, { left: number; right: number }>();
      for (const box of range.getClientRects()) {
        if (box.width === 0) continue;
        const line = lines.get(Math.round(box.top));
        lines.set(Math.round(box.top), {
          left: Math.min(line?.left ?? box.left, box.left),
          right: Math.max(line?.right ?? box.right, box.right),
        });
      }
      return [...lines.values()].map((line) => line.right - line.left);
    };
    const pool = document.querySelector(".wall-pool");
    if (pool === null) throw new Error("the wall has no pool");
    const style = getComputedStyle(pool);
    const edge = pool.getBoundingClientRect();
    const left = edge.left + parseFloat(style.paddingLeft);
    const right = edge.right - parseFloat(style.paddingRight);
    const width = right - left;

    const wording = (selector: string): { lines: number[]; fewest: number } => {
      const words = pool.querySelector(selector);
      if (words === null) throw new Error(`the pool has no ${selector}`);
      // The same words in the pool's whole width, each line filled before
      // the next begins: no arrangement takes fewer lines.
      const filled = words.cloneNode(true);
      if (!(filled instanceof HTMLElement)) throw new Error(selector);
      filled.style.cssText = "position: absolute; visibility: hidden; " +
        `inline-size: ${width}px; max-inline-size: none; text-wrap: wrap;`;
      pool.append(filled);
      const fewest = lineWidths(filled).length;
      filled.remove();
      return { lines: lineWidths(words), fewest };
    };

    return {
      width,
      headline: wording(".wall-headline"),
      category: wording(".wall-category"),
      outside: [...pool.querySelectorAll("*")].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 &&
          (box.left < left - 0.5 || box.right > right + 0.5 ||
            element.scrollWidth > element.clientWidth + 1);
      }).map((element) =>
        `${element.tagName.toLowerCase()}.${element.classList}`
      ),
      sideways: document.documentElement.scrollWidth - innerWidth,
    };
  });
}

/** Whether the lines of some wording are of like length. */
function even(wording: Wording): boolean {
  return Math.min(...wording.lines) >= Math.max(...wording.lines) * LIKE_LENGTH;
}

/** Everything about one pool that a reader would call unbalanced. */
function unbalanced(pool: Pool): string[] {
  const { headline, category } = pool;
  const widest = Math.max(...headline.lines);
  const found: string[] = [];
  if (headline.lines.length !== headline.fewest) {
    found.push(
      `the headline takes ${headline.lines.length} lines where ${headline.fewest} would hold it`,
    );
  }
  if (!even(headline)) found.push("the headline's lines are uneven");
  if (category.lines.length > 2) found.push("the line below runs past two");
  if (!even(category)) found.push("the line below breaks unevenly");
  if (headline.lines.length > 1 && Math.max(...category.lines) > widest) {
    found.push("the line below is wider than the wrapped headline");
  }
  if (
    headline.lines.length === 1 && category.lines.length > 1 &&
    widest <= pool.width * (1 - HANDOVER)
  ) {
    found.push("the line below wraps under a one-line headline");
  }
  if (pool.outside.length > 0) found.push(`${pool.outside} leave the pool`);
  if (pool.sideways > 0) found.push("the page scrolls sideways");
  return found.map((fault) =>
    `${fault} (pool ${Math.round(pool.width)}, headline ${
      headline.lines.map(Math.round)
    }, below ${category.lines.map(Math.round)})`
  );
}

Deno.test("the headline breaks only where it must and the line below follows it, at every width", async () => {
  // A finger and a mouse get different walls below the pool, and the same pool.
  for (const hasTouch of [true, false]) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        hasTouch,
        isMobile: hasTouch,
      });
      const { page, faults } = await openLiveWall(context);
      const found: string[] = [];
      const lineCounts = new Set<number>();
      for (const height of HEIGHTS) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height });
          const pool = await measurePool(page);
          lineCounts.add(pool.headline.lines.length);
          found.push(
            ...unbalanced(pool).map((fault) => `${width}x${height}: ${fault}`),
          );
        }
      }
      assertEquals(found, []);
      assert(
        lineCounts.has(1) && lineCounts.has(2),
        "the sweep meets the headline both wrapped and on one line",
      );
      assertEquals(faults, []);
    });
  }
});
