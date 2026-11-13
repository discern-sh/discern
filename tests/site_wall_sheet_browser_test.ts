/** Opened-card journeys: dismissal, focus, ordinary repeated input, and a short screen. */
import { assert, assertEquals } from "@std/assert";
import type { Page } from "playwright-core";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import {
  atEachViewport,
  motionSettled,
  OPEN_SHEET,
  openerOf,
  openLiveWall,
  OUTSIDE_Y,
  scrollToWall,
  sheetGone,
  sheetName,
  withBrowser,
} from "./site_wall_browser.ts";

interface WayOut {
  readonly name: string;
  readonly leave: (page: Page) => Promise<void>;
}

const WAYS_OUT: readonly WayOut[] = [
  { name: "Escape", leave: (page) => page.keyboard.press("Escape") },
  { name: "Enter on Close", leave: (page) => page.keyboard.press("Enter") },
  {
    name: "Close",
    leave: (page) =>
      page.getByRole("button", { name: "Close", exact: true }).click(),
  },
  {
    name: "outside the sheet",
    leave: (page) => page.mouse.click(5, OUTSIDE_Y),
  },
];

Deno.test("a card opens as a named dialog and its dismissal controls return focus", async () => {
  const card = WALL_DECK.find((each) => each.href !== undefined);
  assert(card?.href !== undefined);
  const href = card.href;
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    const opener = page.locator(openerOf(card.id));
    if (size.name === "laptop") {
      await opener.scrollIntoViewIfNeeded();
      await motionSettled(page);
      const face = await page.locator(
        `.wall-card[data-card="${card.id}"] .wall-card-face`,
      ).boundingBox();
      assert(face !== null);
      await page.mouse.click(
        face.x + face.width - 7,
        face.y + face.height - 7,
        { delay: 120 },
      );
      await page.locator(OPEN_SHEET).waitFor();
      await page.keyboard.press("Escape");
      await sheetGone(page, "press near the visible corner");
    }
    for (const way of WAYS_OUT) {
      await opener.click();
      const dialog = page.getByRole("dialog", {
        name: sheetName(card),
        exact: true,
      });
      await dialog.waitFor();
      await motionSettled(page);
      assertEquals(await page.locator("dialog[open]").count(), 1);
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      assert(
        await close.evaluate((element) => element === document.activeElement),
      );
      await close.focus();
      await way.leave(page);
      await sheetGone(page, `${size.name}: ${way.name}`);
      assert(
        await opener.evaluate((element) => element === document.activeElement),
        "focus returns to the opener",
      );
    }
    await opener.click();
    const link = page.locator(`${OPEN_SHEET} a[href]`);
    assertEquals(await link.getAttribute("href"), card.href);
    await link.click();
    await page.waitForURL(
      new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
    assertEquals(faults, [], size.name);
  });
});

Deno.test("double-clicking a card opens one dialog and a quick Escape closes it", async () => {
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    const opener = page.locator(".wall-card-open").first();
    await opener.dblclick();
    await page.locator(OPEN_SHEET).waitFor();
    await motionSettled(page);
    assertEquals(await page.locator("dialog[open]").count(), 1);
    await page.keyboard.press("Escape");
    await sheetGone(page, "double click");
    await opener.click();
    await page.locator(OPEN_SHEET).waitFor();
    await page.keyboard.press("Escape");
    await sheetGone(page, "quick Escape");
    assert(
      await opener.evaluate((element) => element === document.activeElement),
    );
    assertEquals(faults, []);
  });
});

Deno.test("a refused view transition still opens a card and selects a lens", async () => {
  const refusal = "no view transition now";
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const { page, faults } = await openLiveWall(context);
    await scrollToWall(page);
    await page.evaluate((message) => {
      document.startViewTransition = () => {
        throw new Error(message);
      };
    }, refusal);
    await page.locator(".wall-card-open").first().click();
    await page.locator(OPEN_SHEET).waitFor();
    await page.keyboard.press("Escape");
    await sheetGone(page, "refused transition");
    const lens = WALL_LENSES[0];
    assert(lens !== undefined);
    const chip = page.getByRole("button", { name: lens.label, exact: true });
    await chip.click();
    assertEquals(await chip.getAttribute("aria-pressed"), "true");
    assert(
      faults.some((fault) => fault.includes(refusal)),
      "the refusal is reported",
    );
    assertEquals(faults.filter((fault) => !fault.includes(refusal)), []);
  });
});

Deno.test("a short screen can scroll the card's content and reach Close", async () => {
  const card = WALL_DECK.find((each) =>
    each.kind === "benefit" && each.more !== undefined &&
    each.href !== undefined
  );
  assert(card !== undefined);
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 320 },
    });
    const { page, faults } = await openLiveWall(context);
    await page.locator(openerOf(card.id)).focus();
    await page.keyboard.press("Enter");
    await page.locator(OPEN_SHEET).waitFor();
    await motionSettled(page);
    await page.keyboard.press("End");
    await page.waitForFunction(() =>
      (document.querySelector(".wall-open-face")?.scrollTop ?? 0) > 0
    );
    const close = page.getByRole("button", { name: "Close", exact: true });
    assert(
      await close.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      }),
      "Close remains in reach while content scrolls",
    );
    await close.click();
    await sheetGone(page, "short screen");
    assertEquals(faults, []);
  });
});
