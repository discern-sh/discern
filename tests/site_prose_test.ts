/** Guards for the registry-owned public-site prose corpus and launch Standards. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { renderAgents } from "../site/ui/pages/AgentsPage.tsx";
import { renderLanding } from "../site/ui/pages/HomePage.tsx";
import { proseWordCount } from "../scripts/prose_lib.ts";
import {
  projectSiteProse,
  siteProseReadingGrade,
  siteProseSource,
  withStagedSiteProse,
} from "../scripts/site_prose_lib.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

Deno.test("every marketing page follows its prose policy", () => {
  assertEquals(MARKETING_PAGES.map(({ route }) => route), ["/", "/agents"]);
  assertStringIncludes(renderLanding(), "<!doctype html>");
  assertStringIncludes(renderAgents(), "<!doctype html>");
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

Deno.test("the homepage projection measures the launch headline once", () => {
  const pages = projectSiteProse();
  const homepage = pages.find(({ route }) => route === "/");
  assert(homepage !== undefined);
  assertEquals(
    homepage.prose.split("Software worth putting your name to.").length - 1,
    1,
    "the homepage headline contributes one authored prose block",
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
