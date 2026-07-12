/**
 * The discern.sh site: one standard fetch handler serving the static editions,
 * with reader negotiation on the routes that have a plaintext edition —
 * browsers receive HTML; text clients (curl, wget, and friends) receive
 * DISCERN(1) as plain text. `/llms.txt` serves the same plaintext edition
 * unconditionally.
 *
 * The same handler runs everywhere, which is the parity guarantee:
 *   locally      `deno task site`   (`deno serve` consumes the default export)
 *   production   Deno Deploy runs `main.ts`, a `Deno.serve` over this handler
 *
 * The new Deno Deploy runs an entrypoint with `deno run`, which won't start a
 * server from a bare `{ fetch }` export — so `main.ts` binds the port. There is
 * still no separate handler: both paths serve the export at the foot of this
 * file.
 */

import { docsLlmsSection, loadDocsSite, serveDocs } from "./docs.ts";

const SITE_ROOT = new URL("./", import.meta.url);

/** Routes with a page. `negotiable` routes serve the plaintext edition to text clients. */
export const PAGES: Readonly<
  Record<string, { page: string; negotiable: boolean }>
> = {
  "/": { page: "pages/index.html", negotiable: true },
  "/agents": { page: "pages/agents.html", negotiable: true },
  "/start": { page: "pages/start.html", negotiable: false },
  "/careers": { page: "pages/careers.html", negotiable: false },
};

/** The plaintext edition: served to text clients on negotiable routes and at /llms.txt. */
export const TEXT_EDITION = "text/discern.txt";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
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

/**
 * /llms.txt: the handwritten DISCERN(1) edition, with the docs index appended
 * from the same tree the /docs section renders — one listing, never hand-kept.
 */
async function llmsTxt(): Promise<Response> {
  const base = await Deno.readTextFile(new URL(TEXT_EDITION, SITE_ROOT));
  const docs = docsLlmsSection(await loadDocsSite());
  return new Response(`${base.trimEnd()}\n\n${docs}`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

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
    `The editions: <a href="/">discern.sh</a> · <a href="/agents">/agents</a> · ` +
    `<a href="/start">/start</a> · <a href="/careers">/careers</a> · <a href="/llms.txt">/llms.txt</a></p>`;
  return new Response(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Normalize a request path: strip trailing slashes, collapse /index.html, reject traversal. */
function normalize(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("..") || path.includes("\0")) return null;
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("405 — method not allowed\n", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const path = normalize(new URL(req.url).pathname);
  if (path === null) return notFound(wantsText(req));

  if (path === "/llms.txt") return await llmsTxt();

  if (path === "/docs" || path.startsWith("/docs/")) {
    return await serveDocs(path, wantsText(req));
  }

  const route = PAGES[path];
  if (route !== undefined) {
    if (route.negotiable) {
      const vary = { vary: "Accept, User-Agent" };
      return wantsText(req)
        ? await serveFile(TEXT_EDITION, vary)
        : await serveFile(route.page, vary);
    }
    return await serveFile(route.page);
  }

  // Static fallback for assets under pages/ (fonts, images, receipt.json, …).
  try {
    return await serveFile(`pages${path}`);
  } catch {
    return notFound(wantsText(req));
  }
}

export default { fetch: handler };
