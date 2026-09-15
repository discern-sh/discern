/** The separately framed public Map: canonical admission, routes, and isolation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename } from "@std/path";
import { discoverDocs, type DocEntry, isPublicDoc } from "../src/lib/docs.ts";
import { MAP_SECTION_REGISTRY } from "../src/lib/paths.ts";
import {
  isPublicMapEntry,
  loadDocsSite,
  projectPublicMapPages,
  PUBLIC_MAP_ROUTE,
  rewriteLinks,
} from "../site/docs.tsx";
import { handler } from "../site/serve.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0",
};

/** Request one public route as a browser. */
function get(path: string): Promise<Response> {
  return handler(
    new Request(`https://discern.sh${path}`, { headers: BROWSER }),
  );
}

/** Minimal neutral document-model fixture. */
function entry(relToDocs: string, publish = true): DocEntry {
  const parts = relToDocs.split("/");
  const filename = parts.at(-1) ?? "page.md";
  return {
    path: `project/map/${relToDocs}`,
    absPath: `/fixture/project/map/${relToDocs}`,
    relToDocs,
    section: parts.length > 1 ? (parts[0] ?? "") : "",
    slug: basename(filename).replace(/\.md$/i, ""),
    title: relToDocs,
    description: `Description for ${relToDocs}`,
    publish,
    aliases: [relToDocs],
    redirectFrom: [],
    citedAdrs: [],
  };
}

/** Independent expression of the registry-backed Map publication contract. */
function canonicalSafe(entry: DocEntry): boolean {
  if (!isPublicDoc(entry)) return false;
  if (entry.relToDocs === "README.md") return true;
  const parts = entry.relToDocs.split("/");
  const directories = parts.slice(0, -1);
  return directories.every((part) => !part.startsWith("_")) &&
    MAP_SECTION_REGISTRY.some((section) => section.dir === parts[0]);
}

Deno.test("the whole discovered Map admits exactly the canonical safe set", async () => {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: "project/map",
    includeInternal: true,
  });
  assert(tree !== undefined);
  const site = await loadDocsSite();
  const expected = tree.entries.filter(canonicalSafe);
  const rejected = tree.entries.filter((page) => !canonicalSafe(page));

  assertEquals(
    [site.publicMap.landing, ...site.publicMap.pages].map((page) =>
      page.sourcePath
    ),
    expected.map((page) => page.relToDocs),
  );
  assertEquals(
    site.publicMap.rejected.map((page) => page.relToDocs),
    rejected.map((page) => page.relToDocs),
  );
  assertEquals(
    site.publicMap.sections.map((section) => [section.dir, section.audience]),
    MAP_SECTION_REGISTRY.map((section) => [section.dir, section.audience]),
  );
  assert(
    site.publicMap.pages.some((page) => page.audience === "contributor"),
    "contributor tiers are deliberately admitted",
  );
  assert(
    site.publicMap.rejected.some((page) =>
      page.relToDocs.startsWith("_internal/")
    ),
  );
  assert(
    site.publicMap.rejected.some((page) =>
      page.relToDocs.startsWith("_private/")
    ),
  );
});

Deno.test("protected directories and explicit withholding fail the Map predicate", () => {
  const sectionReadmes = MAP_SECTION_REGISTRY.map((section) =>
    entry(`${section.dir}/README.md`)
  );
  const first = MAP_SECTION_REGISTRY[0];
  assert(first !== undefined);
  const safe = entry(`${first.dir}/visible.md`);
  const internal = entry("_internal/phantom.md");
  const privatePage = entry("_private/secret.md");
  const withheld = entry(`${first.dir}/withheld.md`, false);
  const [firstReadme, ...remainingReadmes] = sectionReadmes;
  assert(firstReadme !== undefined);
  const projection = projectPublicMapPages([
    entry("README.md"),
    firstReadme,
    safe,
    ...remainingReadmes,
    internal,
    privatePage,
    withheld,
  ]);

  assertEquals(
    [internal, privatePage, withheld].map(isPublicMapEntry),
    [false, false, false],
  );
  assertEquals(
    projection.pages.some((page) => page.sourcePath === safe.relToDocs),
    true,
  );
  assertEquals(
    projection.rejected.map((page) => page.relToDocs),
    [internal.relToDocs, privatePage.relToDocs, withheld.relToDocs],
  );
});

Deno.test("the public Map has rooted framing, navigation, breadcrumbs, and raw policy", async () => {
  const site = await loadDocsSite();
  const response = await get(PUBLIC_MAP_ROUTE);
  assertEquals(response.status, 200);
  const dom = new JSDOM(await response.text());
  const document = dom.window.document;
  assertEquals(document.body.dataset.documentCorpus, "map");
  assertStringIncludes(
    document.querySelector(".docs-map-label")?.textContent ?? "",
    "working evidence from internal use",
  );
  assertEquals(
    document.querySelector(".docs-map-label a")?.getAttribute("href"),
    "/docs",
  );
  assertEquals(
    [...document.querySelectorAll(".docs-nav-scroll [data-nav-page] > a")]
      .map((link) => link.getAttribute("href")),
    site.publicMap.pages.map((page) => page.route),
  );
  assertEquals(
    document.querySelector("[data-search]")?.getAttribute(
      "data-search-endpoint",
    ),
    "/map/index.json",
  );
  dom.window.close();

  for (const page of [site.publicMap.landing, ...site.publicMap.pages]) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    const edition = await get(`${page.route}.md`);
    assertEquals(edition.status, 200, page.route);
    assertEquals(await edition.text(), raw, page.route);
  }
});

Deno.test("manual and Map search indexes are exhaustive and isolated", async () => {
  const site = await loadDocsSite();
  const manual = await (await get("/docs/index.json")).json() as {
    pages: Array<{ route: string }>;
  };
  const map = await (await get("/map/index.json")).json() as {
    pages: Array<{ route: string }>;
  };
  assertEquals(
    manual.pages.map((page) => page.route),
    [site.landing.route, ...site.pages.map((page) => page.route)],
  );
  assertEquals(
    map.pages.map((page) => page.route),
    [
      site.publicMap.landing.route,
      ...site.publicMap.pages.map((page) => page.route),
    ],
  );
  assert(manual.pages.every((page) => page.route.startsWith("/docs")));
  assert(map.pages.every((page) => page.route.startsWith("/map")));

  const llms = await (await get("/llms.txt")).text();
  assert(!llms.includes("https://discern.sh/map"));
  const manualHtml = await (await get("/docs")).text();
  assert(!manualHtml.includes('href="/map/orientation"'));
});

Deno.test("Map links resolve inside the exhibit and protected paths never route", async () => {
  const site = await loadDocsSite();
  const page = site.publicMap.pages.find((candidate) => !candidate.isIndex);
  assert(page !== undefined);
  assertEquals(
    rewriteLinks("[Map root](../README.md)", page, site),
    "[Map root](/map)",
  );
  for (
    const path of [
      "/map/_internal/phantom",
      "/map/_private/secret",
      "/map/orientation/withheld",
    ]
  ) {
    assertEquals((await get(path)).status, 404, path);
  }
});
