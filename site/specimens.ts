/** Development-only server for the homepage artefact specimens.
 *
 * The preview builds the normal static site assets, adds one ignored preview
 * stylesheet, and serves a static document at the loopback root. It never
 * enters the production page registry or production entrypoint.
 */

import { buildSite } from "./build.ts";
import {
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
} from "./dev.ts";
import { renderSpecimens } from "./page-src/specimens.tsx";
import { handler } from "./serve.ts";

const SITE_ROOT = new URL("./", import.meta.url);
const SPECIMEN_CSS_SOURCE = new URL("page-src/specimens.css", SITE_ROOT);
const SPECIMEN_CSS_OUTPUT = new URL(
  "pages/assets/design-system/compositions/specimens.css",
  SITE_ROOT,
);

/** Prepare the ignored runtime assets consumed only by the preview server. */
export async function buildSpecimenPreview(): Promise<void> {
  await buildSite();
  const css = await Deno.readTextFile(SPECIMEN_CSS_SOURCE);
  await Deno.writeTextFile(
    SPECIMEN_CSS_OUTPUT,
    "/* Development-only homepage specimen preview. Do not publish. */\n" +
      css,
  );
}

/** Serve the preview root and delegate its generated assets to the live site handler. */
export async function specimenHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
          `Homepage specimens listening on http://${SITE_DEV_BROWSER_HOST}:${port}/`,
        );
      },
    },
    specimenHandler,
  );
  await server.finished;
}

if (import.meta.main) await runSpecimenPreview();
