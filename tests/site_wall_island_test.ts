/**
 * Contracts for the homepage wall island: the one place the site ships a
 * component that the browser hydrates. They hold the seam between the server
 * render and the bundle, the props that cross it, and the boundary that keeps
 * a framework runtime off every other route. They hold the island's delivery
 * too: a bundle that is not the island gets no name, and only a file named by
 * the digest of its bytes is cached for good.
 */

import {
  assert,
  assertEquals,
  assertRejects,
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
  carriesReactRuntime,
  WALL_ISLAND_ENTRY,
  WALL_ISLAND_HASH_LENGTH,
  WALL_STYLESHEETS,
  wallIslandContentHash,
  wallIslandFault,
  wallIslandFile,
} from "../site/wall/assets.ts";
import { WALL_DECK } from "../site/wall/deck.ts";
import {
  decodeWallProps,
  encodeWallProps,
  linkRoute,
  WALL_HOST_ID,
  WALL_PROPS_ATTRIBUTE,
  type WallPageProps,
} from "../site/wall/host.ts";
import {
  WALL_KNOBS,
  wallKnobProperty,
  wallKnobStyle,
} from "../site/wall/tuning/knobs.ts";
import { KEYBOARD_ON_STAGE, NEAR_ATTRIBUTE } from "../site/wall/use_stage.ts";
import { WallPage } from "../site/wall/WallPage.tsx";
import {
  moduleSpecifiers,
  reactRuntimeModules,
} from "./design_system_dependency.ts";
import {
  loadedScripts,
  runtimeAssetReferences,
  type WallIslandReference,
  wallIslandReferences,
} from "./runtime_asset_references.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import { splitOutside, styleRules, wallSheets } from "./wall_stylesheets.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 wall island contract",
};

/** The title of every page the manual publishes, by route. */
const MANUAL_TITLES = await loadDocsSite().then((site) =>
  new Map(
    [site.landing, ...site.pages].map((page) => [page.route, page.entry.title]),
  )
);

/** Every card that links into the manual, with the route its link leads to. */
const LINKED_CARDS = WALL_DECK.flatMap((card) =>
  card.href === undefined
    ? []
    : [{ id: card.id, href: card.href, route: linkRoute(card.href) }]
);

const SERVER_PROPS: WallPageProps = {
  mark: DISCERN_MARK,
  version: DISCERN_VERSION,
  headline: LANDING_HEADLINE,
  categoryLine: DISCERN_CATEGORY_LINE,
  linkLabels: Object.fromEntries(
    LINKED_CARDS.map(({ route }) => [route, MANUAL_TITLES.get(route) ?? ""]),
  ),
};

/** The leading hex digits of the SHA-256 digest of `bytes`, as a file name carries them. */
async function contentHash(bytes: BufferSource): Promise<string> {
  return encodeHex(await crypto.subtle.digest("SHA-256", bytes)).slice(
    0,
    WALL_ISLAND_HASH_LENGTH,
  );
}

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

/**
 * Every authored module under `site/wall`: the only code that writes the
 * wall's custom properties and state attributes, or reads them back.
 */
const WALL_SOURCES = await readScopedSources(
  ROOT,
  await structuralGuardScope({
    guard: "tests/site_wall_island_test.ts#script-written-properties",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only the wall's own modules write wall custom properties and state attributes from script.",
      include: (path) => path.startsWith("site/wall/"),
    },
  }),
);

/** Every selector of every style rule in a stylesheet, one per list member. */
function selectorsOf(text: string): string[] {
  return styleRules(text).filter((rule) => !rule.prelude.startsWith("@"))
    .flatMap((rule) => rule.selectors);
}

/** The wall root named in a selector's first box: `.wall` and its states. */
const ROOT_BOX = /^\.wall(?![\w-])/;

/**
 * State attributes that no stylesheet selects, each with the module that
 * reads it and the expression it reads it by.
 */
const ATTRIBUTE_READERS: Readonly<
  Record<string, { readonly path: string; readonly read: string }>
> = {
  [WALL_PROPS_ATTRIBUTE]: {
    path: "site/wall/island.tsx",
    read: "host.getAttribute(WALL_PROPS_ATTRIBUTE)",
  },
};

/** The attribute a `dataset` member is written to: `wallNear` is `data-wall-near`. */
function datasetAttribute(member: string): string {
  return `data-${
    member.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)
  }`;
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
  const { linkLabels: _, ...withoutLabels } = SERVER_PROPS;
  for (
    const malformed of [
      null,
      "null",
      '"text"',
      "{}",
      JSON.stringify({ ...SERVER_PROPS, version: 1 }),
      JSON.stringify(withoutLabels),
      JSON.stringify({ ...SERVER_PROPS, linkLabels: null }),
      JSON.stringify({ ...SERVER_PROPS, linkLabels: ["A page"] }),
      JSON.stringify({ ...SERVER_PROPS, linkLabels: { "/docs": 1 } }),
    ]
  ) {
    assertThrows(() => decodeWallProps(malformed), Error);
  }
});

Deno.test("every card link has a label, and the label is the title of the manual page it leads to", async () => {
  const dom = new JSDOM(await (await get("/")).text());
  const { linkLabels } = decodeWallProps(
    dom.window.document.getElementById(WALL_HOST_ID)?.getAttribute(
      WALL_PROPS_ATTRIBUTE,
    ) ?? null,
  );
  dom.window.close();
  assert(
    LINKED_CARDS.some(({ href, route }) => href !== route) &&
      LINKED_CARDS.some(({ href, route }) => href === route),
    "the deck links to pages and to sections of pages",
  );

  // The deck names a page by its address alone. The server reads each
  // page's title from the manual and hands it to the island, so a label
  // cannot drift from the page it names.
  const faults: string[] = [];
  for (const { id, href, route } of LINKED_CARDS) {
    const title = MANUAL_TITLES.get(route);
    if (title === undefined || title.trim() === "") {
      faults.push(`${id} links to ${href}: no manual page with a title`);
    } else if (linkLabels[route] !== title) {
      faults.push(
        `${id} links to ${href}: the page is titled "${title}", and the island was handed ${
          JSON.stringify(linkLabels[route])
        }`,
      );
    }
  }
  assertEquals(faults, []);
  assertEquals(
    Object.keys(linkLabels).toSorted(),
    [...new Set(LINKED_CARDS.map(({ route }) => route))].toSorted(),
    "the island is handed a label for every page the deck links to, and for no other",
  );
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
  const scripts = WALL_SOURCES;
  assert(scripts.length > 0);
  const known = new Set(Object.keys(wallKnobStyle()));
  for (const { source } of scripts) {
    for (const name of wallProperties(source, /(--wall-[a-z0-9-]+)/g)) {
      known.add(name);
    }
  }
  const sheets = await wallSheets();
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

Deno.test("every wall property a stylesheet declares, and every knob, has a reader", async () => {
  const scripts = WALL_SOURCES;
  const sheets = await wallSheets();
  const readBySheet = new Set(
    sheets.flatMap(({ text }) => [
      ...wallProperties(text, /var\(\s*(--wall-[a-z0-9-]+)/g),
    ]),
  );
  const namedByScript = new Set(
    scripts.flatMap(({ source }) => [
      ...wallProperties(source, /(--wall-[a-z0-9-]+)/g),
    ]),
  );

  // A value a stylesheet sets is read by a stylesheet, or by script that
  // asks the browser for it by name. One that neither reads is dead state.
  const violations: string[] = [];
  let declared = 0;
  for (const { sheet, text } of sheets) {
    for (const name of wallProperties(text, /(--wall-[a-z0-9-]+)\s*:/g)) {
      declared++;
      if (!readBySheet.has(name) && !namedByScript.has(name)) {
        violations.push(`${sheet}: ${name} is declared and never read`);
      }
    }
  }
  assert(declared > 0, "the wall stylesheets declare properties of their own");

  // A knob is read by a stylesheet, or by a module that asks the wall root
  // for it through `wallKnobProperty` and names it there.
  const knobReaders = scripts.filter(({ path, source }) =>
    path !== "site/wall/tuning/knobs.ts" && source.includes("wallKnobProperty(")
  );
  for (const knob of WALL_KNOBS) {
    const read = readBySheet.has(wallKnobProperty(knob.name)) ||
      knobReaders.some(({ source }) => source.includes(`"${knob.name}"`));
    if (!read) violations.push(`the ${knob.name} knob turns nothing`);
  }
  assertEquals(violations, []);
});

Deno.test("every state attribute the wall writes is selected by a stylesheet or read by a named module, and none is selected unwritten", async () => {
  const scripts = WALL_SOURCES;
  const sheets = await wallSheets();
  const written = new Map<string, string>();
  for (const { path, source } of scripts) {
    for (const [name] of source.matchAll(/data-wall-[a-z]+(?:-[a-z]+)*/g)) {
      if (!written.has(name)) written.set(name, path);
    }
    for (
      const [, member = ""] of source.matchAll(/\.dataset\.(wall[A-Z]\w*)/g)
    ) {
      const name = datasetAttribute(member);
      if (!written.has(name)) written.set(name, path);
    }
  }
  assert(written.size > 0, "the wall marks its state with attributes");
  const selected = new Set(
    sheets.flatMap(({ text }) =>
      [...text.matchAll(/\[(data-wall-[a-z]+(?:-[a-z]+)*)/g)].map((match) =>
        match[1] ?? ""
      )
    ),
  );

  const violations: string[] = [];
  for (const [name, path] of written) {
    if (selected.has(name)) continue;
    const reader = ATTRIBUTE_READERS[name];
    const reads = reader !== undefined &&
      scripts.some(({ path, source }) =>
        path === reader.path && source.includes(reader.read)
      );
    if (!reads) {
      violations.push(
        `${path} writes ${name}, which no wall stylesheet selects and no named module reads`,
      );
    }
  }
  for (const name of selected) {
    if (!written.has(name)) {
      violations.push(
        `a wall stylesheet selects ${name}, which nothing writes`,
      );
    }
  }
  for (const name of Object.keys(ATTRIBUTE_READERS)) {
    if (!written.has(name) || selected.has(name)) {
      violations.push(`${name} has a named reader it does not need`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("every far-view rule stands down under the keyboard's focus, and looks for that focus from the box it styles", async () => {
  const selectors = (await wallSheets()).flatMap(({ text }) =>
    selectorsOf(text)
  );
  const away = `:not([${NEAR_ATTRIBUTE}])`;
  const far = selectors.filter((selector) => selector.includes(away));
  assert(far.length >= 6, "the stylesheet stages a far view");
  const violations: string[] = [];
  for (const selector of far) {
    const [root = "", box = "", ...within] = splitOutside(selector, " ");
    if (!ROOT_BOX.test(root) || !root.includes(away)) {
      violations.push(`${selector}: the wall root says whether it is near`);
    }
    // The stage's own rules use the stage hook's selector whole, so script
    // and stylesheet cannot disagree about which focus lays the wall flat.
    // Any other rule looks for the focus from a box beneath the root: the
    // one it names first, or one inside it.
    const standsDown = box.startsWith(".wall-stage")
      ? box.includes(`:not(${KEYBOARD_ON_STAGE})`)
      : [box, ...within].some((compound) =>
        compound.includes(":not(:has(:focus-visible)")
      );
    if (!standsDown) {
      violations.push(`${selector} holds a box the keyboard's focus is in`);
    }
  }

  // A rule that asked the wall root what it holds would have the browser
  // restyle the whole wall each time the answer could change, which for the
  // focus is every step of the keyboard.
  for (const selector of selectors) {
    const [root = ""] = splitOutside(selector, " ");
    if (ROOT_BOX.test(root) && root.includes(":has(")) {
      violations.push(`${selector} looks through the whole wall from its root`);
    }
  }
  assertEquals(violations, []);
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
  assertEquals(
    wallIslandContentHash(file),
    await contentHash(new TextEncoder().encode(body)),
  );
  assertEquals(wallIslandFault(body), undefined, "the built file is an island");

  // The build publishes what `wallIslandFile` makes of the entry's bundle,
  // so a fresh bundle gives the built file back, name and text.
  assertEquals(
    { file, body },
    await wallIslandFile(
      await bundleBrowserModule(join(ROOT, WALL_ISLAND_ENTRY)),
    ),
    "the built island is stale: run `deno task site:build`",
  );
});

Deno.test("a bundle that is not the island is refused and gets no name, and the island is named in one place", async () => {
  const runtime = 'const kind = Symbol.for("react.element");';
  const hydrate = `document.getElementById("${WALL_HOST_ID}");`;
  assert(carriesReactRuntime(runtime) && !carriesReactRuntime(hydrate));
  const island = `${runtime}\n${hydrate}`;
  assertEquals(wallIslandFault(island), undefined);
  const { file, body } = await wallIslandFile(island);
  assert(body.endsWith(island), "the file is the bundle under a banner");
  assertEquals(
    wallIslandContentHash(file),
    await contentHash(new TextEncoder().encode(body)),
  );

  // A bundler that ends without a fault and with nothing, or with a script
  // that could never hydrate the wall, must stop the build: a homepage
  // published with it would show controls that never come alive.
  for (
    const [script, why] of [
      ["", "an empty bundle"],
      [runtime, "a bundle that never names the host element"],
      [hydrate, "a bundle with no React runtime"],
    ] as const
  ) {
    assert(wallIslandFault(script) !== undefined, why);
    await assertRejects(
      () => wallIslandFile(script),
      Error,
      "is not the wall island",
      why,
    );
  }

  // `wallIslandFile` is the only place the island's file name is spelled,
  // so no module can name a bundle an island without passing its check.
  const spelled = (await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_island_test.ts#island-file-name",
      universe: "authored-ts",
      narrow: {
        reason:
          "The site's own modules build, name, and serve the island; tests and scripts only recognize its name.",
        include: (path) => path.startsWith("site/"),
      },
    }),
  )).filter(({ source }) => /wall-island\\?\./.test(source)).map(({ path }) =>
    path
  );
  assertEquals(
    spelled,
    ["site/wall/assets.ts"],
    "another module spells the island's file name, and could name a bundle that was never checked",
  );
});

Deno.test("a file is cached for good exactly when its name carries the digest of its bytes", async () => {
  const island = await homepageWallIsland();
  const assets = [
    ...new Set(
      runtimeAssetReferences(await (await get("/")).text()).map((reference) =>
        reference.replace(/[?#].*$/, "")
      ).filter((reference) => reference.startsWith("/")),
    ),
  ];
  assert(
    assets.includes(island.path) && assets.length > WALL_STYLESHEETS.length,
    "the homepage loads the island and its stylesheets",
  );
  const kept: string[] = [];
  for (const path of assets) {
    const response = await get(path);
    assertEquals(response.status, 200, path);
    const policy = response.headers.get("cache-control") ?? "";
    const seconds = Number(/max-age=(\d+)/.exec(policy)?.[1]);
    const named = wallIslandContentHash(path.slice(path.lastIndexOf("/") + 1));
    const bytes = await response.arrayBuffer();
    if (named === undefined) {
      // A name that says nothing of the bytes may be rebuilt under it.
      assert(
        !policy.includes("immutable") && seconds <= 3600,
        `${path} is cached as "${policy}", though its name does not change with its bytes`,
      );
      continue;
    }
    kept.push(path);
    assertEquals(
      named,
      await contentHash(bytes),
      `${path} is served under a name that is not the digest of its bytes`,
    );
    assert(
      policy.includes("immutable") && seconds >= 365 * 24 * 60 * 60,
      `${path} is named by its bytes and cached only as "${policy}"`,
    );
  }
  assertEquals(kept, [island.path]);

  // A name of the right shape that the build never wrote is no file at all.
  const missing = await get(
    designSystemAssetPath(
      "compositions",
      `wall-island.${"0".repeat(WALL_ISLAND_HASH_LENGTH)}.js`,
    ),
  );
  assertEquals(missing.status, 404);
  assert(!(missing.headers.get("cache-control") ?? "").includes("immutable"));
  await missing.body?.cancel();
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
