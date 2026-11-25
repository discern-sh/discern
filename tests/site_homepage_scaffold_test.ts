/** Guards for the thin homepage route adapter. */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderLanding } from "../site/ui/pages/HomePage.tsx";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

Deno.test("the homepage has static landmarks, a manual action, and local assets", async () => {
  const dom = new JSDOM(renderLanding());
  const document = dom.window.document;
  for (const landmark of ["body > header", "main", "body > footer", "h1"]) {
    assertEquals(document.querySelectorAll(landmark).length, 1, landmark);
  }
  assert(document.querySelector('main a[href="/docs/start"]'));
  for (
    const asset of document.querySelectorAll(
      "link[rel=stylesheet], script[src]",
    )
  ) {
    const path = asset.getAttribute("href") ?? asset.getAttribute("src") ?? "";
    assert(path.startsWith("/assets/"), path);
    const stat = await Deno.stat(join(ROOT, "site/pages", path));
    assert(stat.isFile, path);
  }
  dom.window.close();
});
