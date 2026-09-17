/** The separately framed public Map: canonical admission, routes, and isolation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename } from "@std/path";
import { discoverDocs, type DocEntry, isPublicDoc } from "../src/lib/docs.ts";
import { MAP_SECTION_REGISTRY, numberedDocRoute } from "../src/lib/paths.ts";
import {
  isPublicMapEntry,
  loadDocsSite,
  projectPublicMapPages,
  PUBLIC_MAP_ROUTE,
  rewriteLinks,
} from "../site/docs.tsx";
import { handler, liveHtmlRoutes } from "../site/serve.ts";
import { siteRoutes } from "../site/routes.ts";
import { repositoryBlobUrl } from "../src/shared/brand.ts";
import { renderMapPage } from "../site/ui/pages/MapPage.tsx";
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

Deno.test("the Map overview lists every admitted repository entry without document rails", async () => {
  const site = await loadDocsSite();
  const response = await get(PUBLIC_MAP_ROUTE);
  assertEquals(response.status, 200);
  const dom = new JSDOM(await response.text());
  const document = dom.window.document;
  assertEquals(document.querySelectorAll("main").length, 1);
  assertStringIncludes(
    document.querySelector("[aria-label='Live project exhibit']")
      ?.textContent ?? "",
    "working evidence from internal use",
  );
  assertEquals(
    document.querySelector(
      ".docs-nav, .docs-rail, [data-discern-search-palette], main details",
    ),
    null,
  );
  for (
    const heading of [
      "Where to start",
      "The sections",
      "Browsing and maintenance",
    ]
  ) {
    assert(
      ![...document.querySelectorAll("h1,h2,h3")].some((node) =>
        node.textContent === heading
      ),
    );
  }
  assertEquals(
    [...document.querySelectorAll("[data-map-entry]")].map((link) =>
      link.getAttribute("href")
    ),
    site.publicMap.sections.flatMap(
      (section) => [
        section.index,
        ...section.pages.filter((page) => !page.isIndex),
      ],
    ).map((page) => repositoryBlobUrl(`project/map/${page.sourcePath}`)),
  );
  dom.window.close();
  const raw = await get(`${PUBLIC_MAP_ROUTE}.md`);
  assertEquals(raw.status, 200);
  assertEquals(
    await raw.text(),
    await Deno.readTextFile(site.publicMap.landing.entry.absPath),
  );
});

Deno.test("Map entries enroll in the directory without creating site endpoints", async () => {
  const site = await loadDocsSite();
  const entries = [site.publicMap.landing, ...site.publicMap.pages].map(
    (page) => page.entry,
  );
  const fresh = entry(`${MAP_SECTION_REGISTRY[0]?.dir}/fresh-entry.md`);
  const insertion =
    entries.findIndex((item) => item.section === fresh.section) + 1;
  entries.splice(insertion, 0, fresh);
  const map = projectPublicMapPages(entries);
  const dom = new JSDOM(renderMapPage(map));
  assert(
    dom.window.document.querySelector(
      `a[href="${repositoryBlobUrl(fresh.path)}"]`,
    ) !== null,
  );
  assertEquals(
    siteRoutes({ ...site, publicMap: map }).map((route) => route.path),
    siteRoutes(site).map((route) => route.path),
  );
  dom.window.close();
});

Deno.test("Map leaves, section indexes, raw editions, and search have no site endpoints", async () => {
  const site = await loadDocsSite();
  assertEquals(
    liveHtmlRoutes(site).filter((route) => route.startsWith("/map")),
    [PUBLIC_MAP_ROUTE],
  );
  const inventory = siteRoutes(site);
  assert(!inventory.some((route) => route.path.startsWith("/map/")));
  const retired = site.publicMap.pages.flatMap((page) => {
    const route = numberedDocRoute(page.sourcePath, PUBLIC_MAP_ROUTE);
    assert(route);
    return [route, `${route}/`, `${route}.md`];
  });
  for (const path of [...retired, "/map/index.json"]) {
    const response = await get(path);
    assertEquals(response.status, 404, path);
    await response.body?.cancel();
  }
  const manual = await (await get("/docs/index.json")).json() as {
    pages: Array<{ route: string }>;
  };
  assertEquals(manual.pages.map((page) => page.route), [
    site.landing.route,
    ...site.pages.map((page) => page.route),
  ]);
  assert(
    !(await (await get("/llms.txt")).text()).includes("https://discern.sh/map"),
  );
});

Deno.test("Map links resolve to the overview or repository and protected paths never route", async () => {
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
