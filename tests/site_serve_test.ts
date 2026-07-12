/**
 * The discern.sh site handler: routes, reader negotiation, and the structural
 * guarantee that every declared route has its page on disk. The route checks
 * iterate the exported PAGES table, so a page added to the site auto-enrols —
 * a route can't ship without its file, and negotiation can't silently break.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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
    assertStringIncludes(await res.text(), "discern", `route ${path}`);
  }
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

Deno.test("/llms.txt is the plaintext edition for every reader", async () => {
  for (const headers of [BROWSER, CURL]) {
    const res = await get("/llms.txt", headers);
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get("content-type") ?? "", "text/plain");
    assertStringIncludes(await res.text(), "DISCERN(1)");
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
