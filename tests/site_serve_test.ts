/**
 * The discern.sh site handler: routes, reader negotiation, and the structural
 * guarantee that every declared route has its page on disk. The route checks
 * iterate the exported PAGES table, so a page added to the site auto-enrols —
 * a route can't ship without its file, and negotiation can't silently break.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  DISCERN_FAVICON_PATH,
  DISCERN_MARK,
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
} from "../site/brand.ts";
import { handler, PAGES, TEXT_EDITION, wantsText } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
};
const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return handler(new Request(`https://discern.sh${path}`, { headers }));
}

Deno.test("every declared route serves its page to a browser", async () => {
  for (const path of Object.keys(PAGES)) {
    const res = await get(path, BROWSER);
    assertEquals(res.status, 200, `route ${path}`);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/html",
      `route ${path}`,
    );
    const html = await res.text();
    assertStringIncludes(html, "discern", `route ${path}`);
    if (path !== "/") {
      const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
      assert(
        links.some((link) =>
          link.includes(DISCERN_MARK) && link.includes("discern")
        ),
        `brand link on route ${path} must place ${DISCERN_MARK} beside discern`,
      );
    }
    assertStringIncludes(
      html,
      `href="${DISCERN_FAVICON_PATH}"`,
      `favicon on route ${path}`,
    );
  }
});

Deno.test("the project mark and favicon preserve the ADR 0149 identity", async () => {
  const res = await get(DISCERN_FAVICON_PATH, BROWSER);
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "image/svg+xml");
  const svg = await res.text();
  assertStringIncludes(svg, `d="${DISCERN_MARK_FILLED_PATH}"`);
  assertStringIncludes(svg, `d="${DISCERN_MARK_OUTLINE_PATH}"`);
  assertStringIncludes(svg, "currentColor");
  assertStringIncludes(svg, "prefers-color-scheme: dark");
  assert(
    !svg.includes(DISCERN_MARK),
    "the favicon must draw the shape instead of rasterizing the glyph",
  );
});

Deno.test("negotiable routes serve the plaintext edition to text clients", async () => {
  const negotiable = Object.entries(PAGES).filter(([, r]) => r.negotiable);
  assert(negotiable.length > 0, "at least one negotiable route exists");
  for (const [path] of negotiable) {
    const res = await get(path, CURL);
    assertEquals(res.status, 200, `route ${path}`);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/plain",
      `route ${path}`,
    );
    assertStringIncludes(
      res.headers.get("vary") ?? "",
      "User-Agent",
      `route ${path}`,
    );
    assertStringIncludes(await res.text(), "DISCERN(1)", `route ${path}`);
  }
});

Deno.test("non-negotiable routes serve HTML even to text clients", async () => {
  for (const [path, route] of Object.entries(PAGES)) {
    if (route.negotiable) continue;
    const res = await get(path, CURL);
    assertEquals(res.status, 200, `route ${path}`);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/html",
      `route ${path}`,
    );
    await res.body?.cancel();
  }
});

Deno.test("the retired /v2 prototype is no longer public", async () => {
  assertEquals(Object.hasOwn(PAGES, "/v2"), false);
  const response = await get("/v2", BROWSER);
  assertEquals(response.status, 404);
  await response.body?.cancel();
});

Deno.test("/llms.txt is the plaintext edition for every reader", async () => {
  for (const headers of [BROWSER, CURL]) {
    const res = await get("/llms.txt", headers);
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get("content-type") ?? "", "text/plain");
    assertStringIncludes(await res.text(), "DISCERN(1)");
  }
});

Deno.test("/install serves the repository installer for every reader", async () => {
  const installer = await Deno.readTextFile(
    new URL("../install.sh", import.meta.url),
  );
  assertStringIncludes(installer, "#!/bin/sh");
  for (const headers of [BROWSER, CURL]) {
    const res = await get("/install", headers);
    assertEquals(res.status, 200);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/x-shellscript",
    );
    assertEquals(await res.text(), installer);
  }
});

Deno.test("the plaintext edition file backs the negotiation", () => {
  // TEXT_EDITION is read on demand; a rename that misses this constant would
  // 500 in production. Resolve it the same way the handler does.
  const stat = Deno.statSync(
    new URL(TEXT_EDITION, new URL("../site/", import.meta.url)),
  );
  assert(stat.isFile);
});

Deno.test("the production entrypoint serves the same handler via Deno.serve", async () => {
  // Deno Deploy runs the entrypoint with `deno run` and waits for a server to
  // bind, so site/main.ts — not serve.ts's bare `{ fetch }` export — is what
  // production runs. Guard that it stays a Deno.serve over this same handler,
  // so the entrypoint can't silently drift or be dropped.
  const main = await Deno.readTextFile(
    new URL("../site/main.ts", import.meta.url),
  );
  assertStringIncludes(main, 'from "./serve.ts"');
  assertStringIncludes(main, "Deno.serve(");
  assertStringIncludes(main, "handler");
});

Deno.test("unknown paths 404 in the reader's own format", async () => {
  const asHtml = await get("/no-such-page", BROWSER);
  assertEquals(asHtml.status, 404);
  assertStringIncludes(asHtml.headers.get("content-type") ?? "", "text/html");
  await asHtml.body?.cancel();

  const asText = await get("/no-such-page", CURL);
  assertEquals(asText.status, 404);
  assertStringIncludes(asText.headers.get("content-type") ?? "", "text/plain");
  await asText.body?.cancel();
});

Deno.test("traversal and write methods are refused", async () => {
  const traversal = await get("/../deno.json", CURL);
  assertEquals(traversal.status, 404);
  await traversal.body?.cancel();

  const post = await handler(
    new Request("https://discern.sh/", { method: "POST", headers: BROWSER }),
  );
  assertEquals(post.status, 405);
  await post.body?.cancel();
});

Deno.test("wantsText: browsers never, curl always, explicit text/plain honoured", () => {
  const req = (h: Record<string, string>): Request =>
    new Request("https://discern.sh/", { headers: h });
  assertEquals(wantsText(req(BROWSER)), false);
  assertEquals(wantsText(req(CURL)), true);
  assertEquals(wantsText(req({ accept: "text/plain" })), true);
  // An SDK fetch with no telling headers gets HTML, not a guess.
  assertEquals(
    wantsText(req({ accept: "*/*", "user-agent": "undici" })),
    false,
  );
});
