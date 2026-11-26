/** Route authorities enroll new pages, raw editions, dispatch, and atlas projections. */
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createElement, useLayoutEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MARKETING_PAGES,
  PUBLISHED_MARKETING_PAGES,
} from "../site/marketing_pages.ts";
import { loadDocsSite } from "../site/docs.tsx";
import {
  loadSiteRouteInventory,
  SITE_ENDPOINTS,
  siteRoutes,
} from "../site/routes.ts";
import { renderMarketingPage } from "../site/renderers.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";

/** A component only a browser should render: React's server renderer objects to its effect. */
function ClientOnly(): null {
  useLayoutEffect(() => {});
  return null;
}

/** Everything written to the console's error and warning channels while `work` runs. */
async function complaints(work: () => Promise<void> | void): Promise<string[]> {
  const heard: string[] = [];
  const { error, warn } = console;
  console.error = console.warn = (...args: unknown[]): void => {
    heard.push(args.map(String).join(" "));
  };
  try {
    await work();
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return heard;
}

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
  const first = PUBLISHED_MARKETING_PAGES[0];
  assert(first !== undefined, "at least one marketing page is published");
  const future = {
    ...first,
    route: "/future-campaign",
    page: "pages/future-campaign.html" as const,
  };
  const document = { ...site.landing, route: "/docs/start/future-document" };
  const inventory = siteRoutes({ ...site, pages: [...site.pages, document] }, [
    ...PUBLISHED_MARKETING_PAGES,
    future,
  ]);
  for (const route of [future.route, document.route, `${document.route}.md`]) {
    assert(inventory.some((entry) => entry.path === route));
  }
  assertThrows(
    () => siteRoutes(site, [...PUBLISHED_MARKETING_PAGES, first]),
    Error,
    "Duplicate public site route",
  );
});

Deno.test("an unpublished marketing page stays off every public surface", async () => {
  const unpublished = MARKETING_PAGES.filter((page) => !page.published);
  const site = await loadDocsSite();
  const live = new Set(liveHtmlRoutes(site));
  const sitemap = await (await handler(
    new Request("https://discern.sh/sitemap.xml"),
  )).text();
  for (const page of unpublished) {
    assert(!live.has(page.route), `${page.route} is not a live route`);
    assert(
      !sitemap.includes(`<loc>https://discern.sh${page.route}</loc>`),
      `${page.route} is not in the sitemap`,
    );
    for (
      const headers of [
        { accept: "text/html", "user-agent": "Mozilla/5.0" },
        { accept: "*/*", "user-agent": "curl/8.6.0" },
      ]
    ) {
      const response = await handler(
        new Request(`https://discern.sh${page.route}`, { headers }),
      );
      assertEquals(response.status, 404, `${page.route} for ${headers.accept}`);
      await response.body?.cancel();
    }
    await assertRejects(
      () => Deno.stat(new URL(`../site/${page.page}`, import.meta.url)),
      Deno.errors.NotFound,
      page.page,
    );
  }
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

Deno.test("no page the server renders draws a complaint from React", async () => {
  const site = await loadDocsSite();
  assertEquals(
    await complaints(async () => {
      // Every marketing renderer, published or not: the build runs these, and
      // the handler only serves what the build wrote.
      for (const page of MARKETING_PAGES) renderMarketingPage(page.route);
      // A path nothing serves stands in for the not-found shell.
      for (const route of [...liveHtmlRoutes(site), "/no-such-page"]) {
        await (await handler(
          new Request(`https://discern.sh${route}`, {
            headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
          }),
        )).text();
      }
    }),
    [],
  );

  // The check above holds nothing unless React's development renderer is the
  // one running and its complaints reach the console this test listens to.
  const [heard, ...others] = await complaints(() => {
    renderToStaticMarkup(createElement(ClientOnly));
  });
  assert(
    heard?.includes("useLayoutEffect") && others.length === 0,
    "React's server renderer reports a layout effect to the console",
  );
});
