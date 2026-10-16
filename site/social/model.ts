/**
 * What each page's social card says. Every field comes from the authority
 * that already describes the page — the brand copy, the manual and decision
 * corpora, or the release catalogue — so a card can never disagree with the
 * page it previews.
 */

import {
  AGENTS_SOCIAL,
  DISCERN_CATEGORY_LINE,
  LANDING_HEADLINE,
} from "../brand.ts";
import {
  type DecisionPage,
  type DocsPage,
  type DocsSite,
  pageKindLabel,
  PUBLIC_MAP_ROUTE,
} from "../docs.tsx";
import type { MarketingRoute } from "../marketing_pages.ts";
import { type CatalogueRecord, compareReleases } from "../releases/model.ts";
import { releaseDateLabel } from "../releases/presentation.ts";
import { DISCERN_MARK } from "../../src/shared/brand.ts";
import { RELEASE_ROUTES } from "../../src/shared/product_identity.ts";

/** A marketing page's card: one headline and its supporting line. */
export interface StatementCard {
  readonly kind: "statement";
  readonly route: string;
  readonly headline: string;
  readonly lede: string;
}

/** A document's card: where it sits, what it is called, and what it covers. */
export interface DocumentCard {
  readonly kind: "document";
  readonly route: string;
  /** The corpus prefix shown beside the brand, such as `/docs`. */
  readonly crumb: string;
  /** A manual section's reading-order number, shown in the accent colour. */
  readonly numeral?: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
}

/** The releases page's card: the newest release and what it brings. */
export interface ReleaseCard {
  readonly kind: "release";
  readonly route: string;
  readonly version: string;
  readonly codename?: string;
  readonly date?: string;
  readonly summary: string;
}

export type SocialCard = StatementCard | DocumentCard | ReleaseCard;

/** The pages a card can be drawn for, as the request handler already holds them. */
export interface SocialCardSources {
  readonly site: DocsSite;
  readonly releases: readonly CatalogueRecord[];
}

/** Each marketing page's card copy, required for every registered page. */
const STATEMENTS: Readonly<
  Record<MarketingRoute, { headline: string; lede: string }>
> = {
  "/": { headline: LANDING_HEADLINE, lede: DISCERN_CATEGORY_LINE },
  "/agents": {
    headline: AGENTS_SOCIAL.title,
    lede: AGENTS_SOCIAL.description,
  },
};

/** Typographic apostrophes and quotation marks for display text. */
function typographic(text: string): string {
  return text
    .replace(/(^|[\s([{—–-])"/gu, "$1“")
    .replace(/"/gu, "”")
    .replace(/'/gu, "’");
}

/** A document card with its display text made typographic. */
function documentCard(
  route: string,
  fields: Omit<DocumentCard, "kind" | "route">,
): DocumentCard {
  return {
    ...fields,
    kind: "document",
    route,
    title: typographic(fields.title),
    lede: typographic(fields.lede),
  };
}

/** A section and a page's purpose, naming the purpose only when the section does not. */
function sectionAndKind(section: string, kind: string): string {
  return section.toLocaleLowerCase("en").startsWith(
      kind.toLocaleLowerCase("en"),
    )
    ? section
    : `${section} · ${kind}`;
}

/** A manual page names its section and editorial purpose. */
function manualCard(site: DocsSite, page: DocsPage): DocumentCard {
  const section = site.sections.find((candidate) =>
    candidate.slug === page.sectionSlug
  );
  const sectionNumeral = section?.dir.match(/^(\d+)-/)?.[1];
  return documentCard(page.route, {
    crumb: "/docs",
    ...(sectionNumeral === undefined ? {} : { numeral: sectionNumeral }),
    eyebrow: page.isIndex || section === undefined
      ? "Manual"
      : sectionAndKind(section.title, pageKindLabel(page)),
    title: page.entry.title,
    lede: page.entry.description,
  });
}

/** A decision record leads with its number, which its title then omits. */
function decisionCard(page: DecisionPage): DocumentCard {
  return documentCard(page.route, {
    crumb: "/docs",
    eyebrow: `Decision · ADR ${page.number}${
      page.superseded ? " · Superseded" : ""
    }`,
    title: page.entry.title.replace(/^ADR \d+:\s*/u, ""),
    lede: page.entry.description,
  });
}

/** The release a reader would install: the newest stable one, else the newest record. */
function releaseCard(
  route: string,
  releases: readonly CatalogueRecord[],
): ReleaseCard | undefined {
  const record = compareReleases(releases).latest_stable ?? releases[0];
  if (record === undefined) return undefined;
  const summary = record.summary.replace(
    new RegExp(`^${DISCERN_MARK}\\s*discern v[\\d.]+:\\s*`, "u"),
    "",
  );
  return {
    kind: "release",
    route,
    version: record.version,
    ...(record.codename === undefined ? {} : { codename: record.codename }),
    ...(record.date === undefined || record.publication === "candidate"
      ? {}
      : { date: releaseDateLabel(record.date) }),
    summary: typographic(
      summary.replace(/^./u, (first) => first.toLocaleUpperCase()),
    ),
  };
}

/** The corpus front doors, each described by its own authored entry. */
function frontDoorCard(
  route: string,
  site: DocsSite,
): DocumentCard | undefined {
  if (route === site.landing.route) {
    return documentCard(route, {
      crumb: "/docs",
      eyebrow: "Manual",
      title: site.landing.entry.title,
      lede: site.landing.entry.description,
    });
  }
  if (route === PUBLIC_MAP_ROUTE) {
    return documentCard(route, {
      crumb: PUBLIC_MAP_ROUTE,
      eyebrow: "Project map",
      title: site.publicMap.landing.entry.title,
      lede: site.publicMap.landing.entry.description,
    });
  }
  if (route === site.decisions.route) {
    return documentCard(route, {
      crumb: "/docs",
      eyebrow: "Project history",
      title: site.decisions.index.title,
      lede: site.decisions.index.description,
    });
  }
  return undefined;
}

/** Whether a route names a registered marketing page. */
function isMarketingRoute(route: string): route is MarketingRoute {
  return Object.hasOwn(STATEMENTS, route);
}

/** The card for one HTML route, or `undefined` when the route has no page. */
export function socialCardFor(
  route: string,
  sources: SocialCardSources,
): SocialCard | undefined {
  if (isMarketingRoute(route)) {
    const copy = STATEMENTS[route];
    return {
      kind: "statement",
      route,
      headline: typographic(copy.headline),
      lede: typographic(copy.lede),
    };
  }
  if (route === RELEASE_ROUTES.html) {
    return releaseCard(route, sources.releases);
  }
  const page = sources.site.byRoute.get(route);
  if (page === undefined) return frontDoorCard(route, sources.site);
  return page.routeKind === "decision"
    ? decisionCard(page)
    : manualCard(sources.site, page);
}
