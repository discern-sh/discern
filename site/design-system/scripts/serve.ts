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

function safePath(url: URL): URL | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("..") || pathname.includes("\0")) return null;
  if (pathname.endsWith("/")) pathname += "index.html";
  return new URL(`.${pathname}`, ROOT);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const target = safePath(new URL(request.url));
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
