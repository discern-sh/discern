/** The concise /trust gateway: claim authority and exact evidence routes. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CLAIMS } from "../scripts/brand/claims.ts";
import { TRUST_TITLE } from "../site/brand.ts";
import { TRUST_EVIDENCE } from "../site/page-src/trust.tsx";
import { handler } from "../site/serve.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const BROWSER = { accept: "text/html", "user-agent": "Mozilla/5.0" };
const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };

/** Request one public route with the chosen reader identity. */
function get(path: string, headers = BROWSER): Promise<Response> {
  return handler(
    new Request(`https://discern.sh${path}`, { headers }),
  );
}

Deno.test("every material trust statement names a live claims authority", () => {
  const claims = TRUST_EVIDENCE.flatMap((group) => group.claims);
  assertEquals(
    new Set(claims),
    new Set([
      "no-model-inside",
      "local-logbook",
      "proof-exact-tree",
      "gate-grants-no-authority",
      "map-mechanically-checked",
      "runs-on-itself",
    ]),
  );
  for (const claim of claims) assert(Object.hasOwn(CLAIMS, claim), claim);
});

Deno.test("the trust gateway routes each claim to exact manual or Map evidence", async () => {
  const response = await get("/trust");
  assertEquals(response.status, 200);
  const dom = new JSDOM(await response.text());
  const document = dom.window.document;
  assertEquals(document.title, TRUST_TITLE);
  assertEquals(
    document.querySelector("h1")?.textContent,
    "Confidence you can inspect.",
  );
  assertEquals(document.querySelectorAll(".trust-evidence").length, 3);
  assertStringIncludes(
    document.body.textContent ?? "",
    "not independent validation",
  );
  assertStringIncludes(
    document.body.textContent ?? "",
    "does not certify correctness or security",
  );

  const exactDestinations = [
    "/docs/understand/local-control",
    "/docs/reference/platforms-and-providers",
    "/docs/understand/proof",
    "/docs/reference/proof-and-checkpoint-formats",
    "/map",
    "/docs/understand/instructions-skills-and-map",
    "/docs/reference/files-and-ownership",
    "/docs/reference/licenses",
  ];
  const hrefs = new Set(
    [...document.querySelectorAll<HTMLAnchorElement>("main a")].map((link) =>
      link.getAttribute("href") ?? ""
    ),
  );
  for (const route of exactDestinations) {
    assert(hrefs.has(route), `trust gateway links ${route}`);
    assertEquals((await get(route)).status, 200, route);
  }
  dom.window.close();
});

Deno.test("trust remains a discoverable human HTML gateway", async () => {
  const curl = await get("/trust", CURL);
  assertEquals(curl.status, 200);
  assertStringIncludes(curl.headers.get("content-type") ?? "", "text/html");
  assertEquals((await get("/trust.md", CURL)).status, 404);

  const sitemap = await (await get("/sitemap.xml")).text();
  assertStringIncludes(sitemap, "<loc>https://discern.sh/trust</loc>");
});
