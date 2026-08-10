/** Development-only server for focused site artwork specimens.
 *
 * The preview builds the normal static site assets, serves its authored
 * stylesheets without caching, and renders a static document at the loopback
 * root. It never enters the production page registry or production entrypoint.
 */

import {
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
} from "./dev.ts";
import { renderSpecimens } from "./page-src/specimens.tsx";
import { handler } from "./serve.ts";
import { fromFileUrl } from "@std/path";

const SITE_ROOT = new URL("./", import.meta.url);
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
export const SPECIMEN_STYLESHEET_PATH =
  "/assets/design-system/compositions/specimens.css";
export const ALIGNMENT_STYLESHEET_PATH =
  "/assets/design-system/compositions/benefit_alignment.css";
const LIVE_STYLESHEETS = new Map<string, URL>([
  [
    SPECIMEN_STYLESHEET_PATH,
    new URL("page-src/specimens.css", SITE_ROOT),
  ],
  [
    ALIGNMENT_STYLESHEET_PATH,
    new URL("page-src/benefit_alignment.css", SITE_ROOT),
  ],
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

/** Serve the preview root and delegate its generated assets to the live site handler. */
export async function specimenHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const liveStylesheet = LIVE_STYLESHEETS.get(url.pathname);
  if (liveStylesheet !== undefined) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("405 — method not allowed\n", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    const body = request.method === "HEAD"
      ? null
      : await Deno.readTextFile(liveStylesheet);
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/css; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (url.pathname !== "/") return await handler(request);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("405 — method not allowed\n", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  const body = request.method === "HEAD" ? null : renderSpecimens();
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

/** Build and serve the specimen on the current worktree's loopback port. */
export async function runSpecimenPreview(): Promise<void> {
  await buildSpecimenPreview();
  const port = await resolveSiteDevPort(Deno.env.get("PORT"));
  const server = Deno.serve(
    {
      hostname: SITE_DEV_BIND_HOST,
      port,
      onListen: () => {
        console.log(
          `Benefit artwork specimen listening on http://${SITE_DEV_BROWSER_HOST}:${port}/`,
        );
      },
    },
    specimenHandler,
  );
  await server.finished;
}

if (import.meta.main) await runSpecimenPreview();
