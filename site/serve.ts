/**
 * The discern.sh site: one standard fetch handler serving the static editions,
 * with reader negotiation on the routes that have a plaintext edition —
 * browsers receive HTML; text clients (curl, wget, and friends) receive
 * the llms.txt edition as plain text. `/llms.txt` serves the same plaintext
 * edition unconditionally.
 *
 * The same handler runs everywhere, which is the parity guarantee:
 *   locally      `deno task site` runs `dev.ts`, a loopback server over it
 *   production   Deno Deploy runs `main.ts`, an all-interface server over it
 *
 * The new Deno Deploy runs an entrypoint with `deno run`, which won't start a
 * server from a bare `{ fetch }` export — so `main.ts` binds the port. There is
 * still no separate handler: both paths serve the export at the foot of this
 * file.
 */

import {
  docsLlmsSection,
  type DocsSite,
  loadDocsSite,
  PUBLIC_MAP_ROUTE,
} from "./docs.tsx";
import { serveDocuments } from "./documents.tsx";
import {
  PUBLIC_ASSET_PREFIX,
  SITE_ENDPOINTS,
  type SiteEndpoint,
  siteRoutes,
} from "./routes.ts";
import { renderNotFoundPage } from "./ui/pages/NotFoundPage.tsx";
import {
  applySecurityHeaders,
  buildSiteRedirectTable,
  canonicalUrl,
  decorateHtmlPage,
  docsLlmsFullText,
  responseNonce,
  robotsTxt,
  SITE_ORIGIN,
  sitemapXml,
  type SiteRedirectTable,
  STATIC_REDIRECTS,
} from "./seo.tsx";
import { securityTxt } from "./security.ts";
import { PUBLISHED_MARKETING_PAGES } from "./marketing_pages.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";

import { RELEASE_ROUTES } from "../src/shared/product_identity.ts";
import { loadReleaseCatalogue } from "./releases/catalogue.ts";
import type { CatalogueRecord } from "./releases/model.ts";
import { releaseResponse } from "./releases/response.ts";

const SITE_ROOT = new URL("./", import.meta.url);
/** Published routes with a page. `negotiable` routes serve the plaintext edition to text clients. */
export const PAGES: Readonly<
  Record<
    string,
    { page: string; negotiable: boolean }
  >
> = Object.fromEntries(
  PUBLISHED_MARKETING_PAGES.map((entry) => [
    entry.route,
    {
      page: entry.page,
      negotiable: entry.negotiable,
    },
  ]),
);

/** The plaintext edition: served to text clients on negotiable routes and at /llms.txt. */
export const TEXT_EDITION = "text/discern.txt";

/** Author-time marker replaced from the canonical provider registry on every response. */
export const SUPPORTED_PROVIDER_NAMES_MARKER = "{{SUPPORTED_PROVIDER_NAMES}}";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** UA substrings that identify a text-first client. Case-insensitive. */
const TEXT_CLIENTS =
  /\b(curl|wget|httpie|libcurl|python-requests|python-urllib|go-http-client|lynx|w3m|links)\b/i;

/**
 * A browser declares `text/html` in Accept; nothing else reliably does. A
 * client that doesn't, and either looks like a known text tool or explicitly
 * asks for `text/plain`, gets the plaintext edition.
 */
export function wantsText(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) return false;
  if (TEXT_CLIENTS.test(req.headers.get("user-agent") ?? "")) return true;
  return accept.includes("text/plain");
}

/** Read a bundled file and respond with its inferred content type and cache policy. */
async function serveFile(
  relPath: string,
  extraHeaders?: HeadersInit,
): Promise<Response> {
  const ext = relPath.slice(relPath.lastIndexOf("."));
  const body = await Deno.readFile(new URL(relPath, SITE_ROOT));
  const headers = new Headers(extraHeaders);
  headers.set("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=300");
  }
  return new Response(body, { status: 200, headers });
}

/** Join display labels with an Oxford conjunction for public prose. */
function readableList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** Expand the authored machine-edition template from live product registries. */
export function renderTextEdition(source: string): string {
  const occurrences = source.split(SUPPORTED_PROVIDER_NAMES_MARKER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${TEXT_EDITION} must contain exactly one ${SUPPORTED_PROVIDER_NAMES_MARKER} marker`,
    );
  }
  return source.replace(
    SUPPORTED_PROVIDER_NAMES_MARKER,
    readableList(AGENT_NAMES.map((name) => PROVIDERS[name].label)),
  );
}

/** Read the authored machine edition and expand its registry-owned fields. */
async function textEditionBody(): Promise<string> {
  const source = await Deno.readTextFile(new URL(TEXT_EDITION, SITE_ROOT));
  return renderTextEdition(source);
}

/** Serve the expanded base machine edition without the generated docs index. */
async function textEditionResponse(
  extraHeaders?: HeadersInit,
): Promise<Response> {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "public, max-age=300");
  return new Response(await textEditionBody(), { status: 200, headers });
}

/**
 * /llms.txt: the handwritten llms.txt edition (llmstxt.org), with the
 * documentation file lists appended from the same tree the /docs section
 * renders — one listing, never hand-kept.
 */
async function llmsTxt(site: DocsSite): Promise<Response> {
  const base = await textEditionBody();
  const docs = docsLlmsSection(site);
  return new Response(`${base.trimEnd()}\n\n${docs}`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

/** /llms-full.txt: the complete public projection, with citations retained. */
async function llmsFullTxt(site: DocsSite): Promise<Response> {
  const base = await textEditionBody();
  const docs = await docsLlmsFullText(site);
  return new Response(`${base.trimEnd()}\n\n${docs}`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

/** Negotiate a plain-text or HTML 404 from the request's text preference. */
function notFound(asText: boolean): Response {
  if (asText) {
    return new Response(
      "404 — no such page. The plaintext edition lives at /llms.txt\n",
      {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }
  const body = renderNotFoundPage();
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Decode a request path for routing and reject traversal. */
function decodePath(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return null;
  }
  if (path.includes("..") || path.includes("\0")) return null;
  return path;
}

export interface SiteRouting {
  site: DocsSite;
  releases?: readonly CatalogueRecord[];
  liveRoutes: readonly string[];
  redirects: SiteRedirectTable;
}

let routingPromise: Promise<SiteRouting> | undefined;

/** The HTML route set. Published docs already passed through isPublicDoc. */
export function liveHtmlRoutes(site: DocsSite): string[] {
  return siteRoutes(site).filter((route) => route.format === "html").map(
    (route) => route.path,
  );
}

/** Assemble live routes and validate every static and authored redirect against them. */
async function loadSiteRouting(): Promise<SiteRouting> {
  const site = await loadDocsSite();
  const liveRoutes = liveHtmlRoutes(site);
  const redirects = buildSiteRedirectTable(
    liveRoutes,
    [
      site.landing,
      ...site.pages,
      ...site.decisions.pages,
      site.publicMap.landing,
    ],
    STATIC_REDIRECTS,
  );
  if (redirects.issues.length > 0) {
    throw new Error(`unsafe site redirects:\n${redirects.issues.join("\n")}`);
  }
  return {
    site,
    liveRoutes,
    redirects,
    releases: await loadReleaseCatalogue(),
  };
}

/** Share one routing snapshot across requests for the process lifetime. */
function siteRouting(): Promise<SiteRouting> {
  routingPromise ??= loadSiteRouting();
  return routingPromise;
}

/** Collapse every canonical variant before consulting the redirect registry. */
function canonicalPathVariant(
  path: string,
  addressable: ReadonlySet<string>,
): string {
  const original = path;
  let value = path;
  if (value.endsWith("/index.html")) {
    value = value.slice(0, -"/index.html".length) || "/";
  }
  while (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  if (value.endsWith(".html")) {
    const extensionless = value.slice(0, -".html".length) || "/";
    if (addressable.has(extensionless)) value = extensionless;
  }
  return addressable.has(value) ? value : original;
}

/** Preserve the query while targeting the production canonical or self-hosted origin. */
function redirectLocation(url: URL, path: string): string {
  const productionHost = url.hostname === "discern.sh" ||
    url.hostname === "www.discern.sh";
  const origin = productionHost ? SITE_ORIGIN : url.origin;
  const destination = new URL(path, origin);
  destination.search = url.search;
  return destination.href;
}

/** Require HTTPS on the apex production host and remove the `www` alias. */
function needsDomainRedirect(url: URL): boolean {
  return url.hostname === "www.discern.sh" ||
    (url.hostname === "discern.sh" && url.protocol !== "https:");
}

/** Respond with a cacheable 308 and no body. */
function permanentRedirect(location: string): Response {
  return new Response(null, {
    status: 308,
    headers: {
      location,
      "cache-control": "public, max-age=86400",
    },
  });
}

/** Serve every registered fixed endpoint through an exhaustive handler choice. */
async function endpointResponse(
  req: Request,
  endpoint: SiteEndpoint,
  routing: SiteRouting,
): Promise<Response> {
  switch (endpoint.kind) {
    case "file":
      return await serveFile(endpoint.file);
    case "release":
      return releaseResponse(
        req,
        endpoint.path,
        wantsText(req),
        routing.releases ?? await loadReleaseCatalogue(),
      );
    case "search":
      return await serveDocuments(endpoint.path, wantsText(req));
    case "llms":
      return await llmsTxt(routing.site);
    case "llms-full":
      return await llmsFullTxt(routing.site);
    case "security":
    case "sitemap":
    case "robots":
      return new Response(
        endpoint.kind === "security"
          ? securityTxt()
          : endpoint.kind === "sitemap"
          ? sitemapXml(routing.liveRoutes)
          : robotsTxt(),
        {
          status: 200,
          headers: {
            "content-type": endpoint.format === "xml"
              ? "application/xml; charset=utf-8"
              : "text/plain; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        },
      );
  }
}

/** Dispatch schemas, installer, docs, fixed pages, and declared assets. */
async function routeResponse(
  req: Request,
  path: string,
  routing: SiteRouting,
): Promise<Response> {
  const endpoint = SITE_ENDPOINTS.find((entry) => entry.path === path);
  if (endpoint !== undefined) {
    return await endpointResponse(req, endpoint, routing);
  }

  if (path === "/docs" || path === "/docs.md" || path.startsWith("/docs/")) {
    return await serveDocuments(path, wantsText(req));
  }
  if (
    path === PUBLIC_MAP_ROUTE || path === `${PUBLIC_MAP_ROUTE}.md` ||
    path.startsWith(`${PUBLIC_MAP_ROUTE}/`)
  ) {
    return await serveDocuments(path, wantsText(req));
  }

  const route = PAGES[path];
  if (route !== undefined) {
    if (route.negotiable) {
      const vary = { vary: "Accept, User-Agent" };
      return wantsText(req)
        ? await textEditionResponse(vary)
        : await serveFile(route.page, vary);
    }
    return await serveFile(route.page);
  }

  // Only the declared asset subtree is a static fallback. Raw page filenames
  // never become a second public URL for an HTML page.
  if (path.startsWith(PUBLIC_ASSET_PREFIX)) {
    try {
      return await serveFile(`pages${path}`);
    } catch {
      return notFound(wantsText(req));
    }
  }
  return notFound(wantsText(req));
}

/** Add canonical and security headers, decorate HTML, and honor HEAD semantics. */
async function finalizeResponse(
  response: Response,
  path: string,
  nonce: string,
  headOnly: boolean,
  secure: boolean,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";
  let body: BodyInit | null = headOnly ? null : response.body;

  // Release input errors are complete pages with the same chrome and theme bootstrap.
  const completeHtmlPage = response.status === 200 ||
    (path === RELEASE_ROUTES.html && response.status === 400);
  if (completeHtmlPage && contentType.includes("text/html")) {
    headers.set("link", `<${canonicalUrl(path)}>; rel="canonical"`);
    if (!headOnly) {
      body = decorateHtmlPage(await response.text(), path, nonce);
      headers.delete("content-length");
    }
  } else if (
    response.status === 200 && path.endsWith(".md") &&
    contentType.includes("text/markdown")
  ) {
    headers.set(
      "link",
      `<${canonicalUrl(path.slice(0, -".md".length))}>; rel="canonical"`,
    );
    headers.set("x-robots-tag", "noindex, follow");
  }
  // Long canonical metadata is served directly; browser caching stays independent.
  const canonicalLink = headers.get("link");
  if (
    canonicalLink !== null &&
    new TextEncoder().encode(canonicalLink).length >= 128
  ) {
    headers.set("deno-cdn-cache-control", "no-store");
  }
  applySecurityHeaders(headers, nonce, secure);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The production handler. Tests may supply a routing fixture so a synthetic
 * redirect_from claim can exercise the exact serving path without mutating the
 * live map.
 */
async function handleRequest(
  req: Request,
  routingFixture?: SiteRouting,
): Promise<Response> {
  const nonce = responseNonce();
  const secure = new URL(req.url).protocol === "https:";
  if (req.method !== "GET" && req.method !== "HEAD") {
    return await finalizeResponse(
      new Response("405 — method not allowed\n", {
        status: 405,
        headers: {
          allow: "GET, HEAD",
          "content-type": "text/plain; charset=utf-8",
        },
      }),
      new URL(req.url).pathname,
      nonce,
      false,
      secure,
    );
  }

  const url = new URL(req.url);
  const decoded = decodePath(url.pathname);
  if (decoded === null) {
    return await finalizeResponse(
      notFound(wantsText(req)),
      url.pathname,
      nonce,
      req.method === "HEAD",
      secure,
    );
  }
  const routing = routingFixture ?? await siteRouting();
  const addressable = new Set([
    ...routing.liveRoutes,
    ...Object.values(RELEASE_ROUTES),
    ...routing.redirects.redirects.keys(),
  ]);
  const variant = canonicalPathVariant(decoded, addressable);
  const target = routing.redirects.redirects.get(variant) ?? variant;
  if (
    target !== decoded || needsDomainRedirect(url)
  ) {
    return await finalizeResponse(
      permanentRedirect(redirectLocation(url, target)),
      target,
      nonce,
      true,
      secure,
    );
  }

  return await finalizeResponse(
    await routeResponse(req, target, routing),
    target,
    nonce,
    req.method === "HEAD",
    secure,
  );
}

/** The one-argument fetch handler used by local and production servers. */
export function handler(req: Request): Promise<Response> {
  return handleRequest(req);
}

/** Exercise the real handler with a synthetic redirect registry in tests. */
export function handlerWithRouting(
  req: Request,
  routing: SiteRouting,
): Promise<Response> {
  return handleRequest(req, routing);
}

export default { fetch: handler };
