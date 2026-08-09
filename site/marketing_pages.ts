/**
 * Canonical registry for authored public marketing pages.
 *
 * Serving, building, and the site-prose corpus all derive from this table. A
 * future marketing route therefore cannot join the site without also naming
 * the authored source and register that its prose guards inspect.
 */

export interface MarketingPage {
  readonly route: string;
  readonly page: string;
  readonly source: string;
  readonly negotiable: boolean;
  readonly register: "brand";
}

export const MARKETING_PAGES = [{
  route: "/",
  page: "pages/index.html",
  source: "site/page-src/landing.tsx",
  negotiable: true,
  register: "brand",
}] as const satisfies readonly MarketingPage[];

export type MarketingPageRoute = typeof MARKETING_PAGES[number]["route"];
