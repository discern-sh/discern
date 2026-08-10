/** Development-only server for the homepage specimens and internal art archive.
 *
 * The preview builds the normal static site assets, serves authored review
 * stylesheets without caching, and renders static documents only on loopback.
 * Neither review surface enters the production page registry or entrypoint.
 */

import {
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
} from "./dev.ts";
import {
  BROWSER_ARTWORKS,
  browserArtworkStylesheetName,
} from "../art/browser/registry.ts";
import { renderArtGallery } from "./page-src/art-gallery.tsx";
import { renderSpecimens } from "./page-src/specimens.tsx";
import { handler } from "./serve.ts";
import { fromFileUrl } from "@std/path";
import { designSystemAssetPath } from "./design_system.ts";

const SITE_ROOT = new URL("./", import.meta.url);
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const SPECIMEN_CSS_SOURCE = new URL("page-src/specimens.css", SITE_ROOT);
export const SPECIMEN_STYLESHEET_PATH =
  "/assets/design-system/compositions/specimens.css";
export const ART_GALLERY_PATH = "/art/";
export const ART_GALLERY_STYLESHEET_PATH = designSystemAssetPath(
  "compositions",
  "art-gallery.css",
);
const BROWSER_ART_ROOT = new URL("../art/browser/", SITE_ROOT);
const ART_STYLESHEET_SOURCES: ReadonlyMap<string, URL> = new Map([
  [
    ART_GALLERY_STYLESHEET_PATH,
    new URL("page-src/art-gallery.css", SITE_ROOT),
  ],
  ...BROWSER_ARTWORKS.map(({ slug }) =>
    [
      designSystemAssetPath(
        "compositions",
        browserArtworkStylesheetName(slug),
      ),
      new URL(`${slug}.css`, BROWSER_ART_ROOT),
    ] as const
  ),
]);

/** Every live art stylesheet route, derived from the browser-art authority. */
export const ART_STYLESHEET_PATHS = Object.freeze([
  ...ART_STYLESHEET_SOURCES.keys(),
]);

/** Prepare the generated design-system runtime consumed by the preview server. */
export async function buildSpecimenPreview(): Promise<void> {
  const build = await new Deno.Command(Deno.execPath(), {
    args: ["task", "site:build"],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!build.success) throw new Error("Site build failed");
}

/** Serve one live authored stylesheet with the review surface's no-cache policy. */
async function liveStylesheet(
  request: Request,
  source: URL,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("405 — method not allowed\n", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  const body = request.method === "HEAD"
    ? null
    : await Deno.readTextFile(source);
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/css; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** Render one development-only HTML surface with consistent method policy. */
function reviewDocument(
  request: Request,
  render: () => string,
): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("405 — method not allowed\n", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  return new Response(request.method === "HEAD" ? null : render(), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** Serve the preview root and delegate its generated assets to the live site handler. */
export async function specimenHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === SPECIMEN_STYLESHEET_PATH) {
    return await liveStylesheet(request, SPECIMEN_CSS_SOURCE);
  }
  const artStylesheet = ART_STYLESHEET_SOURCES.get(url.pathname);
  if (artStylesheet !== undefined) {
    return await liveStylesheet(request, artStylesheet);
  }
  if (url.pathname === "/art") {
    return new Response(null, {
      status: 308,
      headers: { location: `${ART_GALLERY_PATH}${url.search}` },
    });
  }
  if (url.pathname === ART_GALLERY_PATH) {
    return reviewDocument(request, renderArtGallery);
  }
  if (url.pathname === "/") {
    return reviewDocument(request, renderSpecimens);
  }
  return await handler(request);
}

/** Build and serve the specimens on the current worktree's loopback port. */
export async function runSpecimenPreview(): Promise<void> {
  await buildSpecimenPreview();
  const port = await resolveSiteDevPort(Deno.env.get("PORT"));
  const server = Deno.serve(
    {
      hostname: SITE_DEV_BIND_HOST,
      port,
      onListen: () => {
        console.log(
          `Development reviews listening on http://${SITE_DEV_BROWSER_HOST}:${port}/ and http://${SITE_DEV_BROWSER_HOST}:${port}${ART_GALLERY_PATH}`,
        );
      },
    },
    specimenHandler,
  );
  await server.finished;
}

if (import.meta.main) await runSpecimenPreview();
