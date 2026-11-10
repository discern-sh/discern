/**
 * Real-browser homepage checks against the production handler, at phone and
 * laptop sizes. The wall's content must be complete before any script runs, and
 * the island must then hydrate that same markup under the site's Content
 * Security Policy without one page or console error. The same pages hold the
 * wall's motion contract: the approach on a large screen, a flat wall on a
 * phone and under reduced motion, and a pointer that moves nothing. Layout,
 * script policy, motion, modal dialogs, and focus need a real browser to judge.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { BrowserContext, Locator, Page } from "playwright-core";
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

type Viewport = (typeof VIEWPORTS)[number];

/** The live wall root: present once the island has hydrated. */
const LIVE_WALL = ".wall[data-wall-live]";

/** The live wall while the plane is flat and carries no transform. */
const NEAR_WALL = `${LIVE_WALL}[data-wall-near]`;

/** The live wall while the plane is tilted away. */
const FAR_WALL = `${LIVE_WALL}:not([data-wall-near])`;

/** The most a hovered card's own box may differ from its box at rest, in pixels. */
const HOVER_TRAVEL = 6;

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
  check: (context: BrowserContext, viewport: Viewport) => Promise<void>,
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
    await page.locator(".wall-chip").first().waitFor({ state: "visible" });
    assertEquals(await page.evaluate(() => scrollY), 0, "phone: at the top");
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

  // The pointer light's place is inherited, and every element that inherits
  // a new place is restyled. Far cards and the pool take no pointer light, so
  // a pointer crossing the first viewport must not hand them one.
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
      inherited: [".wall-pool", ".wall-plane", ".wall-card-face"].map(place),
    };
  }, lit);
  for (const place of places.inherited) {
    assertNotEquals(place, "missing");
    assertNotEquals(
      place,
      places.root,
      "laptop: the pointer light's place stops short of the far plane",
    );
  }

  // Near: once the pool has scrolled away the plane carries no transform at
  // all, the stage says so, and the lens is there to use.
  await scrollToWall(page);
  await page.locator(NEAR_WALL).waitFor();
  assertEquals(await planeTransform(page), "none", "laptop: flat when near");
  assert(await firstCardIsFlat(page), "laptop: cards at their layout size");
  await page.locator(".wall-chip").first().waitFor({ state: "visible" });
  assertEquals(
    (await documentExtent(page)).height,
    far.height,
    "laptop: the approach does not change the page's height",
  );

  // Scrolling back up tilts the plane away again.
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator(FAR_WALL).waitFor();
  assertNotEquals(await planeTransform(page), "none", "laptop: far again");

  // A card focused from the keyboard in the far view is too small to read,
  // so the wall comes to the focus instead of leaving it out there.
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
  assertEquals(await page.evaluate(() => scrollY), 0);
  assertEquals(await planeTransform(page), "none", "reduced motion: at load");
  assert(await firstCardIsFlat(page), "reduced motion: cards at layout size");
  // The lens is there from the start, with no approach to bring it in.
  await page.locator(".wall-chip").first().waitFor({ state: "visible" });
  assertEquals(await page.evaluate(() => scrollY), 0, "still at the top");
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
  const rest = { x: 2, y: size.height - 2 };
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.mouse.move(rest.x, rest.y);
  await motionSettled(page);
  const baseline = await sampleWall(page, rest);
  assertEquals(baseline.under, null, "the pointer rests off the wall");
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

  await page.mouse.move(rest.x, rest.y);
  await motionSettled(page);
  assertEquals(
    (await sampleWall(page, rest)).cards,
    baseline.cards,
    "every card is back exactly at rest once the pointer has left",
  );
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

    // Controls that need script stay out of sight until the island is live.
    assertEquals(await page.locator(LIVE_WALL).count(), 0);
    assertEquals(await page.locator(".wall-chip").first().isVisible(), false);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("the island hydrates the served wall, the stage brings it near, and the lens and cards respond", async () => {
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

    // Nothing on the wall moves by itself, so there is nothing to pause.
    assertEquals(await page.locator(".wall-pause").count(), 0, size.name);

    await assertStage(page, size);
    if (size.name === "laptop") await assertCalm(page, size);

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

    // By pointer: a click opens the card, and once it has finished opening a
    // click outside it closes it.
    await page.locator(opener).click();
    await page.locator(openDialog).waitFor();
    await motionSettled(page);
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
  const drift = WALL_KNOBS.find((each) => each.name === "drift");
  assert(drift !== undefined, "the wall has a drift knob");
  assertEquals(drift.default, 0, "nothing drifts unless the knob is turned");
  const property = wallKnobProperty(knob.name);
  const browser = await launchBrowser();
  try {
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
  } finally {
    await browser.close();
  }
});
