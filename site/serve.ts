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
  serveDocs,
} from "./docs.ts";
import { PUBLIC_SCHEMA_PUBLICATIONS } from "../src/shared/public_schemas.ts";
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
} from "./seo.ts";
import { SECURITY_DISCLOSURE, securityTxt } from "./security.ts";
import { MARKETING_PAGES } from "./marketing_pages.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";

const SITE_ROOT = new URL("./", import.meta.url);
const PUBLIC_SCHEMA_ROUTES: ReadonlyMap<string, string> = new Map(
  PUBLIC_SCHEMA_PUBLICATIONS.map((publication) => [
    new URL(publication.id).pathname,
    publication.artifactPath,
  ]),
);

/** Routes with a page. `negotiable` routes serve the plaintext edition to text clients. */
export const PAGES: Readonly<
  Record<string, { page: string; negotiable: boolean }>
> = Object.fromEntries(
  MARKETING_PAGES.map(({ route, page, negotiable }) => [
    route,
    { page, negotiable },
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
  const body =
    `<!doctype html><meta charset="utf-8"><title>404 · discern</title>` +
    `<body style="font-family:ui-monospace,monospace;padding:4rem 1.5rem;color:#1A1814;background:#FBFAF7">` +
    `<p style="max-width:34rem;line-height:1.7">404 — no such page.<br>` +
    `Available pages: <a href="/">discern.sh</a> · ` +
    `<a href="/agents">/agents</a> · ` +
    `<a href="/docs">/docs</a> · <a href="/llms.txt">/llms.txt</a></p>`;
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
  } catch {
    return null;
  }
  if (path.includes("..") || path.includes("\0")) return null;
  return path;
}

export interface SiteRouting {
  site: DocsSite;
  liveRoutes: readonly string[];
  redirects: SiteRedirectTable;
}

let routingPromise: Promise<SiteRouting> | undefined;

/** The HTML route set. Published docs already passed through isPublicDoc. */
export function liveHtmlRoutes(site: DocsSite): string[] {
  return [
    ...Object.keys(PAGES),
    ...site.sitemapRoutes,
  ];
}

/** Assemble live routes and validate every static and authored redirect against them. */
async function loadSiteRouting(): Promise<SiteRouting> {
  const site = await loadDocsSite();
  const liveRoutes = liveHtmlRoutes(site);
  const redirects = buildSiteRedirectTable(
    liveRoutes,
    [site.landing, ...site.pages, ...site.decisions.pages],
    STATIC_REDIRECTS,
  );
  if (redirects.issues.length > 0) {
    throw new Error(`unsafe site redirects:\n${redirects.issues.join("\n")}`);
  }
  return { site, liveRoutes, redirects };
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

/** Dispatch schemas, installer, docs, fixed pages, and declared assets. */
async function routeResponse(
  req: Request,
  path: string,
  routing: SiteRouting,
): Promise<Response> {
  const publicSchema = PUBLIC_SCHEMA_ROUTES.get(path);
  if (publicSchema !== undefined) {
    return await serveFile(`../${publicSchema}`);
  }

  // The one-line install moment: `curl -fsSL https://discern.sh/install | sh`
  // serves the repository's own installer, so the command on the landing
  // page is true from the first deploy.
  if (path === "/install") return await serveFile("../install.sh");
  if (path === SECURITY_DISCLOSURE.route) {
    return new Response(securityTxt(), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }
  if (path === "/llms.txt") return await llmsTxt(routing.site);
  if (path === "/llms-full.txt") return await llmsFullTxt(routing.site);
  if (path === "/sitemap.xml") {
    return new Response(sitemapXml(routing.liveRoutes), {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }
  if (path === "/robots.txt") {
    return new Response(robotsTxt(), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }

  if (path === "/docs" || path === "/docs.md" || path.startsWith("/docs/")) {
    return await serveDocs(path, wantsText(req));
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
  if (path.startsWith("/assets/")) {
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

  if (response.status === 200 && contentType.includes("text/html")) {
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
