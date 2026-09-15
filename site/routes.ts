/** Public route membership, derived from each content authority. */
import type { DocsSite } from "./docs.tsx";
import { MARKETING_PAGES, type MarketingPage } from "./marketing_pages.ts";
import {
  DISCERN_INSTALL_ROUTE,
  RELEASE_ROUTES,
} from "../src/shared/product_identity.ts";
import { PUBLIC_SCHEMA_PUBLICATIONS } from "../src/shared/public_schemas.ts";
import { SECURITY_DISCLOSURE } from "./security.ts";

export const DOCUMENT_ROUTES = {
  manual: "/docs",
  map: "/map",
  decisions: "/docs/decisions",
} as const;
export const DOCUMENT_SEARCH_ROUTES = {
  manual: `${DOCUMENT_ROUTES.manual}/index.json`,
} as const;
export const PUBLIC_ASSET_PREFIX = "/assets/";

interface RouteDescription {
  readonly path: string;
  readonly format:
    | "html"
    | "markdown"
    | "text"
    | "json"
    | "xml"
    | "shell"
    | "asset";
  readonly source: string;
}

export type SiteEndpoint =
  & RouteDescription
  & (
    | { readonly kind: "file"; readonly file: string }
    | {
      readonly kind:
        | "release"
        | "search"
        | "security"
        | "llms"
        | "llms-full"
        | "sitemap"
        | "robots";
    }
  );

/** Fixed endpoints enroll in dispatch and inventory together; schema and release paths retain their owners. */
export const SITE_ENDPOINTS: readonly SiteEndpoint[] = [
  {
    path: DISCERN_INSTALL_ROUTE,
    kind: "file",
    format: "shell",
    file: "../install.sh",
    source: "install.sh",
  },
  {
    path: "/llms.txt",
    kind: "llms",
    format: "text",
    source: "site/text/discern.txt",
  },
  {
    path: "/llms-full.txt",
    kind: "llms-full",
    format: "text",
    source: "site/text/discern.txt",
  },
  {
    path: "/sitemap.xml",
    kind: "sitemap",
    format: "xml",
    source: "site/routes.ts",
  },
  {
    path: "/robots.txt",
    kind: "robots",
    format: "text",
    source: "site/seo.tsx",
  },
  {
    path: SECURITY_DISCLOSURE.route,
    kind: "security",
    format: "text",
    source: "site/security.ts",
  },
  ...Object.values(DOCUMENT_SEARCH_ROUTES).map(
    (path) => ({
      path,
      kind: "search",
      format: "json",
      source: "site/docs.tsx",
    } as const),
  ),
  ...Object.entries(RELEASE_ROUTES).map((
    [format, path],
  ) => ({
    path,
    kind: "release",
    format: format === "html" ? "html" : format === "json" ? "json" : "text",
    source: "site/releases/records.ts",
  } as const)),
  ...PUBLIC_SCHEMA_PUBLICATIONS.map(
    (publication) => ({
      path: new URL(publication.id).pathname,
      kind: "file",
      format: "json",
      file: `../${publication.artifactPath}`,
      source: publication.artifactPath,
    } as const),
  ),
];

/** Project browser/raw pairs and fixed endpoints without a second list of document names. */
export function siteRoutes(
  site: DocsSite,
  marketing: readonly MarketingPage[] = MARKETING_PAGES,
): RouteDescription[] {
  const documents = [
    site.landing,
    ...site.pages,
    site.publicMap.landing,
    { route: site.decisions.route, entry: site.decisions.index },
    ...site.decisions.pages,
  ];
  const routes: RouteDescription[] = [
    ...marketing.map(
      (page) => ({
        path: page.route,
        format: "html",
        source: page.source,
      } as const),
    ),
    ...SITE_ENDPOINTS,
    ...documents.flatMap((page) =>
      [
        { path: page.route, format: "html", source: page.entry.path },
        {
          path: `${page.route}.md`,
          format: "markdown",
          source: page.entry.path,
        },
      ] as const
    ),
    {
      path: `${PUBLIC_ASSET_PREFIX}*`,
      format: "asset",
      source: "site/pages/assets/",
    },
  ];
  const paths = new Set<string>();
  for (const route of routes) {
    if (paths.has(route.path)) {
      throw new Error(`Duplicate public site route: ${route.path}`);
    }
    paths.add(route.path);
  }
  return routes;
}

/** Read the same complete inventory used by serving and the generated registry atlas. */
export async function loadSiteRouteInventory(): Promise<RouteDescription[]> {
  const { loadDocsSite } = await import("./docs.tsx");
  return siteRoutes(await loadDocsSite());
}
