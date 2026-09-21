/** The launch URL, metadata, discovery, and security contract. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import {
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
  SELF_TITLED_PAGES,
} from "../site/brand.ts";
import { siteRoutes } from "../site/routes.ts";
import { loadDocsSite } from "../site/docs.tsx";
import {
  handler,
  handlerWithRouting,
  liveHtmlRoutes,
  PAGES,
} from "../site/serve.ts";
import {
  buildSiteRedirectTable,
  canonicalUrl,
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  SITE_ORIGIN,
} from "../site/seo.tsx";
import { unescapeHtml } from "../src/lib/markdown.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
};

/** Serve one production-origin route with browser defaults unless a redirect case overrides them. */
function request(
  path: string,
  init: RequestInit = { headers: BROWSER },
): Promise<Response> {
  return handler(new Request(`${SITE_ORIGIN}${path}`, init));
}

/** Select an SEO tag and extract one quoted attribute from it. */
function attr(
  html: string,
  selector: RegExp,
  name: string,
): string | undefined {
  const tag = selector.exec(html)?.[0];
  return tag?.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"))?.[2];
}

/** Extract and decode the document title emitted by the SEO renderer. */
function titleOf(html: string): string {
  return unescapeHtml(
    /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "",
  );
}

/** Extract and decode the named description meta tag's content. */
function descriptionOf(html: string): string {
  return unescapeHtml(
    attr(
      html,
      /<meta\s+[^>]*name=["']description["'][^>]*>/i,
      "content",
    ) ?? "",
  );
}

/** Decode the entity subset emitted in site metadata before semantic comparison. */

/** Extract the canonical link target, treating an absent tag as empty evidence. */
function canonicalOf(html: string): string {
  return attr(
    html,
    /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
    "href",
  ) ?? "";
}

Deno.test("canonical path and production-domain variants redirect once with 308", async () => {
  const site = await loadDocsSite();
  const page = site.pages[0];
  assert(page !== undefined);

  const variants = [
    ["/docs/", canonicalUrl("/docs")],
    ["/docs/index.html", canonicalUrl("/docs")],
    [`${page.route}/`, canonicalUrl(page.route)],
    [`${page.route}/index.html`, canonicalUrl(page.route)],
    [`${page.route}.html`, canonicalUrl(page.route)],
    ["/index.html", canonicalUrl("/")],
  ] as const;
  for (const [path, location] of variants) {
    const response = await request(path);
    assertEquals(response.status, 308, path);
    assertEquals(response.headers.get("location"), location, path);
  }
  for (const path of ["/never-existed/", "/never-existed/index.html"]) {
    assertEquals((await request(path)).status, 404, path);
  }

  const query = await request("/docs/?from=old");
  assertEquals(query.status, 308);
  assertEquals(
    query.headers.get("location"),
    `${canonicalUrl("/docs")}?from=old`,
  );

  for (const url of ["http://discern.sh/docs", "https://www.discern.sh/docs"]) {
    const response = await handler(new Request(url, { headers: BROWSER }));
    assertEquals(response.status, 308, url);
    assertEquals(response.headers.get("location"), canonicalUrl("/docs"));
  }
});

Deno.test("a destination-owned redirect_from fixture serves HTML and Markdown in one hop", async () => {
  const site = await loadDocsSite();
  const target = site.pages[0];
  assert(target !== undefined);
  const pages = site.pages.map((page) =>
    page.route === target.route
      ? {
        ...page,
        entry: { ...page.entry, redirectFrom: ["/docs/retired-fixture"] },
      }
      : page
  );
  const liveRoutes = liveHtmlRoutes(site);
  const redirects = buildSiteRedirectTable(liveRoutes, pages);
  assertEquals(redirects.issues, []);
  const routing = { site, liveRoutes, redirects };

  const html = await handlerWithRouting(
    new Request(`${SITE_ORIGIN}/docs/retired-fixture/`, { headers: BROWSER }),
    routing,
  );
  assertEquals(html.status, 308);
  assertEquals(html.headers.get("location"), canonicalUrl(target.route));

  const markdown = await handlerWithRouting(
    new Request(`${SITE_ORIGIN}/docs/retired-fixture.md`, { headers: BROWSER }),
    routing,
  );
  assertEquals(markdown.status, 308);
  assertEquals(
    markdown.headers.get("location"),
    canonicalUrl(`${target.route}.md`),
  );

  // A declared redirect_from hop preserves the request's query string.
  const withQuery = await handlerWithRouting(
    new Request(`${SITE_ORIGIN}/docs/retired-fixture?from=old`, {
      headers: BROWSER,
    }),
    routing,
  );
  assertEquals(withQuery.status, 308);
  assertEquals(
    withQuery.headers.get("location"),
    `${canonicalUrl(target.route)}?from=old`,
  );
});

Deno.test("redirect guards reject dead targets, collisions, chains, and loops", () => {
  const dead = buildSiteRedirectTable(
    ["/docs/live"],
    [],
    { "/docs/old": "/docs/missing" },
  );
  assert(dead.issues.some((issue) => issue.includes("not a live route")));

  const collision = buildSiteRedirectTable(
    ["/docs/live"],
    [],
    { "/docs/live": "/docs/live" },
  );
  assert(collision.issues.some((issue) => issue.includes("collides")));

  const chain = buildSiteRedirectTable(
    ["/docs/live"],
    [],
    { "/docs/a": "/docs/b", "/docs/b": "/docs/live" },
  );
  assert(chain.issues.some((issue) => issue.includes("redirect chain")));

  const loop = buildSiteRedirectTable(
    ["/docs/live"],
    [],
    { "/docs/a": "/docs/b", "/docs/b": "/docs/a" },
  );
  assert(loop.issues.some((issue) => issue.includes("redirect chain")));
});

Deno.test("sitemap and robots derive exactly from the live HTML route projection", async () => {
  const site = await loadDocsSite();
  const expected = liveHtmlRoutes(site).map(canonicalUrl);
  const response = await request("/sitemap.xml");
  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type") ?? "", "xml");
  const xml = await response.text();
  const actual = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) =>
    match[1] ?? ""
  );
  assertEquals(actual, expected);
  assert(
    actual.every((url) =>
      !url.endsWith(".md") &&
      (url === `${SITE_ORIGIN}/` || !url.endsWith("/"))
    ),
  );

  const robots = await request("/robots.txt");
  assertEquals(robots.status, 200);
  assertStringIncludes(
    await robots.text(),
    `Sitemap: ${canonicalUrl("/sitemap.xml")}`,
  );
});

Deno.test("every public HTML route has canonical, bounded social metadata and the required JSON-LD", async () => {
  const site = await loadDocsSite();
  const docsTitles = new Map(site.pages.map((page) => [
    page.route,
    `${page.entry.title} · discern.sh docs`,
  ]));
  docsTitles.set(
    "/docs",
    `${site.landing.entry.title} · discern.sh docs`,
  );
  docsTitles.set(
    site.decisions.route,
    "Project decisions · discern.sh docs",
  );
  for (const page of site.decisions.pages) {
    docsTitles.set(page.route, `${page.entry.title} · discern.sh docs`);
  }
  const mapTitles = new Map([
    [
      site.publicMap.landing.route,
      `${site.publicMap.landing.entry.title} · discern.sh Map`,
    ],
  ]);
  const routes = liveHtmlRoutes(site);
  const seenTitles = new Set<string>();

  for (const route of routes) {
    const response = await request(route);
    assertEquals(response.status, 200, route);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "text/html",
    );
    assertEquals(
      response.headers.get("link"),
      `<${canonicalUrl(route)}>; rel="canonical"`,
      route,
    );
    assertEquals(
      response.headers.get("deno-cdn-cache-control"),
      new TextEncoder().encode(`<${canonicalUrl(route)}>; rel="canonical"`)
          .length >= 128
        ? "no-store"
        : null,
      route,
    );
    const html = await response.text();
    const title = titleOf(html);
    const description = descriptionOf(html);
    assert(title.length > 0, `${route} has a title`);
    const exactTitle = SELF_TITLED_PAGES[route];
    if (exactTitle !== undefined) {
      assertEquals(title, exactTitle);
      assert(
        !title.endsWith(" · discern.sh docs"),
        `${route} carries its own exact title`,
      );
    } else {
      const suffix = route === "/map" || route.startsWith("/map/")
        ? " · discern.sh Map"
        : " · discern.sh docs";
      assert(
        title.endsWith(suffix),
        `${route} follows the site title template`,
      );
    }
    assert(!seenTitles.has(title), `${route} has unique title ${title}`);
    seenTitles.add(title);
    const expectedDocsTitle = docsTitles.get(route);
    if (expectedDocsTitle !== undefined) assertEquals(title, expectedDocsTitle);
    const expectedMapTitle = mapTitles.get(route);
    if (expectedMapTitle !== undefined) assertEquals(title, expectedMapTitle);
    assert(
      description.length >= META_DESCRIPTION_MIN &&
        description.length <= META_DESCRIPTION_MAX,
      `${route} description length ${description.length}`,
    );
    assertEquals(canonicalOf(html), canonicalUrl(route), route);
    assertStringIncludes(html, '<meta property="og:title"', route);
    assertStringIncludes(html, '<meta property="og:description"', route);
    assertStringIncludes(html, '<meta property="og:image"', route);
    assertStringIncludes(html, '<meta name="twitter:card"', route);
    assert(
      !/<script\b[^>]*src=["']https?:\/\//i.test(html),
      `${route} has no third-party script request`,
    );
    assert(
      !/<link\b(?=[^>]*rel=["'](?:stylesheet|preconnect)["'])(?=[^>]*href=["']https?:\/\/)[^>]*>/i
        .test(html),
      `${route} has no third-party stylesheet or preconnect request`,
    );
    if (route === "/") {
      assertStringIncludes(html, '"@type":"SoftwareApplication"');
    }
    if (
      route === "/docs" || route.startsWith("/docs/") || route === "/map" ||
      route.startsWith("/map/")
    ) {
      assertStringIncludes(html, '"@type":"BreadcrumbList"', route);
      assert(!html.includes('"name":"Documentation · discern.sh docs"'));
    }
  }

  const card = await request("/assets/og-card.png");
  assertEquals(card.status, 200);
  assertEquals(card.headers.get("content-type"), "image/png");

  const cardSource = await Deno.readTextFile(
    new URL("../site/pages/assets/og-card.svg", import.meta.url),
  );
  assertStringIncludes(cardSource, `d="${DISCERN_MARK_FILLED_PATH}"`);
  assertStringIncludes(cardSource, `d="${DISCERN_MARK_OUTLINE_PATH}"`);
  assert(!cardSource.includes("m22 45 15 14 26-32"));
});

Deno.test("every explicit Markdown edition declares its HTML canonical and noindex policy", async () => {
  const site = await loadDocsSite();
  for (
    const edition of siteRoutes(site).filter((entry) =>
      entry.format === "markdown"
    )
  ) {
    const route = edition.path.slice(0, -".md".length);
    const response = await request(edition.path);
    assertEquals(response.status, 200, route);
    assertEquals(
      response.headers.get("link"),
      `<${canonicalUrl(route)}>; rel="canonical"`,
      route,
    );
    assertEquals(response.headers.get("x-robots-tag"), "noindex, follow");
    assertEquals(
      response.headers.get("deno-cdn-cache-control"),
      new TextEncoder().encode(`<${canonicalUrl(route)}>; rel="canonical"`)
          .length >= 128
        ? "no-store"
        : null,
      route,
    );
    assertEquals(response.headers.get("cache-control"), "public, max-age=300");
    await response.body?.cancel();
  }
});

Deno.test("llms-full is the public full-fidelity projection without frontmatter", async () => {
  const site = await loadDocsSite();
  const response = await request("/llms-full.txt");
  assertEquals(response.status, 200);
  const full = await response.text();
  assertStringIncludes(full, "# discern\n\n> ");
  assertStringIncludes(full, "[ADR ");
  assertStringIncludes(full, `<!-- BEGIN ${canonicalUrl("/docs")} -->`);
  for (const page of site.pages) {
    assertStringIncludes(full, `<!-- BEGIN ${canonicalUrl(page.route)} -->`);
  }
  assert(!full.includes("redirect_from:"));
});

Deno.test("security headers cover pages, assets, machine routes, redirects, errors, and methods", async () => {
  const cases = [
    await request("/docs"),
    await request("/docs.md"),
    await request("/assets/og-card.png"),
    await request("/sitemap.xml"),
    await request("/docs/"),
    await request("/no-such-page"),
    await request("/", { method: "POST", headers: BROWSER }),
  ];
  for (const response of cases) {
    const csp = response.headers.get("content-security-policy") ?? "";
    assertStringIncludes(csp, "default-src 'self'");
    assertStringIncludes(csp, "frame-ancestors 'none'");
    assertStringIncludes(csp, "script-src 'self' 'nonce-");
    assert(!csp.includes("https:"), "CSP admits no third-party request origin");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(response.headers.get("referrer-policy"), "no-referrer");
    assertMatch(
      response.headers.get("permissions-policy") ?? "",
      /camera=\(\)/,
    );
    assertEquals(response.headers.get("x-frame-options"), "DENY");
  }

  const docs = await request("/docs");
  const csp = docs.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
  assert(nonce !== undefined);
  assertStringIncludes(await docs.text(), `<script nonce="${nonce}">`);
});

Deno.test("insecure-request upgrading applies to secure responses only", async () => {
  const secure = await request("/docs");
  assertStringIncludes(
    secure.headers.get("content-security-policy") ?? "",
    "upgrade-insecure-requests",
  );

  // A plain-HTTP loopback preview must not upgrade its own asset requests:
  // Safari applies the directive even on localhost, where https cannot answer.
  const local = await handler(
    new Request("http://localhost:8000/docs", { headers: BROWSER }),
  );
  assertEquals(local.status, 200);
  const csp = local.headers.get("content-security-policy") ?? "";
  assertStringIncludes(csp, "default-src 'self'");
  assert(!csp.includes("upgrade-insecure-requests"));
});

Deno.test("every declared page remains part of the canonical route set", async () => {
  const site = await loadDocsSite();
  const live = new Set(liveHtmlRoutes(site));
  for (const route of Object.keys(PAGES)) assert(live.has(route));
});
