/** Real-browser accessibility audits sample colours only once motion settles. */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { axeFindings, launchBrowser } from "./browser_helpers.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const TEST_MODULES = await structuralGuardScope({
  guard: "tests/browser_axe_settling_guard_test.ts#axe-in-a-real-page",
  universe: "authored-ts",
  narrow: {
    reason:
      "Browser accessibility audits run only from test code; production sources never inject axe.",
    include: (rel) => rel.startsWith("tests/"),
  },
});

Deno.test("a real-page axe audit goes through the helper that waits for transitions", async () => {
  const bypasses: string[] = [];
  for (const rel of TEST_MODULES) {
    if (rel === "tests/browser_helpers.ts") continue;
    const source = await Deno.readTextFile(join(ROOT, rel));
    if (/\.evaluate\(\s*axe\.source\b/.test(source)) bypasses.push(rel);
  }
  assertEquals(
    bypasses,
    [],
    "audit a Playwright page with axeFindings(), which settles transitions first",
  );
});

/** Every kind of motion a page can carry: scroll-, view- and clock-driven, finite and infinite. */
const MOTION_PAGE = `<!doctype html>
<html lang="en">
<head>
<title>Motion</title>
<style>
  @keyframes fade { from { opacity: 0.5; } to { opacity: 1; } }
  .scroller { height: 4rem; overflow: auto; }
  .scroller p { animation: fade linear both; animation-timeline: scroll(); }
  .viewed { animation: fade linear both; animation-timeline: view(); }
  .spinning { animation: fade 1s linear infinite; }
</style>
</head>
<body>
<main>
  <div class="scroller" tabindex="0" role="region" aria-label="Scrolling text">
    <p>${"Scroll-driven text. ".repeat(80)}</p>
  </div>
  <p class="viewed">View-driven text.</p>
  <p class="spinning">Infinite text.</p>
  <p class="settling">Clock-driven text.</p>
</main>
</body>
</html>`;

Deno.test("the axe audit waits for finite clock-driven motion and never for scroll-driven, view-driven, or infinite motion", async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(5_000);
    const page = await context.newPage();
    await page.setContent(MOTION_PAGE);
    await page.evaluate(() => {
      const settling = document.querySelector(".settling");
      if (!settling) throw new Error("the clock-driven specimen is missing");
      (globalThis as { settling?: Animation }).settling = settling.animate(
        [{ opacity: 0.5 }, { opacity: 1 }],
        1_000,
      );
    });
    const timelines = await page.evaluate(() =>
      document.getAnimations().map((animation) =>
        animation.timeline?.constructor.name ?? "none"
      )
    );
    for (const kind of ["ScrollTimeline", "ViewTimeline", "DocumentTimeline"]) {
      assert(
        timelines.includes(kind),
        `the specimen page runs a ${kind} animation (saw ${timelines})`,
      );
    }
    await axeFindings(page);
    assertEquals(
      await page.evaluate(() =>
        (globalThis as { settling?: Animation }).settling?.playState
      ),
      "finished",
      "the audit starts only after finite clock-driven motion finishes",
    );
  } finally {
    await browser.close();
  }
});
