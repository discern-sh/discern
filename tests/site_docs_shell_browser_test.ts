/**
 * Real-layout docs shell checks. The package drawer decides when the
 * navigation is a drawer from a container query, which a layoutless DOM
 * cannot evaluate, so the consumer's modal contract runs in a browser
 * against the production handler: activation, open, focus wrap, dismissal,
 * the breakpoint crossing, the skip link, and the no-JavaScript fallback.
 */
import { assert, assertEquals } from "@std/assert";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { handler } from "../site/serve.ts";
import {
  axeFindings,
  launchBrowser,
  serveThroughHandler,
} from "./browser_helpers.ts";

const ORIGIN = "http://127.0.0.1:18899";
const NARROW = { width: 720, height: 800 };
const WIDE = { width: 1400, height: 800 };
const NAVIGATION_ID = "docs-nav";

/** Every reachable control outside the drawer, the toggle, and the veil. */
const BACKGROUND_SELECTORS = [
  ".docs-skip",
  ".docs-brand",
  ".docs-brand-docs",
  "[data-discern-search-palette-open]",
  "[data-discern-theme-toggle]",
  "#doc",
] as const;

interface DrawerState {
  readonly expanded: string | null;
  readonly label: string | null;
  readonly toggleHidden: boolean;
  readonly role: string | null;
  readonly modal: string | null;
  readonly navLabel: string | null;
  readonly navInert: boolean;
  readonly backgroundInert: boolean;
  readonly focusInNavigation: boolean;
  readonly focusOnToggle: boolean;
}

/** Serve every request through the production handler. */
async function openContext(
  browser: Browser,
  options: { readonly javaScriptEnabled: boolean },
): Promise<{ context: BrowserContext; page: Page; failures: string[] }> {
  const context = await browser.newContext({
    viewport: NARROW,
    javaScriptEnabled: options.javaScriptEnabled,
  });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();
  await serveThroughHandler(page, ORIGIN, handler);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  return { context, page, failures };
}

/** Read the drawer's accessibility state as a reader's assistive technology sees it. */
function drawerState(page: Page): Promise<DrawerState> {
  return page.evaluate(
    ([navigationId, backgroundSelectors]) => {
      const toggle = document.querySelector<HTMLElement>(
        "[data-discern-docs-drawer-toggle]",
      );
      const nav = document.getElementById(navigationId);
      if (!toggle || !nav) throw new Error("the drawer fixture is incomplete");
      const background = backgroundSelectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`no background element ${selector}`);
        return element;
      });
      const active = document.activeElement;
      return {
        expanded: toggle.getAttribute("aria-expanded"),
        label: toggle.getAttribute("aria-label"),
        toggleHidden: toggle.hidden === true,
        role: nav.getAttribute("role"),
        modal: nav.getAttribute("aria-modal"),
        navLabel: nav.getAttribute("aria-label"),
        navInert: nav.inert,
        backgroundInert: background.every((element) =>
          element.inert || element.closest("[inert]") !== null
        ),
        focusInNavigation: active !== null && nav.contains(active),
        focusOnToggle: active === toggle,
      };
    },
    [NAVIGATION_ID, BACKGROUND_SELECTORS] as const,
  );
}

/** Wait until the layout reports the drawer state the stylesheet decided on. */
async function drawerSettled(
  page: Page,
  state: "open" | "closed" | null,
): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      (document.querySelector("[data-discern-docs-layout]")?.getAttribute(
        "data-discern-docs-drawer",
      ) ?? null) === expected,
    state,
  );
}

const CLOSED_NARROW = {
  expanded: "false",
  label: "Open navigation",
  toggleHidden: false,
  role: null,
  modal: null,
  navLabel: null,
  navInert: true,
  backgroundInert: false,
  focusInNavigation: false,
} as const;

Deno.test("the served docs shell keeps its drawer, skip link, and no-script contracts in a browser", async (test) => {
  // One browser serves both contexts; each step opens its own.
  const browser = await launchBrowser();
  try {
    await test.step(
      "the docs drawer performs the complete modal focus contract",
      async () => {
        const { context, page, failures } = await openContext(browser, {
          javaScriptEnabled: true,
        });
        try {
          await page.goto(`${ORIGIN}/docs`);
          await drawerSettled(page, "closed");
          assertEquals(await drawerState(page), {
            ...CLOSED_NARROW,
            focusOnToggle: false,
          });

          // The skip link is the first stop and lands on the layout's main.
          await page.keyboard.press("Tab");
          assertEquals(
            await page.locator(":focus").getAttribute("href"),
            "#doc",
          );
          await page.keyboard.press("Enter");
          assertEquals(await page.evaluate(() => location.hash), "#doc");

          const toggle = page.locator("[data-discern-docs-drawer-toggle]");
          await toggle.focus();
          await toggle.click();
          await drawerSettled(page, "open");
          await page.waitForFunction(
            (navigationId) =>
              document.getElementById(navigationId)?.contains(
                document.activeElement,
              ) === true,
            NAVIGATION_ID,
          );
          assertEquals(await drawerState(page), {
            expanded: "true",
            label: "Close navigation",
            toggleHidden: false,
            role: "dialog",
            modal: "true",
            navLabel: "Manual navigation",
            navInert: false,
            backgroundInert: true,
            focusInNavigation: true,
            focusOnToggle: false,
          });
          assertEquals(
            await page.evaluate(
              (navigationId) =>
                document.activeElement ===
                  document.getElementById(navigationId)?.querySelector(
                    "a[href]",
                  ),
              NAVIGATION_ID,
            ),
            true,
            "focus moves to the first navigation link",
          );

          // Tab wraps between the toggle and the navigation's last focusable.
          await page.locator(`#${NAVIGATION_ID} a[href]`).last().focus();
          await page.keyboard.press("Tab");
          assertEquals((await drawerState(page)).focusOnToggle, true);
          await page.keyboard.press("Shift+Tab");
          assertEquals(
            await page.evaluate((navigationId) => {
              const links = document.getElementById(navigationId)
                ?.querySelectorAll(
                  "a[href]",
                );
              return document.activeElement === links?.[links.length - 1];
            }, NAVIGATION_ID),
            true,
            "Shift+Tab from the toggle reaches the last navigation link",
          );

          // The open drawer is a valid dialog to an automated audit.
          assertEquals(await axeFindings(page), []);

          await page.keyboard.press("Escape");
          await drawerSettled(page, "closed");
          assertEquals(await drawerState(page), {
            ...CLOSED_NARROW,
            focusOnToggle: true,
          });

          // Search yields the drawer: the palette opens over a closed drawer and
          // hands focus back to the toggle once it closes.
          await toggle.click();
          await drawerSettled(page, "open");
          await page.keyboard.press("Meta+k");
          await drawerSettled(page, "closed");
          assertEquals(
            await page.evaluate(() =>
              document.querySelector<HTMLDialogElement>(
                "[data-discern-search-palette]",
              )?.open
            ),
            true,
            "the palette opens once the drawer has closed",
          );
          await page.keyboard.press("Escape");
          // The dialog's close event, where the site restores focus, follows
          // the open attribute's removal by a task.
          await page.waitForFunction(() =>
            document.querySelector<HTMLDialogElement>(
                "[data-discern-search-palette]",
              )?.open === false &&
            document.activeElement ===
              document.querySelector("[data-discern-docs-drawer-toggle]")
          );
          assertEquals(await drawerState(page), {
            ...CLOSED_NARROW,
            focusOnToggle: true,
          });

          // Crossing the breakpoint while open closes without moving focus; a
          // wide navigation is never inert or toggled.
          await toggle.click();
          await drawerSettled(page, "open");
          await page.setViewportSize(WIDE);
          await drawerSettled(page, null);
          assertEquals(await drawerState(page), {
            expanded: "false",
            label: "Open navigation",
            toggleHidden: true,
            role: null,
            modal: null,
            navLabel: null,
            navInert: false,
            backgroundInert: false,
            focusInNavigation: true,
            focusOnToggle: false,
          });
          await page.setViewportSize(NARROW);
          await drawerSettled(page, "closed");
          assertEquals(
            (await drawerState(page)).navInert,
            true,
            "a narrow navigation is inert until opened",
          );
          assertEquals(failures, []);
        } finally {
          await context.close();
        }
      },
    );

    await test.step(
      "without JavaScript the navigation stays in flow above the document",
      async () => {
        const { context, page } = await openContext(browser, {
          javaScriptEnabled: false,
        });
        try {
          await page.goto(`${ORIGIN}/docs`);
          const facts = await page.evaluate((navigationId) => {
            const nav = document.getElementById(navigationId);
            const main = document.getElementById("doc");
            const toggle = document.querySelector<HTMLElement>(
              "[data-discern-docs-drawer-toggle]",
            );
            const search = document.querySelector<HTMLElement>(
              "[data-discern-search-palette-open]",
            );
            if (!nav || !main || !toggle || !search) {
              throw new Error("the no-script fixture is incomplete");
            }
            return {
              navigationAboveDocument: nav.getBoundingClientRect().bottom <=
                main.getBoundingClientRect().top,
              navigationInert: nav.inert,
              navigationVisible: nav.getClientRects().length > 0,
              toggleShown: toggle.getClientRects().length > 0,
              searchShown: search.getClientRects().length > 0,
            };
          }, NAVIGATION_ID);
          assertEquals(facts, {
            navigationAboveDocument: true,
            navigationInert: false,
            navigationVisible: true,
            toggleShown: false,
            searchShown: false,
          });
          assert(
            await page.evaluate(() =>
              document.documentElement.scrollWidth <= innerWidth
            ),
            "the shell reflows within a narrow viewport",
          );
        } finally {
          await context.close();
        }
      },
    );
  } finally {
    await browser.close();
  }
});
