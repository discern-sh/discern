/**
 * Canonical registry for authored marketing pages.
 *
 * The site-prose checks derive their enrollment from this table. A future
 * marketing page must name its authored source, register, prose policy, and
 * whether it is published. An unpublished page keeps its composition, prose
 * checks, and standards while staying off every public surface: it is not
 * built, served, listed in the sitemap, or counted as a live route.
 */

export interface MarketingPage {
  readonly route: string;
  readonly page: `pages/${string}.html`;
  readonly source: string;
  readonly register: "brand" | "agent";
  readonly prose: "guarded" | "copy-neutral";
  readonly negotiable: boolean;
  readonly published: boolean;
}

export const MARKETING_PAGES = [
  {
    route: "/",
    page: "pages/index.html",
    source: "site/ui/pages/HomePage.tsx",
    register: "brand",
    prose: "guarded",
    negotiable: true,
    published: true,
  },
  {
    route: "/agents",
    page: "pages/agents.html",
    source: "site/ui/pages/AgentsPage.tsx",
    register: "agent",
    prose: "guarded",
    negotiable: true,
    published: false,
  },
] as const satisfies readonly MarketingPage[];

export type MarketingRoute = (typeof MARKETING_PAGES)[number]["route"];

/** The members every public surface — build, serving, sitemap, routes — projects. */
export const PUBLISHED_MARKETING_PAGES: readonly (typeof MARKETING_PAGES)[
  number
][] = MARKETING_PAGES.filter((page) => page.published);
