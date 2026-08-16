/**
 * Canonical registry for authored public marketing pages.
 *
 * Serving, building, and site-prose enrollment all derive from this table. A
 * future marketing route therefore cannot join the site without also naming
 * its authored source, register, and prose policy.
 */

export interface MarketingPage {
  readonly route: string;
  readonly page: string;
  readonly source: string;
  readonly negotiable: boolean;
  readonly register: "brand";
  readonly prose: "guarded" | "copy-neutral";
}

export const MARKETING_PAGES = [{
  route: "/",
  page: "pages/index.html",
  source: "site/page-src/landing.tsx",
  negotiable: true,
  register: "brand",
  prose: "guarded",
}, {
  route: "/old",
  page: "pages/old.html",
  source: "site/page-src/landing.tsx",
  negotiable: false,
  register: "brand",
  prose: "guarded",
}, {
  route: "/lipsum",
  page: "pages/lipsum.html",
  source: "site/page-src/lipsum.ts",
  negotiable: false,
  register: "brand",
  prose: "copy-neutral",
}] as const satisfies readonly MarketingPage[];

export type MarketingPageRoute = typeof MARKETING_PAGES[number]["route"];
