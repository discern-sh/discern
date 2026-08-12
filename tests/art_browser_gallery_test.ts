/** Registry, routing, and static-rendering contracts for the internal art archive. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { createElement } from "react";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  BROWSER_ARTWORK_ENTRIES,
  type BrowserArtworkEntry,
} from "../art/browser/renderers.tsx";
import {
  BROWSER_ARTWORKS,
  browserArtworkStylesheetNames,
} from "../art/browser/registry.ts";
import { artGalleryEntries } from "../art/terminal/gallery.ts";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";
import {
  ART_GALLERY_PATH,
  ART_STYLESHEET_PATHS,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const EXPECTED_BROWSER_ART = [
  ["alignment", "3006e8622db947c4417b4df2055e28820646ad2e"],
  ["bifurcation", "36084a9cf3cdabd04e9734468b07bdde6f73107b"],
  ["contour", "f7599b7669bfd3c4842c430adeb96330fbfa75d5"],
  ["persistent-trace", "ae15a479e7f169cbebcbf6c598d8c8b5d2ccbede"],
  ["invariant-core", "9b7b3eac0f1ffd1addeb970e1167866c855a37b1"],
  ["circuit", "d2792e90795f5201d10cd3f276b19b909a39aeb1"],
  ["seal", "8bc6327fa346340e770bdd6ca439724a28b21200"],
  ["delta", "7e6e5787a7d0b492f0c500b2c50ac08faf8280fb"],
  ["ratchet", "f958175315b0f89fa3cf6d0c9f76eb8bbd0543f5"],
  ["rule", "76be48e4a5f39b1e27ed218de4667a883272d50a"],
] as const;

/** Collapse prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Current and future files whose naming must stay independent of the old brief. */
async function neutralArtSources(): Promise<Array<[string, string]>> {
  const paths = [
    join(REPO_ROOT, "site/page-src/art-gallery.tsx"),
    join(REPO_ROOT, "site/page-src/art-gallery.css"),
  ];
  for await (
    const entry of walk(join(REPO_ROOT, "art/browser"), {
      includeDirs: false,
    })
  ) {
    paths.push(entry.path);
  }
  for await (
    const entry of walk(join(REPO_ROOT, "tests"), {
      includeDirs: false,
      exts: [".ts"],
      maxDepth: 1,
    })
  ) {
    if (/\/browser_art_.+_test\.ts$/.test(entry.path)) paths.push(entry.path);
  }
  return await Promise.all(
    paths.sort().map(async (path) => [
      relative(REPO_ROOT, path),
      await Deno.readTextFile(path),
    ]),
  );
}

Deno.test("browser art uses only neutral study vocabulary", async () => {
  const forbidden = [
    /\bbenefit\b/i,
    /benefit[-_]alignment/i,
    /quality[-_]contour/i,
    /freedom[-_]invariant/i,
    /BenefitAlignment|QualityContour|FreedomOfMovement/,
    /Delegate with confidence|Multiply your output/i,
    /Quality that only improves|Knowledge that compounds/i,
    /Freedom of movement/i,
  ];
  const offenders: string[] = [];
  for (const [path, source] of await neutralArtSources()) {
    for (const pattern of forbidden) {
      if (pattern.test(source)) offenders.push(`${path}: ${pattern.source}`);
    }
  }
  assertEquals(
    offenders,
    [],
    "browser-art names must describe the studies themselves, not the " +
      `superseded brief:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("the browser-art registry preserves the recorded source heads", async () => {
  assertEquals(
    BROWSER_ARTWORKS.map(({ slug, sourceCommit }) => [slug, sourceCommit]),
    EXPECTED_BROWSER_ART.map(([slug, sourceCommit]) => [slug, sourceCommit]),
  );
  assertEquals(
    new Set(BROWSER_ARTWORKS.map(({ slug }) => slug)).size,
    BROWSER_ARTWORKS.length,
  );
  assertEquals(
    browserArtworkStylesheetNames(),
    BROWSER_ARTWORKS.map(({ slug }) => `art-${slug}.css`),
  );
  for (const { slug } of BROWSER_ARTWORKS) {
    const source = new URL(`../art/browser/${slug}.css`, import.meta.url);
    assert((await Deno.stat(source)).isFile, `${slug} must own its stylesheet`);
  }
});

Deno.test("the art archive renders every browser study twice and every terminal member once", () => {
  const dom = new JSDOM(renderArtGallery());
  const document = dom.window.document;
  const studies = [...document.querySelectorAll("[data-browser-artwork]")];
  assertEquals(studies.length, BROWSER_ARTWORK_ENTRIES.length);

  for (const [index, artwork] of BROWSER_ARTWORK_ENTRIES.entries()) {
    const study = studies[index];
    assert(study !== undefined);
    assertEquals(study.getAttribute("data-browser-artwork"), artwork.slug);
    assertEquals(
      readableText(study.querySelector("h3")?.textContent ?? null),
      artwork.title,
    );
    assertStringIncludes(readableText(study.textContent), artwork.description);

    const themes = [...study.querySelectorAll(".art-gallery__theme")];
    assertEquals(
      themes.map((theme) => theme.getAttribute("data-discern-theme")),
      ["light", "dark"],
    );
    for (const theme of themes) {
      const svg = theme.querySelector('svg[role="img"]');
      assert(svg !== null, `${artwork.slug} must render one accessible SVG`);
      const labelledBy = (svg.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/).filter(Boolean);
      assertEquals(labelledBy.length, 2);
      for (const id of labelledBy) {
        assert(
          svg.querySelector(`#${id}`),
          `${id} must remain local to its SVG`,
        );
      }
    }
  }

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "gallery IDs must remain unique");

  const terminalCards = [...document.querySelectorAll(
    ".art-gallery__terminal",
  )];
  assertEquals(terminalCards.length, artGalleryEntries().length);
  for (const [index, { name, variant }] of artGalleryEntries().entries()) {
    const card = terminalCards[index];
    assert(card !== undefined);
    assertEquals(
      readableText(card.querySelector("header span")?.textContent ?? null),
      name,
    );
    assertEquals(card.querySelector("pre code")?.textContent, variant.render());
  }

  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the archive must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("a future browser-art member enrolls in rendering and stylesheet projection", () => {
  const future: BrowserArtworkEntry = {
    slug: "future-study",
    title: "Future study",
    description: "A prospective registry member used only to prove enrollment.",
    sourceCommit: "0000000000000000000000000000000000000000",
    render: (idPrefix) =>
      createElement(
        "svg",
        {
          role: "img",
          "aria-labelledby": `${idPrefix}-title ${idPrefix}-description`,
          "data-future-art": "true",
        },
        createElement("title", { id: `${idPrefix}-title` }, "Future art"),
        createElement(
          "desc",
          { id: `${idPrefix}-description` },
          "Future registry enrollment",
        ),
      ),
  };
  const family = [...BROWSER_ARTWORK_ENTRIES, future];
  const html = renderArtGallery(family, []);
  const dom = new JSDOM(html);

  assertEquals(
    browserArtworkStylesheetNames(family).at(-1),
    "art-future-study.css",
  );
  assertEquals(
    dom.window.document.querySelectorAll(
      '[data-browser-artwork="future-study"] [data-future-art="true"]',
    ).length,
    2,
  );
  assert(
    [...dom.window.document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"]',
    )].some((link) => link.href.endsWith("/art-future-study.css")),
  );
  dom.window.close();
});

Deno.test("the loopback server owns /art/ while the public handler does not", async () => {
  assertEquals(Object.hasOwn(PAGES, "/art"), false);
  assertEquals(Object.hasOwn(PAGES, ART_GALLERY_PATH), false);
  for (const path of ["/art", ART_GALLERY_PATH]) {
    const publicResponse = await handler(
      new Request(`https://discern.sh${path}`),
    );
    assertEquals(publicResponse.status, 404, path);
    await publicResponse.body?.cancel();
  }

  const redirect = await specimenHandler(new Request("http://localhost/art"));
  assertEquals(redirect.status, 308);
  assertEquals(redirect.headers.get("location"), ART_GALLERY_PATH);

  const page = await specimenHandler(
    new Request(`http://localhost${ART_GALLERY_PATH}`),
  );
  assertEquals(page.status, 200);
  assertEquals(page.headers.get("cache-control"), "no-store");
  assertEquals(page.headers.get("x-robots-tag"), "noindex, nofollow");
  const html = await page.text();
  assertStringIncludes(html, "Art studies.");

  assertEquals(ART_STYLESHEET_PATHS.length, BROWSER_ARTWORKS.length + 2);
  for (const path of ART_STYLESHEET_PATHS) {
    assertStringIncludes(html, path);
    const stylesheet = await specimenHandler(
      new Request(`http://localhost${path}`),
    );
    assertEquals(stylesheet.status, 200, path);
    assertStringIncludes(
      stylesheet.headers.get("content-type") ?? "",
      "text/css",
    );
    assertEquals(stylesheet.headers.get("cache-control"), "no-store");
    assert((await stylesheet.text()).trim().length > 0, path);

    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }

  const rejectedPage = await specimenHandler(
    new Request(`http://localhost${ART_GALLERY_PATH}`, { method: "POST" }),
  );
  assertEquals(rejectedPage.status, 405);
  assertEquals(rejectedPage.headers.get("allow"), "GET, HEAD");
  await rejectedPage.body?.cancel();

  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertEquals(config.tasks?.["site:art"], "deno task site:specimens");
});
