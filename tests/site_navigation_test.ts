/** Every public React composition inherits the shared site navigation. */
import { assert, assertEquals } from "@std/assert";
import { JSDOM } from "jsdom";
import { loadDocsSite } from "../site/docs.tsx";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { SITE_ENDPOINTS } from "../site/routes.ts";
import {
  navigationCurrent,
  SITE_FOOTER_GROUPS,
  SITE_NAVIGATION,
} from "../site/navigation.ts";
import { handler } from "../site/serve.ts";

/** The package renders the current state from aria-current alone. */
const RENDERED_CURRENT = { page: "page", section: "true" } as const;

/** Compare the chrome that every route shares, apart from where the reader is. */
function withoutCurrentState(header: string): string {
  return header.replaceAll(/ aria-current="[^"]*"/g, "");
}

Deno.test("public React pages share the complete header and footer", async () => {
  const site = await loadDocsSite();
  const routes = [
    ...MARKETING_PAGES.map((page) => page.route),
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
    const navigation = document.querySelector('nav[aria-label="Site"]');
    const pageHeader = navigation?.closest("header");
    const pageFooter = document.querySelector("main + footer");
    assert(pageHeader && pageFooter, route);
    assertEquals(
      [...navigation?.querySelectorAll("a") ?? []].map((link) => ({
        label: link.textContent?.trim(),
        href: link.getAttribute("href"),
      })),
      [...SITE_NAVIGATION],
    );
    for (const group of SITE_FOOTER_GROUPS) {
      for (const link of group.links) {
        assert(
          pageFooter.querySelector(`a[href="${link.href}"]`),
          `${route}: ${link.href}`,
        );
      }
    }
    assertEquals(
      [...navigation?.querySelectorAll("a") ?? []].map((link) =>
        link.getAttribute("aria-current")
      ),
      SITE_NAVIGATION.map((item) => {
        const current = navigationCurrent(item.href, route);
        return current === undefined ? null : RENDERED_CURRENT[current];
      }),
      `${route}: the header states which destination the reader is on`,
    );
    header ??= withoutCurrentState(pageHeader.outerHTML);
    footer ??= pageFooter.outerHTML;
    assertEquals(withoutCurrentState(pageHeader.outerHTML), header, route);
    assertEquals(pageFooter.outerHTML, footer, route);
    assert(pageHeader.querySelector("button[data-discern-theme-toggle]"));
    dom.window.close();
  }
});

Deno.test("navigation states the exact page apart from the branch containing it", () => {
  assertEquals(navigationCurrent("/trust", "/trust"), "page");
  assertEquals(
    navigationCurrent("/docs", "/docs/reference/glossary"),
    "section",
  );
  assertEquals(navigationCurrent("/docs", "/docs-studio"), undefined);
  assertEquals(navigationCurrent("/releases", "/trust"), undefined);
  assertEquals(
    navigationCurrent("/", "/trust"),
    undefined,
    "a root destination never claims the branch below it",
  );
  assertEquals(
    navigationCurrent("https://example.com/docs", "/docs/guide"),
    undefined,
    "an external destination is never a branch of this site",
  );
});
