/** Development-only server for the focused benefit artwork specimen.
 *
 * The preview builds the normal static site assets, serves one authored
 * stylesheet without caching, and renders a static document at the loopback root. It never
 * enters the production page registry or production entrypoint.
 */

import {
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
} from "./dev.ts";
import { renderFreedomInvariantPreview } from "./page-src/benefit-freedom-invariant-preview.tsx";
import { handler } from "./serve.ts";
import { fromFileUrl } from "@std/path";

const SITE_ROOT = new URL("./", import.meta.url);
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const SPECIMEN_CSS_SOURCE = new URL(
  "page-src/benefit-freedom-invariant.css",
  SITE_ROOT,
);
export const SPECIMEN_STYLESHEET_PATH =
  "/assets/design-system/compositions/benefit-freedom-invariant.css";

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
  if (url.pathname === SPECIMEN_STYLESHEET_PATH) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("405 — method not allowed\n", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    const body = request.method === "HEAD"
      ? null
      : await Deno.readTextFile(SPECIMEN_CSS_SOURCE);
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
  const body = request.method === "HEAD"
    ? null
    : renderFreedomInvariantPreview();
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
          `Freedom of movement study listening on http://${SITE_DEV_BROWSER_HOST}:${port}/`,
        );
      },
    },
    specimenHandler,
  );
  await server.finished;
}

if (import.meta.main) await runSpecimenPreview();
