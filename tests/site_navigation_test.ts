/** Every public React composition inherits the shared site navigation. */
import { assert, assertEquals } from "@std/assert";
import { JSDOM } from "jsdom";
import { DESIGN_SYSTEM_BUNDLES } from "../site/design_system.ts";
import { loadDocsSite } from "../site/docs.tsx";
import {
  MARKETING_PAGES,
  PUBLISHED_MARKETING_PAGES,
} from "../site/marketing_pages.ts";
import { renderMarketingPage } from "../site/renderers.ts";
import { SITE_ENDPOINTS } from "../site/routes.ts";
import {
  navigationCurrent,
  SITE_FOOTER_GROUPS,
  SITE_NAVIGATION,
} from "../site/navigation.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";
import {
  SITE_HEADER_STYLESHEET,
  VERSION_BESIDE_CONTROL_CLASS,
} from "../site/ui/components/SiteHeader.tsx";

/** The package renders the current state from aria-current alone. */
const RENDERED_CURRENT = { page: "page", section: "true" } as const;

/** Compare the chrome that every route shares, apart from where the reader is. */
function withoutCurrentState(header: string): string {
  return header.replaceAll(/ aria-current="[^"]*"/g, "");
}

/**
 * Take the theme control out of a header, with the mark the version carries
 * beside one. A document whose theme is fixed renders neither, and
 * `site_theme_test.ts` holds which routes those are.
 */
function dropThemeControl(header: Element): void {
  header.querySelector("button[data-discern-theme-toggle]")?.remove();
  header.querySelector(`.${VERSION_BESIDE_CONTROL_CLASS}`)?.classList.remove(
    VERSION_BESIDE_CONTROL_CLASS,
  );
}

/** The width at or under which a stylesheet's rule for `selector` applies. */
function narrowLimit(css: string, selector: string): string | undefined {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `@container \\(max-width:\\s*([^)]+)\\)\\s*\\{\\s*${escaped}[\\s,{]`,
  ).exec(css)?.[1]?.trim();
}

Deno.test("public React pages share the complete header and footer", async () => {
  const site = await loadDocsSite();
  const routes = [
    ...PUBLISHED_MARKETING_PAGES.map((page) => page.route),
    ...SITE_ENDPOINTS.filter((endpoint) => endpoint.format === "html").map(
      (endpoint) => endpoint.path,
    ),
    site.publicMap.landing.route,
  ];
  let header: string | undefined;
  let footer: string | undefined;
  for (const route of routes) {
    const response = await handler(
      new Request(`https://discern.sh${route}`, {
        headers: { accept: "text/html" },
      }),
    );
    assertEquals(response.status, 200);
    const dom = new JSDOM(await response.text());
    const document = dom.window.document;
    const pageHeader = document.querySelector('nav[aria-label="Site"]')
      ?.closest("header");
    const pageFooter = document.querySelector("main + footer");
    assert(pageHeader && pageFooter, route);
    // The header holds the destinations twice: the package's navigation, and
    // the short row that stands in for it in a narrow room. A stylesheet
    // shows one at a time, so both carry every destination and its state.
    const navigations = [
      ...pageHeader.querySelectorAll('nav[aria-label="Site"]'),
    ];
    assertEquals(navigations.length, 2, route);
    for (const group of SITE_FOOTER_GROUPS) {
      for (const link of group.links) {
        assert(
          pageFooter.querySelector(`a[href="${link.href}"]`),
          `${route}: ${link.href}`,
        );
      }
    }
    for (const navigation of navigations) {
      const links = [...navigation.querySelectorAll("a")];
      assertEquals(
        links.map((link) => ({
          label: link.textContent?.trim(),
          href: link.getAttribute("href"),
        })),
        [...SITE_NAVIGATION],
      );
      assertEquals(
        links.map((link) => link.getAttribute("aria-current")),
        SITE_NAVIGATION.map((item) => {
          const current = navigationCurrent(item.href, route);
          return current === undefined ? null : RENDERED_CURRENT[current];
        }),
        `${route}: the header states which destination the reader is on`,
      );
    }
    dropThemeControl(pageHeader);
    header ??= withoutCurrentState(pageHeader.outerHTML);
    footer ??= pageFooter.outerHTML;
    assertEquals(withoutCurrentState(pageHeader.outerHTML), header, route);
    assertEquals(pageFooter.outerHTML, footer, route);
    dom.window.close();
  }
});

Deno.test("the short row of destinations shows exactly where the package header hides its own", async () => {
  const packageLimit = narrowLimit(
    await Deno.readTextFile(
      new URL(
        `../site/${DESIGN_SYSTEM_BUNDLES.compositions.output}discern.css`,
        import.meta.url,
      ),
    ),
    ".discern-site-header--collapse-nav",
  );
  const siteLimit = narrowLimit(
    await Deno.readTextFile(
      new URL(
        `../site/page-src/${SITE_HEADER_STYLESHEET}`,
        import.meta.url,
      ),
    ),
    ".site-header-compact",
  );
  assert(packageLimit !== undefined, "the package header hides its navigation");
  assertEquals(
    siteLimit,
    packageLimit,
    "a different width would show both sets of destinations, or neither",
  );
});

Deno.test("every page that renders the site header loads the header's stylesheet", async () => {
  // Every marketing renderer, published or not, then every live route. The
  // header's site-owned parts are found by their class prefix, so a page
  // enrolls by rendering the header, whatever layout it reached it through.
  const pages: [route: string, html: string][] = MARKETING_PAGES.map((
    page,
  ) => [page.route, renderMarketingPage(page.route)]);
  for (const route of liveHtmlRoutes(await loadDocsSite())) {
    const response = await handler(
      new Request(`https://discern.sh${route}`, {
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
      }),
    );
    pages.push([route, await response.text()]);
  }
  const unstyled: string[] = [];
  let withHeader = 0;
  for (const [route, html] of pages) {
    const document = new JSDOM(html).window.document;
    if (document.querySelector('[class^="site-header-"]') === null) continue;
    withHeader++;
    if (
      document.querySelector(
        `link[rel="stylesheet"][href$="/${SITE_HEADER_STYLESHEET}"]`,
      ) === null
    ) unstyled.push(route);
  }
  assert(withHeader > 1, "the header's own parts are on more than one page");
  assertEquals(unstyled, []);
});

Deno.test("navigation states the exact page apart from the branch containing it", () => {
  assertEquals(navigationCurrent("/releases", "/releases"), "page");
  assertEquals(
    navigationCurrent("/docs", "/docs/reference/glossary"),
    "section",
  );
  assertEquals(navigationCurrent("/docs", "/docs-studio"), undefined);
  assertEquals(navigationCurrent("/docs", "/releases"), undefined);
  assertEquals(
    navigationCurrent("/", "/releases"),
    undefined,
    "a root destination never claims the branch below it",
  );
  assertEquals(
    navigationCurrent("https://example.com/docs", "/docs/guide"),
    undefined,
    "an external destination is never a branch of this site",
  );
});
