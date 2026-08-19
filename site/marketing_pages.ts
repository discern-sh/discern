/**
 * Canonical registry for authored public marketing pages.
 *
 * The site-prose checks derive their enrollment from this table. A future
 * marketing page must name its authored source, register, and prose policy.
 */

export interface MarketingPage {
  readonly route: string;
  readonly page: `pages/${string}.html`;
  readonly source: string;
  readonly register: "brand" | "agent";
  readonly prose: "guarded" | "copy-neutral";
  readonly negotiable: boolean;
}

export const MARKETING_PAGES = [
  {
    route: "/",
    page: "pages/index.html",
    source: "site/page-src/landing.tsx",
    register: "brand",
    prose: "guarded",
    negotiable: true,
  },
  {
    route: "/agents",
    page: "pages/agents.html",
    source: "site/page-src/agents.tsx",
    register: "agent",
    prose: "guarded",
    negotiable: true,
  },
] as const satisfies readonly MarketingPage[];

export type MarketingRoute = (typeof MARKETING_PAGES)[number]["route"];
