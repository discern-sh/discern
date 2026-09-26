/**
 * Real-layout homepage checks. Phones hold the hero backdrop still, in portrait
 * and in landscape, while anything larger keeps its entrance, drift, and
 * dolly. A media query decides this, which a layoutless DOM cannot evaluate, so
 * the viewports run in a browser against the production handler.
 */
import { assert, assertEquals } from "@std/assert";
import { handler } from "../site/serve.ts";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";

const ORIGIN = "http://127.0.0.1:18899";

/** Alternating postures, so every step crosses the breakpoint or holds it. */
const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844, still: true },
  { name: "laptop", width: 1440, height: 900, still: false },
  { name: "phone landscape", width: 844, height: 390, still: true },
  { name: "tablet portrait", width: 744, height: 1133, still: false },
  { name: "short desktop window", width: 1280, height: 460, still: false },
] as const;

Deno.test("phones hold the homepage hero backdrop still", async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
      reducedMotion: "no-preference",
    });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    await serveThroughHandler(page, ORIGIN, handler);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    const response = await page.goto(`${ORIGIN}/`);
    assertEquals(response?.status(), 200);
    // One load serves every viewport: resizing crosses the breakpoint live, as
    // rotating a phone does.
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      const animations = await page.locator(".homepage-backdrop").evaluate(
        (backdrop) => backdrop.getAnimations({ subtree: true }).length,
      );
      if (viewport.still) {
        assertEquals(animations, 0, `${viewport.name} should hold still`);
      } else {
        assert(animations > 0, `${viewport.name} should keep its motion`);
      }
    }
    assertEquals(failures, []);
  } finally {
    await browser.close();
  }
});
