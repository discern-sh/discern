/** Route authorities enroll new pages, raw editions, dispatch, and atlas projections. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { loadDocsSite } from "../site/docs.tsx";
import {
  loadSiteRouteInventory,
  SITE_ENDPOINTS,
  siteRoutes,
} from "../site/routes.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";

Deno.test("public route inventory and the real sitemap share the canonical HTML set", async () => {
  const site = await loadDocsSite();
  const inventory = await loadSiteRouteInventory();
  assertEquals(
    new Set(inventory.map((route) => route.path)).size,
    inventory.length,
  );
  const html = inventory.filter((route) => route.format === "html").map(
    (route) => route.path,
  ).sort();
  assertEquals(html, liveHtmlRoutes(site).sort());
  const response = await handler(new Request("https://discern.sh/sitemap.xml"));
  const xml = await response.text();
  assertEquals(response.status, 200);
  assertEquals(
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
      new URL(match[1] ?? "").pathname
    ).sort(),
    html,
  );
});

Deno.test("new marketing and document members join route projections without copied inventories", async () => {
  const site = await loadDocsSite();
  const first = MARKETING_PAGES[0];
  const future = {
    ...first,
    route: "/future-campaign",
    page: "pages/future-campaign.html" as const,
  };
  const document = { ...site.landing, route: "/docs/start/future-document" };
  const inventory = siteRoutes({ ...site, pages: [...site.pages, document] }, [
    ...MARKETING_PAGES,
    future,
  ]);
  for (const route of [future.route, document.route, `${document.route}.md`]) {
    assert(inventory.some((entry) => entry.path === route));
  }
  assertThrows(
    () => siteRoutes(site, [...MARKETING_PAGES, first]),
    Error,
    "Duplicate public site route",
  );
});

Deno.test("every registered fixed endpoint reaches its declared response format", async () => {
  for (const endpoint of SITE_ENDPOINTS) {
    const response = await handler(
      new Request(`https://discern.sh${endpoint.path}`, {
        headers: { accept: "text/html" },
      }),
    );
    await response.arrayBuffer();
    assertEquals(response.status, 200, endpoint.path);
    const type = response.headers.get("content-type") ?? "";
    const expected = endpoint.format === "shell"
      ? "shellscript"
      : endpoint.format === "text"
      ? "text/plain"
      : endpoint.format;
    assert(type.includes(expected), `${endpoint.path}: ${type}`);
  }
});
