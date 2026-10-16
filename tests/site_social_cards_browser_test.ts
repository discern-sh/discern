/** Social cards paint with the colours the site's dark theme actually computes. */

import { assert, assertEquals } from "@std/assert";
import { handler } from "../site/serve.ts";
import { CARD_PALETTE } from "../site/social/draw.tsx";
import { launchBrowser, serveThroughHandler } from "./browser_helpers.ts";

const ORIGIN = "https://discern.sh";

/** RGBA bytes of a hex colour at an opacity, as a canvas reads them back. */
function expected(color: string, opacity: number): number[] {
  const value = Number.parseInt(color.slice(1), 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
    Math.round(opacity * 255),
  ];
}

Deno.test("every card colour matches its site token in the dark theme", async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await serveThroughHandler(page, ORIGIN, handler);
    // A manual page carries the accent; the homepage renders in monochrome.
    await page.goto(`${ORIGIN}/docs/understand/proof`);
    const tokens = Object.values(CARD_PALETTE).map((paint) => paint.token);
    const computed = await page.evaluate((names) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      const probe = document.body.appendChild(document.createElement("span"));
      return names.map((name) => {
        probe.style.color = `var(${name})`;
        if (context === null) return [];
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
    }, tokens);
    for (const [index, paint] of Object.values(CARD_PALETTE).entries()) {
      const actual = computed[index] ?? [];
      assertEquals(actual.length, 4, paint.token);
      const want = expected(paint.color, paint.opacity);
      assert(
        actual.every((channel, i) => Math.abs(channel - (want[i] ?? 0)) <= 2),
        `${paint.token}: the site computes ${actual.join(",")}, ` +
          `the card paints ${want.join(",")}`,
      );
    }
  } finally {
    await browser.close();
  }
});
