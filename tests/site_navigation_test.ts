/** Every public React composition inherits the shared site navigation. */
import { assert, assertEquals } from "@std/assert";
import { JSDOM } from "jsdom";
import { loadDocsSite } from "../site/docs.tsx";
import { MARKETING_PAGES } from "../site/marketing_pages.ts";
import { SITE_ENDPOINTS } from "../site/routes.ts";
import { SITE_FOOTER_GROUPS, SITE_NAVIGATION } from "../site/navigation.ts";
import { handler } from "../site/serve.ts";

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
    header ??= pageHeader.outerHTML;
    footer ??= pageFooter.outerHTML;
    assertEquals(pageHeader.outerHTML, header, route);
    assertEquals(pageFooter.outerHTML, footer, route);
    assert(pageHeader.querySelector("[data-theme-toggle]"));
    dom.window.close();
  }
});
