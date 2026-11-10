/**
 * Contracts for the homepage wall island: the one place the site ships a
 * component that the browser hydrates. They hold the seam between the server
 * render and the bundle, and the boundary that keeps a framework runtime off
 * every other route.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl, join } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import {
  DISCERN_CATEGORY_LINE,
  DISCERN_MARK,
  LANDING_HEADLINE,
} from "../site/brand.ts";
import {
  DESIGN_SYSTEM_BUNDLES,
  designSystemAssetPath,
} from "../site/design_system.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { bundleBrowserModule } from "../site/page-src/format-generated.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";
import {
  WALL_ISLAND_ENTRY,
  WALL_ISLAND_HASH_LENGTH,
  WALL_STYLESHEETS,
  wallIslandContentHash,
} from "../site/wall/assets.ts";
import { WALL_ABSENT, WALL_DECK } from "../site/wall/deck.ts";
import {
  decodeWallProps,
  encodeWallProps,
  WALL_HOST_ID,
  WALL_PROPS_ATTRIBUTE,
} from "../site/wall/host.ts";
import { WALL_KNOBS, wallKnobStyle } from "../site/wall/tuning/knobs.ts";
import { WallPage, type WallPageProps } from "../site/wall/WallPage.tsx";
import {
  moduleSpecifiers,
  reactRuntimeModules,
} from "./design_system_dependency.ts";
import {
  carriesReactRuntime,
  loadedScripts,
  type WallIslandReference,
  wallIslandReferences,
} from "./runtime_asset_references.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 wall island contract",
};

const SERVER_PROPS: WallPageProps = {
  mark: DISCERN_MARK,
  version: DISCERN_VERSION,
  headline: LANDING_HEADLINE,
  categoryLine: DISCERN_CATEGORY_LINE,
};

/** Serve one path through the production handler as a browser would ask for it. */
function get(path: string): Promise<Response> {
  return handler(
    new Request(`https://discern.sh${path}`, { headers: BROWSER }),
  );
}

/** The one island bundle the built homepage loads. */
async function homepageWallIsland(): Promise<WallIslandReference> {
  const [island, ...others] = wallIslandReferences(
    await (await get("/")).text(),
  );
  assert(
    island !== undefined && others.length === 0,
    "the built homepage loads exactly one wall island",
  );
  return island;
}

/** Every `--wall-*` custom property a text names, by `pattern`'s first group. */
function wallProperties(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ""));
}

Deno.test("the homepage serves the wall exactly as the island renders it", async () => {
  const html = await (await get("/")).text();
  const dom = new JSDOM(html);
  const host = dom.window.document.getElementById(WALL_HOST_ID);
  assert(host !== null, "the homepage carries the island host");
  const props = decodeWallProps(host.getAttribute(WALL_PROPS_ATTRIBUTE));
  assertEquals(props, SERVER_PROPS);
  assertEquals(
    host.childNodes.length,
    1,
    "the host holds the wall root and no stray node for hydration to trip on",
  );
  assert(host.firstElementChild?.classList.contains("wall"));
  dom.window.close();

  // Hydration has nothing to reconcile only while the served bytes are what
  // the same component renders from the props the host carries. That also
  // proves the build's formatter left the island's markup alone.
  assertStringIncludes(
    html,
    `>${renderToString(createElement(WallPage, props))}</div>`,
  );
});

Deno.test("the island reads back the props the server wrote, and refuses anything else", () => {
  assertEquals(decodeWallProps(encodeWallProps(SERVER_PROPS)), SERVER_PROPS);
  for (
    const malformed of [
      null,
      "null",
      '"text"',
      "{}",
      JSON.stringify({ ...SERVER_PROPS, version: 1 }),
    ]
  ) {
    assertThrows(() => decodeWallProps(malformed), Error);
  }
});

Deno.test("every tuning knob reaches the wall root as its own custom property", async () => {
  const names = WALL_KNOBS.map((knob) => knob.name);
  assertEquals(new Set(names).size, names.length, "knob names are unique");
  for (const knob of WALL_KNOBS) {
    assert(/^[a-z]+(?:-[a-z]+)*$/.test(knob.name), knob.name);
    assert(knob.step > 0, `${knob.name} has a usable step`);
    assert(
      knob.min <= knob.default && knob.default <= knob.max,
      `${knob.name} defaults inside its own range`,
    );
  }

  const dom = new JSDOM(await (await get("/")).text());
  const style = dom.window.document.querySelector(".wall")?.getAttribute(
    "style",
  ) ?? "";
  dom.window.close();
  const declarations = Object.entries(wallKnobStyle());
  assertEquals(declarations.length, WALL_KNOBS.length);
  for (const [property, value] of declarations) {
    assertStringIncludes(style, `${property}:${value}`);
  }
});

Deno.test("wall stylesheets read wall properties that exist, with no fallback values", async () => {
  const scripts = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_island_test.ts#script-written-properties",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the wall's own modules write wall custom properties from script.",
        include: (path) => path.startsWith("site/wall/"),
      },
    }),
  );
  assert(scripts.length > 0);
  const known = new Set(Object.keys(wallKnobStyle()));
  for (const { source } of scripts) {
    for (const name of wallProperties(source, /(--wall-[a-z0-9-]+)/g)) {
      known.add(name);
    }
  }
  const sheets = await Promise.all(WALL_STYLESHEETS.map(async (sheet) => ({
    sheet,
    text: await Deno.readTextFile(join(ROOT, "site/page-src", sheet)),
  })));
  for (const { text } of sheets) {
    for (const name of wallProperties(text, /(--wall-[a-z0-9-]+)\s*:/g)) {
      known.add(name);
    }
  }

  const violations: string[] = [];
  for (const { sheet, text } of sheets) {
    for (
      const name of wallProperties(text, /var\(\s*(--wall-[a-z0-9-]+)\s*,/g)
    ) {
      violations.push(`${sheet}: ${name} is read with a fallback value`);
    }
    for (const name of wallProperties(text, /var\(\s*(--wall-[a-z0-9-]+)/g)) {
      if (!known.has(name)) {
        violations.push(`${sheet}: ${name} is read but nothing declares it`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("deck ids are unique, and an absent benefit is never also a card", () => {
  const ids = WALL_DECK.map((card) => card.id);
  assertEquals(new Set(ids).size, ids.length);
  assertEquals(ids.filter((id) => Object.hasOwn(WALL_ABSENT, id)), []);
});

Deno.test("only the island entry imports React's browser client, and nothing imports the island", async () => {
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_island_test.ts#browser-client-boundary",
      universe: "authored-ts",
    }),
  );
  assertEquals(
    sources.filter(({ source }) =>
      /["'](?:npm:)?react-dom(?:@[^"'/]+)?\/client["']/.test(source)
    ).map(({ path }) => path),
    [WALL_ISLAND_ENTRY],
    "React's browser client enters the repository through the island alone",
  );
  assertEquals(
    sources.filter(({ source }) =>
      /\b(?:from|import)\s*\(?\s*["'][^"']*\bisland\.tsx["']/.test(source)
    ).map(({ path }) => path),
    [],
    "the island is a bundle entry, never a module another module imports",
  );

  // The build names the island by path and hands it to the bundler; its own
  // module graph, like the server's, never loads the browser entry.
  const buildGraph = await moduleSpecifiers(join(ROOT, "site/build.ts"));
  assertEquals(
    buildGraph.filter((specifier) => specifier.endsWith(WALL_ISLAND_ENTRY)),
    [],
  );
  assertEquals(
    reactRuntimeModules(buildGraph).filter((specifier) =>
      /react-dom[^\s]*\/client(?:[.@/]|$)/.test(specifier)
    ),
    [],
  );
});

Deno.test("a React runtime is found by content, through imports, under any file name", async () => {
  const files: Readonly<Record<string, string>> = {
    "/assets/page.js": 'import { run } from "./lib/widgets.js";\nrun();',
    "/assets/lib/widgets.js":
      'const kind = Symbol.for("react.element");\nexport const run = () => kind;',
  };
  const scripts = await loadedScripts(
    '<link rel="stylesheet" href="/assets/page.css" />' +
      '<script type="module" src="/assets/page.js?v=1"></script>' +
      '<script type="module" src="/assets/missing.js"></script>',
    (path) => Promise.resolve(files[path]),
  );
  assertEquals([...scripts.keys()].toSorted(), [
    "/assets/lib/widgets.js",
    "/assets/page.js",
  ]);
  assertEquals(
    [...scripts].filter(([, source]) => carriesReactRuntime(source)).map((
      [path],
    ) => path),
    ["/assets/lib/widgets.js"],
  );
});

Deno.test("the built island is the bundle of its entry, named by the digest of its bytes", async () => {
  const { file, path } = await homepageWallIsland();
  assertEquals(
    path,
    designSystemAssetPath("compositions", file),
    "the island ships beside the homepage's own bundle",
  );
  const body = await Deno.readTextFile(
    join(ROOT, "site", DESIGN_SYSTEM_BUNDLES.compositions.output, file),
  );
  const digest = encodeHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  assertEquals(
    wallIslandContentHash(file),
    digest.slice(0, WALL_ISLAND_HASH_LENGTH),
  );
  assert(carriesReactRuntime(body), "the island hydrates with React");

  const banner =
    `/* Generated by site/build.ts from ${WALL_ISLAND_ENTRY}. Do not edit. */\n`;
  assert(body.startsWith(banner));
  assertEquals(
    body.slice(banner.length),
    await bundleBrowserModule(join(ROOT, WALL_ISLAND_ENTRY)),
    "the built island is stale: run `deno task site:build`",
  );
});

Deno.test("the island loads on the homepage and no other route loads a React runtime", async () => {
  const island = await homepageWallIsland();
  const served = new Map<string, string | undefined>();
  const read = async (path: string): Promise<string | undefined> => {
    if (!served.has(path)) {
      const response = await get(path);
      served.set(path, response.ok ? await response.text() : undefined);
    }
    return served.get(path);
  };

  const routes = liveHtmlRoutes(await loadDocsSite());
  assert(routes.includes("/") && routes.length > 1);
  // A path nothing serves stands in for the not-found shell.
  for (const route of [...routes, "/no-such-page"]) {
    const html = await (await get(route)).text();
    assertEquals(
      wallIslandReferences(html).map((reference) => reference.path),
      route === "/" ? [island.path] : [],
      `${route} and the island reference`,
    );
    const scripts = await loadedScripts(html, read);
    assertEquals(
      [...scripts].filter(([, source]) => carriesReactRuntime(source)).map((
        [path],
      ) => path),
      route === "/" ? [island.path] : [],
      `${route} loads a React runtime outside the homepage island`,
    );
  }
});
