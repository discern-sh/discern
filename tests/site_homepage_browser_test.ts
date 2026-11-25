/** Core homepage journeys through the production handler. Appearance is reviewed directly. */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import type { Page } from "playwright-core";
import { DISCERN_CATEGORY_LINE, LANDING_HEADLINE } from "../site/brand.ts";
import { bundleBrowserModule } from "../site/page-src/format-generated.ts";
import {
  WALL_ISLAND_ENTRY,
  wallIslandContentHash,
} from "../site/wall/assets.ts";
import { WALL_DECK, WALL_LENSES } from "../site/wall/deck.ts";
import { lensGroups } from "../site/wall/Lens.tsx";
import {
  COPIED_LABEL,
  COPY_LABEL,
  COPY_STATUS,
  SETUP_PROMPT,
  SETUP_PROMPT_ID,
} from "../site/wall/SetupPrompt.tsx";
import { WALL_KNOBS, wallKnobProperty } from "../site/wall/tuning/knobs.ts";
import type { WallLens } from "../site/wall/types.ts";
import { MANUAL_START } from "../site/wall/WallPage.tsx";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import {
  atEachViewport,
  eventually,
  LIVE_WALL,
  motionSettled,
  NEAR_WALL,
  OPEN_SHEET,
  openerOf,
  openLiveWall,
  openPage,
  ORIGIN,
  scrollToWall,
  sheetGone,
  sheetName,
  withBrowser,
} from "./site_wall_browser.ts";

/** The element that shows the setup prompt's words. */
const PROMPT_WORDS = `#${SETUP_PROMPT_ID}`;

/** The copy controls a visitor can see. */
const SHOWN_COPY_CONTROLS = ".wall-copy:visible";

/** Select a lens and wait for the list's change, independent of transition timing. */
async function chooseLens(page: Page, lens?: WallLens): Promise<void> {
  const chip = page.getByRole("button", {
    name: lens?.label ?? "Everything",
    exact: true,
  });
  await chip.click();
  await motionSettled(page);
  assertEquals(await chip.getAttribute("aria-pressed"), "true");
  const groups = lensGroups(lens, WALL_DECK);
  assertEquals(
    await page.locator(".wall-card").evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-card"))
    ),
    [...groups.kept, ...groups.rest].map((card) => card.id),
  );
}

/** A small screen must retain its content without sideways page scrolling. */
async function assertUsableWidth(page: Page): Promise<void> {
  assert(await page.locator("h1").isVisible());
  assert(await page.locator(".wall-pool .wall-cta").isVisible());
  assert(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1
    ),
    "the page fits the viewport",
  );
}

Deno.test("without JavaScript the homepage is readable and its links lead to the manual", async () => {
  const linked = WALL_DECK.find((card) => card.href !== undefined);
  assert(linked?.href !== undefined);
  await atEachViewport({ javaScriptEnabled: false }, async (context, size) => {
    const { page, faults } = await openPage(context);
    assertEquals((await page.goto(`${ORIGIN}/`))?.status(), 200);
    assertEquals(await page.locator("h1").allTextContents(), [
      LANDING_HEADLINE,
    ]);
    assert(await page.getByText(DISCERN_CATEGORY_LINE).first().isVisible());
    assertEquals(await page.locator(".wall-card").count(), WALL_DECK.length);
    await assertUsableWidth(page);
    assertEquals(
      await page.locator(".wall-pool .wall-cta").getAttribute("href"),
      MANUAL_START,
    );
    // Copying needs script. Without it the page shows no copy control, and
    // the prompt's words are there to select by hand.
    assertEquals(await page.locator(SHOWN_COPY_CONTROLS).count(), 0);
    assert(await page.locator(PROMPT_WORDS).isVisible());
    assertEquals(await page.locator(PROMPT_WORDS).textContent(), SETUP_PROMPT);
    assertEquals(
      await page.locator(".wall-pool .wall-agent:visible").count(),
      AGENT_NAMES.length,
    );
    const link = page.locator(openerOf(linked.id));
    assertEquals(await link.getAttribute("href"), linked.href);
    await link.click();
    await page.waitForURL(`${ORIGIN}${linked.href}`);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("the island hydrates the page and lenses regroup cards without losing them", async () => {
  await atEachViewport({ javaScriptEnabled: true }, async (context, size) => {
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
    const { page, faults } = await openLiveWall(context);
    assertEquals(
      await page.locator(`${LIVE_WALL}[data-test-server-rendered]`).count(),
      1,
      "hydration adopts the server element",
    );
    await assertUsableWidth(page);
    assertEquals(
      await page.locator(SHOWN_COPY_CONTROLS).count(),
      2,
      "the live page shows a copy control in the pool and in the closing section",
    );
    assertEquals(await page.locator(".wall-tune").count(), 0);
    await scrollToWall(page);
    const lens = WALL_LENSES[0];
    assert(lens !== undefined);
    await chooseLens(page, lens);
    assert(
      (await page.locator(".wall-controls").getByRole("status")
        .textContent() ?? "").includes(lens.label),
    );
    await chooseLens(page);
    // A script's click scrolls nothing itself, so only the strip's own
    // reveal can bring a chip past the strip's end into view.
    const last = WALL_LENSES.at(-1);
    assert(last !== undefined);
    const chip = page.getByRole("button", { name: last.label, exact: true });
    await chip.evaluate((button) => (button as HTMLElement).click());
    await eventually(
      page,
      () =>
        chip.evaluate((button) => {
          const strip = button.closest(".wall-lens-strip");
          if (strip === null) return false;
          const shown = strip.getBoundingClientRect();
          const box = button.getBoundingClientRect();
          return button.getAttribute("aria-pressed") === "true" &&
            box.left >= shown.left && box.right <= shown.right;
        }),
      `${size.name}: the strip brings a chosen chip wholly into view`,
    );
    await chooseLens(page);
    assertEquals(faults, [], size.name);
  });
});

Deno.test("development React hydrates without mismatches and keeps focus on the live card", async () => {
  const development = await bundleBrowserModule(
    join(fromFileUrl(new URL("../", import.meta.url)), WALL_ISLAND_ENTRY),
    { minify: false },
  );
  assert(!development.includes("Minified React error"));
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const { page, faults } = await openPage(context);
    let served = 0;
    const release = Promise.withResolvers<void>();
    await page.route(
      (url) =>
        wallIslandContentHash(
          url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
        ) !== undefined,
      async (route) => {
        served++;
        await release.promise;
        await route.fulfill({
          contentType: "text/javascript; charset=utf-8",
          body: development,
        });
      },
    );
    const card = WALL_DECK.find((each) => each.href !== undefined);
    assert(card !== undefined);
    const opener = page.locator(openerOf(card.id));
    try {
      await page.goto(`${ORIGIN}/`, { waitUntil: "commit" });
      await opener.focus();
    } finally {
      release.resolve();
    }
    await page.locator(LIVE_WALL).waitFor();
    assertEquals(served, 1);
    assert(
      await opener.evaluate((element) =>
        element instanceof HTMLButtonElement &&
        element === document.activeElement
      ),
      "the focused server link upgrades to a focused live button",
    );
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: sheetName(card), exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await sheetGone(page, "development React");
    await chooseLens(page, WALL_LENSES[0]);
    assertEquals(faults, []);
  });
});

Deno.test("reduced motion keeps the wall flat and card and lens changes usable", async () => {
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      document.startViewTransition = () => {
        throw new Error("reduced motion must not start a view transition");
      };
    });
    const { page, faults } = await openLiveWall(context);
    assertEquals(
      await page.locator(".wall-plane").evaluate((plane) =>
        getComputedStyle(plane).transform
      ),
      "none",
    );
    await scrollToWall(page);
    await chooseLens(page, WALL_LENSES[0]);
    const opener = page.locator(".wall-card-open").first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator(OPEN_SHEET).waitFor();
    await page.keyboard.press("Escape");
    await sheetGone(page, "reduced motion");
    assertEquals(faults, []);
  });
});

Deno.test("keyboard visitors can skip the cards or open one and return to it", async () => {
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const { page, faults } = await openLiveWall(context);
    await page.locator(".wall-pool .wall-cta").focus();
    await page.keyboard.press("Tab");
    assert(
      await page.locator(".wall-pool .wall-copy").evaluate((element) =>
        element === document.activeElement
      ),
      "the pool's copy control follows its link",
    );
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", {
      name: "Skip the cards",
      exact: true,
    });
    assert(
      await skip.evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press("Enter");
    assert(
      await page.locator("#wall-closing-title").evaluate((element) =>
        element === document.activeElement
      ),
    );
    const opener = page.locator(".wall-card-open").first();
    await opener.focus();
    await page.keyboard.press("Enter");
    await page.locator(OPEN_SHEET).waitFor();
    assert(
      await page.getByRole("button", { name: "Close", exact: true }).evaluate((
        element,
      ) => element === document.activeElement),
    );
    await page.keyboard.press("Escape");
    await sheetGone(page, "keyboard");
    assert(
      await opener.evaluate((element) => element === document.activeElement),
    );
    await page.locator(NEAR_WALL).waitFor();
    assertEquals(faults, []);
  });
});

Deno.test("each copy control puts the setup prompt on the clipboard, says so, and returns to its label", async () => {
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { page, faults } = await openLiveWall(context);
    const status = page.locator(".wall-copy-status");
    const labelled = page.getByRole("button", {
      name: COPY_LABEL,
      exact: true,
    });
    assertEquals(await labelled.count(), 2);
    for (const section of [".wall-pool", ".wall-closing"]) {
      await page.evaluate(() => navigator.clipboard.writeText(""));
      const control = page.locator(`${section} .wall-copy`);
      const place = await control.boundingBox();
      await control.click();
      await page.getByRole("button", { name: COPIED_LABEL, exact: true })
        .waitFor();
      assertEquals(
        await page.evaluate(() => navigator.clipboard.readText()),
        SETUP_PROMPT,
        section,
      );
      assertEquals(await status.textContent(), COPY_STATUS.copied, section);
      assertEquals(
        (await control.boundingBox())?.width,
        place?.width,
        `${section}: the control keeps its width while it says that it copied`,
      );
      await eventually(
        page,
        async () => await labelled.count() === 2,
        `${section}: the control never returns to its label`,
      );
      assertEquals(await status.textContent(), "", section);
    }
    assertEquals(faults, []);
  });
});

Deno.test("a refused copy selects the prompt for the visitor, says so, and raises no fault", async () => {
  const refusals = {
    "a clipboard that refuses": (): void => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: () =>
            Promise.reject(new DOMException("refused", "NotAllowedError")),
        },
      });
    },
    "no clipboard at all": (): void => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
    },
    "a clipboard that never answers": (): void => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => new Promise<void>(() => {}) },
      });
    },
  };
  for (const [refusal, refuse] of Object.entries(refusals)) {
    await withBrowser(async (browser) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      await context.addInitScript(refuse);
      const { page, faults } = await openLiveWall(context);
      // The pool's control is a whole wall away from the prompt's words.
      await page.locator(".wall-pool .wall-copy").click();
      await page.getByText(COPY_STATUS.refused, { exact: true }).waitFor();
      assertEquals(
        await page.evaluate(() => getSelection()?.toString()),
        SETUP_PROMPT,
        `${refusal}: the prompt is selected, ready to copy by hand`,
      );
      assert(
        await page.locator(PROMPT_WORDS).evaluate((words) => {
          const box = words.getBoundingClientRect();
          return words === document.activeElement && box.top >= 0 &&
            box.bottom <= innerHeight;
        }),
        `${refusal}: the prompt's words hold the focus, in view`,
      );
      assertEquals(
        await page.getByRole("button", { name: COPY_LABEL, exact: true })
          .count(),
        2,
        `${refusal}: no control says that it copied`,
      );
      assertEquals(faults, [], refusal);
    });
  }
});

Deno.test("the requested tuning panel changes a knob and can reset it", async () => {
  const knob = WALL_KNOBS.find((each) => each.name === "gap");
  assert(knob !== undefined);
  await withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const { page, faults } = await openPage(context);
    await page.goto(`${ORIGIN}/?tune`);
    const panel = page.locator(".wall-tune");
    await panel.waitFor();
    const property = wallKnobProperty(knob.name);
    const written = (): Promise<string> =>
      page.locator(".wall").evaluate(
        (wall, name) => (wall as HTMLElement).style.getPropertyValue(name),
        property,
      );
    assertEquals(await written(), `${knob.default}${knob.unit}`);
    await panel.locator(".wall-tune-row").filter({ hasText: knob.label })
      .locator("input").focus();
    await page.keyboard.press("End");
    assertEquals(await written(), `${knob.max}${knob.unit}`);
    await panel.getByRole("button", { name: "Reset", exact: true }).click();
    assertEquals(await written(), `${knob.default}${knob.unit}`);
    assertEquals(faults, []);
  });
});
