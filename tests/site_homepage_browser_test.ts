/**
 * Real-browser homepage checks against the production handler, at phone and
 * laptop sizes. The wall's content must be complete before any script runs, and
 * the island must then hydrate that same markup under the site's Content
 * Security Policy without one page or console error. Layout, script policy,
 * modal dialogs, and focus need a real browser to judge.
 */
import { assert, assertEquals } from "@std/assert";
import type { BrowserContext, Page } from "playwright-core";
import { DISCERN_CATEGORY_LINE, LANDING_HEADLINE } from "../site/brand.ts";
import { handler } from "../site/serve.ts";
import { cardHeading } from "../site/wall/Card.tsx";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { lensRecedes } from "../site/wall/Lens.tsx";
import { WALL_KNOBS, wallKnobProperty } from "../site/wall/tuning/knobs.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";

const ORIGIN = "http://127.0.0.1:18899";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

/** The live wall root: present once the island has hydrated. */
const LIVE_WALL = ".wall[data-wall-live]";

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

/** Run `check` in a fresh context at every viewport, then close the browser. */
async function atEachViewport(
  options: { readonly javaScriptEnabled: boolean },
  check: (
    context: BrowserContext,
    viewport: (typeof VIEWPORTS)[number],
  ) => Promise<void>,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: "no-preference",
        javaScriptEnabled: options.javaScriptEnabled,
      });
      try {
        await check(context, viewport);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
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
      await page.locator('main a[href="/docs/start"]').first().isVisible(),
      `${size.name}: the call to action is reachable`,
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

    // Controls that need script stay out of sight until the island is live.
    assertEquals(await page.locator(LIVE_WALL).count(), 0);
    assertEquals(await page.locator(".wall-chip").first().isVisible(), false);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("the island hydrates the served wall, and the lens and cards respond", async () => {
  const lens = WALL_LENSES[0];
  assert(lens !== undefined, "the wall has a lens to choose");
  const card = WALL_DECK[0];
  assert(card !== undefined, "the wall has a card to open");
  const opener = `.wall-card[data-card="${card.id}"] .wall-card-open`;
  const anyDialog = "dialog.wall-open";
  const openDialog = `${anyDialog}[open]`;

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

    // The lens recedes the cards outside it and removes none.
    const chip = page.locator(`.wall-chip[data-lens="${lens.id}"]`);
    const everything = page.locator(".wall-chip:not([data-lens])");
    assertEquals(await chip.getAttribute("aria-pressed"), "false");
    await chip.click();
    assertEquals(await chip.getAttribute("aria-pressed"), "true");
    assertEquals(await everything.getAttribute("aria-pressed"), "false");
    assertEquals(
      await page.locator(".wall-card[data-receded]").evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-card"))
      ),
      WALL_DECK.filter((each) => lensRecedes(lens, each)).map(({ id }) => id),
      size.name,
    );
    assertEquals(
      await page.locator(".wall-list > .wall-card").count(),
      WALL_DECK.length,
      "a lens never removes a card",
    );
    await everything.click();
    assertEquals(await page.locator(".wall-card[data-receded]").count(), 0);

    // By pointer: a click opens the card, and a click outside it closes it.
    await page.locator(opener).click();
    await page.locator(openDialog).waitFor();
    assertEquals(
      await page.locator(`${openDialog} .wall-open-title`).innerText(),
      cardHeading(card),
    );
    const box = await page.locator(openDialog).boundingBox();
    assert(box !== null, "the opened card has a box");
    assert(
      Math.abs(box.x + box.width / 2 - size.width / 2) <= 1 && box.y > 8,
      `${size.name}: the opened card sits centered, clear of the top edge`,
    );
    await page.mouse.click(size.width / 2, box.y / 2);
    await page.locator(anyDialog).waitFor({ state: "detached" });

    // By keyboard: Enter opens it, Escape closes it, and focus returns.
    await page.locator(opener).focus();
    await page.keyboard.press("Enter");
    await page.locator(openDialog).waitFor();
    assert(
      await page.locator(anyDialog).evaluate((dialog) =>
        dialog.contains(document.activeElement)
      ),
      "focus moves into the opened card",
    );
    await page.keyboard.press("Escape");
    await page.locator(anyDialog).waitFor({ state: "detached" });
    assert(
      await page.locator(opener).evaluate((button) =>
        button === document.activeElement
      ),
      "focus returns to the card that was opened",
    );

    // The Close button is the third way out.
    await page.keyboard.press("Enter");
    await page.locator(`${openDialog} .wall-open-close`).click();
    await page.locator(anyDialog).waitFor({ state: "detached" });

    assertEquals(await page.locator(".wall-tune").count(), 0);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("the tuning panel appears only on request and edits the wall root in place", async () => {
  const knob = WALL_KNOBS.find((each) => each.name === "gap");
  assert(knob !== undefined, "the wall has a gap knob");
  const property = wallKnobProperty(knob.name);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
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
    assertEquals(await written(), `${knob.default}${knob.unit}`);

    await page.locator(".wall-tune-row").filter({ hasText: knob.label })
      .locator("input").focus();
    await page.keyboard.press("End");
    assertEquals(await written(), `${knob.max}${knob.unit}`);
    await page.locator(".wall-tune-actions button", { hasText: "Reset" })
      .click();
    assertEquals(await written(), `${knob.default}${knob.unit}`);
    assertEquals(faults, []);
  } finally {
    await browser.close();
  }
});
