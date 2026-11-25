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
import { SETUP_PROMPT, SETUP_PROMPT_ID } from "../site/wall/SetupPrompt.tsx";
import { WALL_KNOBS, wallKnobStyle } from "../site/wall/tuning/knobs.ts";
import { WallPage } from "../site/wall/WallPage.tsx";
import { WORKS_WITH_LABEL } from "../site/wall/WorksWith.tsx";
import { providerBrandSilhouette, PROVIDERS } from "../src/lib/providers.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
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

/**
 * Every provider in the live registry, in the registry's own order. The
 * pool's row of agents is held to this list, so a provider added to the
 * registry is expected on the page with no change here.
 */
const REGISTERED_PROVIDERS = AGENT_NAMES.map((name) => PROVIDERS[name]);

const SERVER_PROPS: WallPageProps = {
  mark: DISCERN_MARK,
  version: DISCERN_VERSION,
  headline: LANDING_HEADLINE,
  categoryLine: DISCERN_CATEGORY_LINE,
  linkLabels: Object.fromEntries(
    LINKED_CARDS.map(({ route }) => [route, MANUAL_TITLES.get(route) ?? ""]),
  ),
  agents: REGISTERED_PROVIDERS.map((provider) => ({
    label: provider.label,
    mark: providerBrandSilhouette(provider.brand).path,
  })),
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
  const { agents: __, ...withoutAgents } = SERVER_PROPS;
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
      JSON.stringify(withoutAgents),
      JSON.stringify({ ...SERVER_PROPS, agents: { label: "An agent" } }),
      JSON.stringify({ ...SERVER_PROPS, agents: ["An agent"] }),
      JSON.stringify({ ...SERVER_PROPS, agents: [{ label: "An agent" }] }),
      JSON.stringify({
        ...SERVER_PROPS,
        agents: [{ label: "An agent", mark: 1 }],
      }),
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

Deno.test("the pool's row shows exactly the registry's providers, each by name and by its own silhouette", async () => {
  const dom = new JSDOM(await (await get("/")).text());
  const document = dom.window.document;
  const list = document.querySelector(".wall-pool .wall-agents-list");
  assert(list !== null, "the pool carries the row of agents");
  assertEquals(
    document.getElementById(list.getAttribute("aria-labelledby") ?? "")
      ?.textContent,
    WORKS_WITH_LABEL,
    "the row's words name its list",
  );
  const shown = [...list.querySelectorAll("[role='img']")].map((mark) => ({
    name: mark.getAttribute("aria-label"),
    style: mark.getAttribute("style") ?? "",
  }));
  assertEquals(
    list.children.length,
    shown.length,
    "the list holds one mark per item and nothing else",
  );
  dom.window.close();

  // The registry is the list, in its own order. A mark is a picture with no
  // words beside it, so the agent's name is the only thing that says whose
  // it is.
  assert(REGISTERED_PROVIDERS.length > 0);
  assertEquals(
    Object.keys(PROVIDERS).toSorted(),
    REGISTERED_PROVIDERS.map((provider) => provider.name).toSorted(),
  );
  assertEquals(
    shown.map((mark) => mark.name),
    REGISTERED_PROVIDERS.map((provider) => provider.label),
  );
  assertEquals(
    new Set(shown.map((mark) => mark.name)).size,
    shown.length,
    "no two marks share a name",
  );
  for (const [at, provider] of REGISTERED_PROVIDERS.entries()) {
    // The stylesheet tints the vendor's own backgroundless drawing through
    // a mask, so the page must name that file and the site must serve it.
    const silhouette = providerBrandSilhouette(provider.brand).path;
    assertStringIncludes(
      shown[at]?.style ?? "",
      `url("${silhouette}")`,
      provider.label,
    );
    const response = await get(silhouette);
    assertEquals(response.status, 200, silhouette);
    assertStringIncludes(
      response.headers.get("content-type") ?? "",
      "image/svg+xml",
      silhouette,
    );
    await response.body?.cancel();
  }
});

Deno.test("the setup prompt has one source, and the homepage shows its words once", async () => {
  const html = await (await get("/")).text();
  const dom = new JSDOM(html);
  const words = dom.window.document.getElementById(SETUP_PROMPT_ID);
  assertEquals(words?.textContent, SETUP_PROMPT);
  assert(
    words?.closest(".wall-closing") !== null,
    "the closing section shows the prompt, with or without script",
  );
  dom.window.close();
  assertEquals(
    html.split(SETUP_PROMPT).length - 1,
    1,
    "the page carries the prompt's words once: the copy controls take them from the island, not from a second copy in the markup",
  );

  // Every copy control and every test reads the one constant. A module that
  // spelled a sentence of the prompt itself would be a second source, free
  // to drift from what the page shows and copies.
  const sentences = SETUP_PROMPT.split(/(?<=\.)\s+/);
  assert(sentences.length > 1 && sentences.every((each) => each.length > 20));
  const spelled = (await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_island_test.ts#setup-prompt-source",
      universe: "authored-deno",
    }),
  )).filter(({ source }) =>
    sentences.some((sentence) => source.includes(sentence))
  ).map(({ path }) => path);
  assertEquals(spelled, ["site/wall/SetupPrompt.tsx"]);
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
