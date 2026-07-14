const ROOT = new URL("../", import.meta.url);
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** Map the mounted styleguide URL space onto its authored and generated files. */
export function styleguideFilePath(rawPathname: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }
  if (pathname.includes("..") || pathname.includes("\0")) return null;
  if (pathname.startsWith("/style-guide/")) {
    const mountedPath = pathname.slice("/style-guide".length);
    pathname = /^\/(?:dist|src|assets)\//.test(mountedPath)
      ? mountedPath
      : `/styleguide${mountedPath}`;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  return `.${pathname}`;
}

function safePath(url: URL): URL | null {
  const path = styleguideFilePath(url.pathname);
  return path === null ? null : new URL(path, ROOT);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/style-guide") {
      url.pathname = "/style-guide/";
      return Response.redirect(url, 307);
    }
    const target = safePath(url);
    if (!target) return new Response("Bad request", { status: 400 });
    try {
      const body = await Deno.readFile(target);
      const extension = target.pathname.slice(target.pathname.lastIndexOf("."));
      return new Response(body, {
        headers: {
          "content-type": CONTENT_TYPES[extension] ??
            "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};
