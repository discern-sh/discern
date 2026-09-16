/**
 * Serve the document corpora: every manual, decision, and public-Map request.
 *
 * Every page negotiates. A browser gets the rendered shell; a text client (or
 * a `.md` suffix) gets the pristine Markdown bytes — the same bytes
 * `discern docs <leaf> --raw` prints. The corpus model and body renderer in
 * `docs.tsx` stay React-free because the site route inventory evaluates them
 * under codegen's narrow permissions; this module is where the React pages
 * join them.
 */

import { DOCUMENT_SEARCH_ROUTES } from "./routes.ts";
import {
  decisionShell,
  decisionsIndexShell,
  docsIndexShell,
  type DocsSite,
  type DocumentCorpus,
  loadDocsSite,
  PUBLIC_MAP_ROUTE,
  renderDoc,
} from "./docs.tsx";
import { buildSearchIndex } from "./search.ts";
import { renderMapPage } from "./ui/pages/MapPage.tsx";
import { renderManualPage } from "./ui/pages/ManualPage.tsx";

let searchIndexCache: string | undefined;

/** Build and cache the published manual's browser search index. */
async function searchIndexJson(site: DocsSite): Promise<string> {
  if (searchIndexCache !== undefined) return searchIndexCache;
  const index = await buildSearchIndex([
    { route: site.landing.route, section: "Manual", entry: site.landing.entry },
    ...site.pages.map((page) => ({
      route: page.route,
      section: site.sections.find((section) =>
        section.slug === page.sectionSlug
      )?.title ?? "",
      entry: page.entry,
    })),
  ]);
  searchIndexCache = JSON.stringify(index);
  return searchIndexCache;
}

/** Serve a cacheable successful body with its media type and optional negotiation variance. */
function respond(body: string, contentType: string, vary = false): Response {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=300",
  });
  if (vary) headers.set("vary", "Accept, User-Agent");
  return new Response(body, { status: 200, headers });
}

/** Serve equivalent 404 help as plain text or minimal HTML according to reader negotiation. */
function docsNotFound(asText: boolean, corpus: DocumentCorpus): Response {
  const root = corpus === "map" ? PUBLIC_MAP_ROUTE : "/docs";
  const noun = corpus === "map" ? "Map page" : "manual page";
  if (asText) {
    return new Response(
      `404 — no such ${noun}. The index lives at ${root} (raw Markdown for text clients).\n`,
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>404 · discern docs</title>` +
      `<body style="font-family:ui-monospace,monospace;padding:4rem 1.5rem;color:#1A1814;background:#FBFAF7">` +
      `<p style="max-width:34rem;line-height:1.7">404 — no such ${noun}.<br>` +
      `The index: <a href="${root}">discern.sh${root}</a></p>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/**
 * Serve one manual, decision, or public-Map request. `asText` is the caller's reader-negotiation
 * verdict; the `.md` suffix forces Markdown for any reader.
 */
export async function serveDocuments(
  path: string,
  asText: boolean,
): Promise<Response> {
  const site = await loadDocsSite();

  if (path === DOCUMENT_SEARCH_ROUTES.manual) {
    return respond(await searchIndexJson(site), "application/json");
  }

  const wantsMd = path.endsWith(".md");
  const routePath = wantsMd ? path.slice(0, -".md".length) : path;

  if (routePath === "/docs") {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.landing.entry.absPath),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    const rendered = await renderDoc(site.landing, site);
    return respond(
      docsIndexShell(site, rendered),
      "text/html; charset=utf-8",
      true,
    );
  }

  if (routePath === PUBLIC_MAP_ROUTE) {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.publicMap.landing.entry.absPath),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    return respond(
      renderMapPage(site.publicMap),
      "text/html; charset=utf-8",
      true,
    );
  }

  if (routePath === site.decisions.route) {
    if (wantsMd || asText) {
      return respond(
        await Deno.readTextFile(site.decisions.index.absPath),
        "text/markdown; charset=utf-8",
        !wantsMd,
      );
    }
    return respond(
      decisionsIndexShell(site),
      "text/html; charset=utf-8",
      true,
    );
  }

  const page = site.byRoute.get(routePath);
  if (page === undefined) {
    return docsNotFound(
      asText,
      routePath.startsWith(PUBLIC_MAP_ROUTE) ? "map" : "manual",
    );
  }

  if (wantsMd || asText) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    return respond(raw, "text/markdown; charset=utf-8", !wantsMd);
  }
  const rendered = await renderDoc(page, site);
  return respond(
    page.routeKind === "decision"
      ? decisionShell(site, page, rendered)
      : renderManualPage(site, page, rendered),
    "text/html; charset=utf-8",
    true,
  );
}
