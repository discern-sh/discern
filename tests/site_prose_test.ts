/** Guards for the registry-owned public-site prose corpus and launch Standards. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { renderAgents } from "../site/page-src/agents.tsx";
import { COPY_PROMPT_TEXT } from "../site/page-src/campaign.tsx";
import { renderLanding } from "../site/page-src/landing.tsx";
import { renderTrust } from "../site/page-src/trust.tsx";
import { proseWordCount } from "../scripts/prose_lib.ts";
import {
  projectSiteProse,
  siteProseReadingGrade,
  siteProseSource,
  withStagedSiteProse,
} from "../scripts/site_prose_lib.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

Deno.test("every marketing page follows its prose policy", () => {
  assertEquals(MARKETING_PAGES.map(({ route }) => route), [
    "/",
    "/agents",
    "/trust",
  ]);
  assertStringIncludes(renderLanding(), "<!doctype html>");
  assertStringIncludes(renderAgents(), "<!doctype html>");
  assertStringIncludes(renderTrust(), "<!doctype html>");
  const projected = projectSiteProse();
  assertEquals(
    projected.map(({ route }) => route),
    MARKETING_PAGES.filter(({ prose }) => prose === "guarded").map(
      ({ route }) => route,
    ),
  );
  for (const page of MARKETING_PAGES) {
    assertEquals(
      projected.some(({ route, source }) =>
        route === page.route && source === page.source
      ),
      page.prose === "guarded",
      `${page.route} follows its ${page.prose} prose policy`,
    );
  }
});

Deno.test("the For Agents projection uses the agent register", () => {
  const page = projectSiteProse().find(({ route }) => route === "/agents");
  assert(page !== undefined);
  assertEquals(page.stagePath, "_internal/agent/agents.md");
  assertStringIncludes(
    page.prose,
    "Finally, software where you are the user.",
  );
  assertStringIncludes(
    page.prose,
    "You should not have to infer the workflow.",
  );
});

Deno.test("the homepage projection measures prose once and excludes artefact data", () => {
  const pages = projectSiteProse();
  const homepage = pages.find(({ route }) => route === "/");
  assert(homepage !== undefined);
  assertStringIncludes(
    homepage.prose,
    "Let coding agents handle more of the work. Keep control of what ships.",
  );
  assertEquals(
    homepage.prose.split(COPY_PROMPT_TEXT).length - 1,
    1,
    "repeated prompt output is one authored prose block",
  );
  assert(siteProseReadingGrade(pages) > 0);
});

Deno.test("the Vale numerator and denominator read the exact same staged bytes", async () => {
  await withStagedSiteProse(ROOT, async (stage) => {
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
  });
});
