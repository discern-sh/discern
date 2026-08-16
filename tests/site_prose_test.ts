/** Guards for the registry-owned public-site prose corpus and launch Standards. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { renderMarketingPage } from "../site/build.ts";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import {
  COPY_PROMPT_TEXT,
  INSTALL_COMMAND,
} from "../site/page-src/landing.tsx";
import { PAGES } from "../site/serve.ts";
import { proseWordCount } from "../scripts/prose_lib.ts";
import {
  projectSiteProse,
  siteProseReadingGrade,
  siteProseSource,
  stageSiteProse,
} from "../scripts/site_prose_lib.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

Deno.test("every marketing route builds, serves, and follows its prose policy", () => {
  assertEquals(
    Object.keys(PAGES),
    MARKETING_PAGES.map(({ route }) => route),
  );
  const projected = projectSiteProse();
  assertEquals(
    projected.map(({ route }) => route),
    MARKETING_PAGES.filter(({ prose }) => prose === "guarded").map(
      ({ route }) => route,
    ),
  );
  for (const page of MARKETING_PAGES) {
    assertEquals(PAGES[page.route], {
      page: page.page,
      negotiable: page.negotiable,
    });
    assertStringIncludes(renderMarketingPage(page.route), "<!doctype html>");
    assertEquals(
      projected.some(({ route, source }) =>
        route === page.route && source === page.source
      ),
      page.prose === "guarded",
      `${page.route} follows its ${page.prose} prose policy`,
    );
  }
});

Deno.test("the preserved homepage projection measures prose once and excludes artefact data", () => {
  const pages = projectSiteProse();
  const homepage = pages.find(({ route }) => route === "/old");
  assert(homepage !== undefined);
  assertStringIncludes(
    homepage.prose,
    "An engineering practice for agent-built software",
  );
  assertEquals(
    homepage.prose.split(COPY_PROMPT_TEXT).length - 1,
    1,
    "repeated prompt output is one authored prose block",
  );
  assertEquals(homepage.prose.includes(INSTALL_COMMAND), false);
  assertEquals(homepage.prose.includes("9 August 2026"), false);
  assertEquals(homepage.prose.includes("customer benchmark"), false);
  assertEquals(siteProseReadingGrade(pages), 7.68);
});

Deno.test("the Vale numerator and denominator read the exact same staged bytes", async () => {
  const stage = await stageSiteProse(ROOT);
  try {
    let words = 0;
    for (const page of stage.pages) {
      const path = join(stage.dir, page.stagePath);
      const bytes = await Deno.readTextFile(path);
      assertEquals(bytes, page.prose);
      words += proseWordCount(bytes);
      assertEquals(siteProseSource(path, stage), resolve(ROOT, page.source));
    }
    assertEquals(stage.words, words);
    assertEquals(
      stage.pages.some(({ prose }) => prose.includes("Status: Planning")),
      false,
      "private planning copy never joins the public corpus",
    );
  } finally {
    await Deno.remove(stage.dir, { recursive: true });
  }
});
