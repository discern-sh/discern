/**
 * Canonical registry for authored public marketing pages.
 *
 * The site-prose checks derive their enrollment from this table. A future
 * marketing page must name its authored source, register, and prose policy.
 */

export interface MarketingPage {
  readonly route: string;
  readonly source: string;
  readonly register: "brand";
  readonly prose: "guarded" | "copy-neutral";
}

export const MARKETING_PAGES = [{
  route: "/",
  source: "site/page-src/landing.tsx",
  register: "brand",
  prose: "guarded",
}] as const satisfies readonly MarketingPage[];
