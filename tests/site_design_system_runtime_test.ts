/** Consumer checks for Discern's selected published design-system runtime. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";
import { packageManifest, type RuntimeManifest } from "discern-design-system";
import {
  COPIED_PAGE_ASSETS,
  GENERATED_SITE_OUTPUTS,
  RETIRED_SITE_OUTPUTS,
} from "../site/build.ts";
import {
  DESIGN_SYSTEM_BUNDLES,
  designSystemAssetPath,
  type DesignSystemBundleName,
} from "../site/design_system.ts";
import { renderDiscernBrand } from "../site/page-src/branding.tsx";
import { formatGeneratedText } from "../site/page-src/format-generated.ts";
import { renderLanding } from "../site/page-src/landing.tsx";
import { handler } from "../site/serve.ts";
import { providerBrandSilhouette, PROVIDERS } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { runtimeAssetReferences } from "./runtime_asset_references.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const SITE_ROOT = join(ROOT, "site");
const DESIGN_SYSTEM_SPECIFIER = "jsr:@discern-sh/design-system@0.10.1";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 Safari/605.1.15",
};

interface DenoConfig {
  readonly workspace?: readonly string[];
  readonly imports: Readonly<Record<string, string>>;
  readonly minimumDependencyAge?: {
    readonly age: string;
    readonly exclude: readonly string[];
  };
}

interface DenoLock {
  readonly specifiers: Readonly<Record<string, string>>;
  readonly jsr: Readonly<Record<string, unknown>>;
}

interface DenoInfo {
  readonly modules?: readonly { readonly specifier?: string }[];
}

/** Select runtime React dependencies while excluding type-only package declarations. */
function reactRuntimeModules(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) =>
    !specifier.startsWith("npm:/@types/") &&
    /(?:^|[/@-])react(?:-dom)?(?:[/.@-]|$)/i.test(specifier)
  );
}

/** Read Deno's resolved module graph for one site entrypoint. */
async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  const info = JSON.parse(new TextDecoder().decode(output.stdout)) as DenoInfo;
  return (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}

/** Run a repository-scoped Git probe with captured output for design-system provenance checks. */
async function git(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args,
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

/** Recursively enumerate every generated bundle file for tracked-output and provenance checks. */
async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

/** Resolve one declared design-system bundle's generated output directory. */
function bundleRoot(name: DesignSystemBundleName): string {
  return join(ROOT, "site", DESIGN_SYSTEM_BUNDLES[name].output);
}

/** Extract a required selector's declarations and fail on a missing or unterminated rule. */
function cssRuleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert(start >= 0, `missing CSS rule for ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  const end = css.indexOf("}", bodyStart);
  assert(end > bodyStart, `unterminated CSS rule for ${selector}`);
  return css.slice(bodyStart, end);
}

/** Decode the runtime manifest emitted beside a selected design-system bundle. */
async function bundleManifest(
  name: DesignSystemBundleName,
): Promise<RuntimeManifest> {
  return JSON.parse(
    await Deno.readTextFile(join(bundleRoot(name), "manifest.json")),
  ) as RuntimeManifest;
}

/** Expand configured component groups and transitive dependencies in canonical manifest order. */
function resolvedSelection(name: DesignSystemBundleName): string[] {
  const selection = DESIGN_SYSTEM_BUNDLES[name];
  const seeds = new Set<string>(selection.components);
  const selectedGroups = new Set<string>(selection.groups);
  for (const component of packageManifest.components) {
    if (selectedGroups.has(component.group)) seeds.add(component.id);
  }
  const canonicalIds = (ids: Iterable<string>): string[] => {
    const selected = new Set(ids);
    return packageManifest.components
      .filter((component) => selected.has(component.id))
      .map((component) => component.id);
  };
  const resolved: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const component = packageManifest.components.find((entry) =>
      entry.id === id
    );
    assert(component !== undefined, `${name} selects unknown component ${id}`);
    for (const dependency of canonicalIds(component.dependencies)) {
      visit(dependency);
    }
    visited.add(id);
    resolved.push(id);
  };
  for (const id of canonicalIds(seeds)) visit(id);
  return resolved;
}

/** Collect CSS rule preludes that mention classes owned by selected components. */
function componentOwnedSelectors(
  source: string,
  ownedClasses: ReadonlySet<string>,
): string[] {
  const selectors = new Set<string>();
  for (const rule of source.matchAll(/([^{}]+)\{/g)) {
    const prelude = (rule[1] ?? "").trim();
    for (const match of prelude.matchAll(/\.([_a-zA-Z0-9-]+)/g)) {
      if (ownedClasses.has(match[1] ?? "")) selectors.add(prelude);
    }
  }
  return [...selectors].toSorted();
}

Deno.test("Discern pins one exact public design-system dependency", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.json")),
  ) as DenoConfig;
  assertEquals(config.workspace, undefined);
  assertEquals(
    Object.entries(config.imports).filter(([key, value]) =>
      key.includes("design-system") || value.includes("design-system")
    ),
    [["discern-design-system", DESIGN_SYSTEM_SPECIFIER]],
  );
  assertEquals(config.minimumDependencyAge, {
    age: "P1D",
    exclude: ["jsr:@discern-sh/design-system"],
  });

  const lock = JSON.parse(
    await Deno.readTextFile(join(ROOT, "deno.lock")),
  ) as DenoLock;
  assertEquals(lock.specifiers[DESIGN_SYSTEM_SPECIFIER], "0.10.1");
  assert("@discern-sh/design-system@0.10.1" in lock.jsr);

  const sourceFiles = (await walk(SITE_ROOT)).filter((path) =>
    /\.[cm]?[jt]sx?$/.test(path)
  );
  const forbidden = [
    "site/design-system",
    "jsr:@discern-sh/design-system",
    "jsr.io/@discern-sh/design-system",
    "/.deno/",
    "/design-system/dist/",
  ];
  const violations: string[] = [];
  for (const path of sourceFiles) {
    const source = await Deno.readTextFile(path);
    for (const pattern of forbidden) {
      if (source.includes(pattern)) {
        violations.push(`${relative(ROOT, path)}: ${pattern}`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("the production site import graph remains React-free", async () => {
  const newSibling = "https://example.test/vendor/react-dom@99/server";
  assertEquals(
    reactRuntimeModules([
      "https://example.test/new-server.ts",
      newSibling,
    ]),
    [newSibling],
  );
  assertEquals(
    reactRuntimeModules(
      await moduleSpecifiers(join(ROOT, "site/main.ts")),
    ),
    [],
  );
});

Deno.test("each emitted bundle is the dependency closure of the site selection", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const expected = DESIGN_SYSTEM_BUNDLES[name];
    const runtime = await bundleManifest(name);
    const resolved = resolvedSelection(name);
    assertEquals(runtime.package, packageManifest.package);
    assertEquals(runtime.groups, packageManifest.groups);
    assertEquals(
      runtime.components,
      resolved.map((id) => {
        const component = packageManifest.components.find((entry) =>
          entry.id === id
        );
        assert(
          component !== undefined,
          `${name} resolved unknown component ${id}`,
        );
        return component;
      }),
    );
    assertEquals(runtime.publicTokenNames, packageManifest.publicTokenNames);
    assertEquals(runtime.selection.all, false);
    assertEquals(runtime.selection.requestedComponents, expected.components);
    assertEquals(runtime.selection.requestedGroups, expected.groups);
    assertEquals(runtime.selection.resolvedComponents, resolved);
    assertEquals(runtime.selection.assets, expected.assets);
    assertEquals(runtime.selection.theme, expected.theme);
  }
});

Deno.test("the docs bundle excludes unrelated compositions and optional grain", async () => {
  const runtime = await bundleManifest("docs");
  const selected = new Set(runtime.selection.resolvedComponents);
  // The docs chrome legitimately selects the Editorial table of contents;
  // every OTHER Marketing/Editorial composition must stay out of the bundle.
  const requested = new Set(resolvedSelection("docs"));
  const unrelated = packageManifest.components.filter((component) =>
    (component.group === "Marketing" || component.group === "Editorial") &&
    !requested.has(component.id)
  );
  assert(unrelated.length > 0, "the exclusion set must stay non-empty");
  assert(unrelated.every((component) => !selected.has(component.id)));
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  for (const component of unrelated) {
    for (const ownedClass of component.ownedClasses) {
      assert(
        !css.includes(`.${ownedClass}`),
        `docs CSS contains ${ownedClass}`,
      );
    }
  }
  assertEquals(runtime.selection.assets, ["fonts"]);
  assertEquals(
    await Array.fromAsync(Deno.readDir(bundleRoot("docs"))).then((entries) =>
      entries.some((entry) => entry.name === "grain.css")
    ),
    false,
  );
});

Deno.test("the docs bundle emits the glossary term and its hover-card dependency", async () => {
  const runtime = await bundleManifest("docs");
  assert(runtime.selection.resolvedComponents.includes("glossary-term"));
  assert(runtime.selection.resolvedComponents.includes("hover-card"));
  assertEquals(runtime.outputs.scripts, ["discern.js"]);
  const css = await Deno.readTextFile(join(bundleRoot("docs"), "discern.css"));
  assertStringIncludes(css, ".discern-glossary-term");
  assertStringIncludes(css, ".discern-hover-card");
  assertStringIncludes(css, ".discern-dotted-underline");
});

Deno.test("generated output is ignored and reproducible from its selections", async () => {
  const repoPaths = GENERATED_SITE_OUTPUTS.map((output) =>
    join("site", output)
  );
  const tracked = await git(["ls-files", "--", ...repoPaths]);
  assertEquals(tracked.code, 0);
  assertEquals(new TextDecoder().decode(tracked.stdout).trim(), "");
  for (const path of repoPaths) {
    const ignored = await git(["check-ignore", "--quiet", "--no-index", path]);
    assertEquals(ignored.code, 0, `${path} must be ignored`);
  }

  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/index.html")),
    await formatGeneratedText(renderLanding(), "html"),
  );
  assertEquals(
    await Deno.readTextFile(join(ROOT, "site/pages/fragments/brand.html")),
    renderDiscernBrand(),
  );

  for (const asset of COPIED_PAGE_ASSETS) {
    assertEquals(
      await Deno.readTextFile(join(bundleRoot("compositions"), asset)),
      `/* Generated by site/build.ts from site/page-src/${asset}. Do not edit. */\n${await Deno
        .readTextFile(join(ROOT, "site/page-src", asset))}`,
    );
  }

  for (const output of RETIRED_SITE_OUTPUTS) {
    await assertRejects(
      () => Deno.stat(join(ROOT, "site", output)),
      Deno.errors.NotFound,
      output,
    );
  }
});

Deno.test("the public homepage presents engineering discipline for coding agents", async () => {
  assert(DESIGN_SYSTEM_BUNDLES.compositions.routes.includes("/"));
  const response = await handler(
    new Request("https://discern.sh/", { headers: BROWSER }),
  );
  assertEquals(response.status, 200);
  const html = await response.text();
  const dom = new JSDOM(html);
  const body = dom.window.document.body;
  const text = body.textContent ?? "";

  // The first screen names the product category and the operational change.
  assertEquals(body.querySelectorAll("h1").length, 1);
  assertEquals(
    body.querySelector("h1")?.textContent?.trim(),
    "Engineering discipline for coding agents",
  );
  assertStringIncludes(text, "same project knowledge");
  assertStringIncludes(text, "separate worktrees");
  assertStringIncludes(text, "requires proof");
  assertEquals(text.includes("definition of done"), false);

  // The product introduction keeps the shared accessible page structure.
  assertEquals(body.querySelectorAll("main#main").length, 1);
  const articleHeader = body.querySelector(".discern-article-header");
  assert(articleHeader !== null);
  assert(body.querySelector(".discern-skip-link") !== null);
  assertEquals(body.querySelector(".discern-article-layout"), null);
  for (const placeholder of ["Placeholder", "Lorem ipsum", "The ask"]) {
    assertEquals(text.includes(placeholder), false, placeholder);
  }

  // The masthead, calls to action, logo cloud, and footer use their
  // design-system contracts rather than page-owned approximations.
  assert(body.querySelector(".landing-masthead .discern-brand--lg") !== null);
  assert(
    body.querySelector(
      ".landing-masthead .discern-theme-toggle--quiet",
    ) !== null,
  );
  assertEquals(body.querySelectorAll(".landing-brand-name").length, 2);
  const actionCluster = body.querySelector(
    ".discern-article-header__actions > .discern-cluster",
  );
  assert(actionCluster !== null);
  assertEquals(
    actionCluster.getAttribute("style"),
    "--discern-cluster-gap:var(--discern-space-4)",
  );
  const actions = [
    ...actionCluster.querySelectorAll("a"),
  ];
  assertEquals(
    actions.map((action) => action.textContent?.trim()),
    ["Install discern", "Read the manual"],
  );
  assertEquals(
    actions.map((action) => action.getAttribute("href")),
    ["/docs/getting-started/quickstart", "/docs"],
  );
  assertEquals(
    [
      ...body.querySelectorAll(".discern-article-header__meta li"),
    ].map((item) => item.textContent?.trim()),
    [
      "Free and Fair Source",
      "Runs offline",
      "No API key",
      "Not an AI",
    ],
  );

  const control = body.querySelector(".landing-control");
  assertEquals(control, null);
  assertEquals(
    text.includes("Your project decides when work is finished."),
    false,
  );
  const landingSource = await Deno.readTextFile(
    join(ROOT, "site/page-src/landing.tsx"),
  );
  const controlSourceIndex = landingSource.indexOf(
    'className="landing-control"',
  );
  const commentStart = landingSource.lastIndexOf("/*", controlSourceIndex);
  const commentEnd = landingSource.indexOf("*/", controlSourceIndex);
  const commentPrefix = landingSource.slice(0, commentStart).trimEnd();
  const commentSuffix = landingSource.slice(commentEnd + 2).trimStart();
  assert(
    commentStart >= 0 &&
      controlSourceIndex > commentStart &&
      commentEnd > controlSourceIndex &&
      commentPrefix.endsWith("{") &&
      commentSuffix.startsWith("}"),
    "the hidden control section must remain in a JSX comment for review",
  );
  assertStringIncludes(
    landingSource.slice(commentStart, commentEnd),
    "Your project decides when work is finished.",
  );

  const integrationItems = [
    ...body.querySelectorAll(".discern-logo-cloud li"),
  ];
  const integrationImages = integrationItems.map((item) =>
    item.querySelector("img")
  );
  assertEquals(
    integrationItems.map((item) => item.lastElementChild?.textContent?.trim()),
    AGENT_NAMES.map((name) => PROVIDERS[name].label),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("src")),
    AGENT_NAMES.map((name) => PROVIDERS[name].brand.mark.path),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("alt")),
    AGENT_NAMES.map(() => ""),
  );
  assertEquals(
    integrationImages.map((image) => image?.getAttribute("class")),
    AGENT_NAMES.map(() => "landing-provider-logo"),
  );
  assertEquals(
    integrationItems.map((item) =>
      item.querySelector(".landing-provider-logo-frame")?.getAttribute("style")
    ),
    AGENT_NAMES.map((name) =>
      `--landing-provider-logo-mask:url("${
        providerBrandSilhouette(PROVIDERS[name].brand).path
      }")`
    ),
  );
  assertEquals(
    body.querySelector(".discern-logo-cloud")?.getAttribute("aria-label"),
    `${AGENT_NAMES.length} native coding agent integrations`,
  );
  const integrationCloud = body.querySelector(".discern-logo-cloud");
  assert(integrationCloud !== null);
  assertEquals(
    [...articleHeader.children].map((child) => child.className),
    [
      "discern-article-header__inner",
      "discern-logo-cloud discern-logo-cloud--center landing-integrations",
    ],
  );
  assertEquals(
    integrationCloud.querySelector(".discern-logo-cloud__label"),
    null,
  );
  assertEquals(text.includes("Native coding agent integrations"), false);
  assertEquals(articleHeader.nextElementSibling, null);
  const main = body.querySelector("main#main");
  assert(main !== null);
  assertEquals(main.children.length, 1);
  assertEquals(main.firstElementChild, articleHeader);
  assertEquals(
    body.querySelector(".landing-benefit, .landing-footprint"),
    null,
  );
  assertEquals(html.includes("landing.js"), false);
  const footer = body.querySelector(".discern-site-footer");
  assert(footer !== null);
  assertEquals(main.nextElementSibling, footer);
  assertEquals(
    body.querySelectorAll(".discern-site-footer__nav > div").length,
    2,
  );
  assertEquals(
    footer.querySelector(".discern-site-footer__description")?.textContent
      ?.trim(),
    "Discern makes AI coding agents work like a disciplined engineering team. It coordinates their changes, separates parallel tasks, and proves their work is correct before it ships.",
  );
  assertEquals(
    [...footer.querySelectorAll(".discern-site-footer__base a")].map(
      (link) => [
        link.textContent?.trim(),
        link.getAttribute("href"),
      ],
    ),
    [
      ["GitHub ↗", "https://github.com/jackwh/discern"],
      ["llms.txt", "/llms.txt"],
    ],
  );
  assertEquals(
    footer.querySelector(".discern-site-footer__base > span:last-child")
      ?.textContent?.trim(),
    "© 2026 Jack Webb-Heller.",
  );
  assertEquals(text.includes("macOS · Linux · WSL2"), false);
  assertEquals(text.includes("Open source under Apache-2.0."), false);
  assertEquals(text.includes("Free and open source"), false);
  const landingCss = await Deno.readTextFile(
    join(ROOT, "site/page-src/landing.css"),
  );
  assertStringIncludes(
    landingCss,
    "grid-template-columns: repeat(3, minmax(0, 1fr))",
  );
  const mastheadRule = cssRuleBody(landingCss, ".landing-masthead");
  assertStringIncludes(
    mastheadRule,
    "width: min(100% - 2 * var(--discern-space-6), var(--discern-page-max));",
  );
  assertEquals(mastheadRule.includes("max-inline-size"), false);
  assertStringIncludes(landingCss, "inset-block-start: 3px;");
  assertStringIncludes(landingCss, "inset-block-start: -3px;");
  assertStringIncludes(landingCss, ".landing-provider-logo");
  assertStringIncludes(
    cssRuleBody(
      landingCss,
      'html[data-discern-theme="dark"] .landing-provider-logo-frame',
    ),
    "background: transparent;",
  );
  const darkSilhouetteRule = cssRuleBody(
    landingCss,
    'html[data-discern-theme="dark"] .landing-provider-logo-frame::before',
  );
  assertStringIncludes(darkSilhouetteRule, "background: currentColor;");
  assertStringIncludes(
    darkSilhouetteRule,
    "mask: var(--landing-provider-logo-mask)",
  );
  assertStringIncludes(
    cssRuleBody(
      landingCss,
      'html[data-discern-theme="dark"] .landing-provider-logo',
    ),
    "opacity: 0;",
  );
  assertEquals(landingCss.includes(".landing-benefit"), false);
  assertEquals(landingCss.includes(".landing-footprint"), false);
  assertEquals(landingCss.includes(".landing-provider-logo--"), false);

  // Static output: local runtime assets only, and no React browser runtime.
  assert(
    runtimeAssetReferences(html).every((path) => path.startsWith("/")),
  );
  assertEquals(
    ["fonts.googleapis.com", "cdn.jsdelivr.net", "jsr.io", "react"].filter(
      (origin) => html.includes(origin),
    ),
    [],
  );
  dom.window.close();
});

Deno.test("consumer CSS never targets a package-manifest-owned class", async () => {
  const owned = new Set(
    packageManifest.components.flatMap((component) => component.ownedClasses),
  );
  assert(owned.size > 0);
  const violations: string[] = [];
  for (const path of await walk(SITE_ROOT)) {
    const repoPath = relative(ROOT, path);
    if (
      !path.endsWith(".css") ||
      repoPath.startsWith("site/pages/assets/design-system/")
    ) continue;
    for (
      const selector of componentOwnedSelectors(
        await Deno.readTextFile(path),
        owned,
      )
    ) {
      violations.push(`${repoPath}: ${selector}`);
    }
  }
  assertEquals(violations, []);
});

Deno.test("bundle routes use local static assets and ship no React runtime", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    for (const route of DESIGN_SYSTEM_BUNDLES[name].routes) {
      const response = await handler(
        new Request(`https://discern.sh${route}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, route);
      const html = await response.text();
      assertStringIncludes(html, "data-discern-root");
      const runtimeRefs = runtimeAssetReferences(html);
      assert(runtimeRefs.length > 0, `${route} has no runtime assets`);
      const runtime = await bundleManifest(name);
      for (const script of runtime.outputs.scripts) {
        const expected = designSystemAssetPath(name, script);
        assert(
          runtimeRefs.includes(expected),
          `${route} omits emitted package script ${expected}`,
        );
      }
      assert(
        runtimeRefs.every((value) => value.startsWith("/")),
        `${route} remote runtime references: ${runtimeRefs.join(", ")}`,
      );
      const bundlePrefix = designSystemAssetPath(name, "");
      assert(
        runtimeRefs.filter((value) => value.includes("/design-system/"))
          .every((value) => value.startsWith(bundlePrefix)),
        `${route} uses the wrong bundle: ${runtimeRefs.join(", ")}`,
      );
      assertEquals(
        runtimeRefs.filter((value) => /(?:react|jsx-runtime)/i.test(value)),
        [],
      );
    }
  }
});

Deno.test("every bundle selects the canonical brand lockup", () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    assert(
      DESIGN_SYSTEM_BUNDLES[name].components.includes("brand"),
      `${name} must select the brand component`,
    );
  }
});

Deno.test("every emitted package asset is local, licensed, and served by type", async () => {
  for (
    const name of Object.keys(DESIGN_SYSTEM_BUNDLES) as DesignSystemBundleName[]
  ) {
    const runtime = await bundleManifest(name);
    const integrity = new Map(
      runtime.integrity.files.map((file) => [file.path, file]),
    );
    for (const file of runtime.integrity.files) {
      const path = designSystemAssetPath(name, file.path);
      const response = await handler(
        new Request(`https://discern.sh${path}`, { headers: BROWSER }),
      );
      assertEquals(response.status, 200, path);
      assertStringIncludes(
        response.headers.get("content-type") ?? "",
        file.mediaType,
        path,
      );
      assertEquals((await response.arrayBuffer()).byteLength, file.bytes, path);
    }

    const fontOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("fonts/") || path.startsWith("licenses/") ||
      path === "fonts.css"
    );
    const grainOutputs = runtime.outputs.assets.filter((path) =>
      path.startsWith("textures/") || path === "grain.css"
    );
    assertEquals(
      fontOutputs.length > 0,
      runtime.selection.assets.includes("fonts"),
    );
    assertEquals(
      grainOutputs.length > 0,
      runtime.selection.assets.includes("grain"),
    );
    for (const path of runtime.outputs.assets) {
      assert(integrity.has(path), `${name} asset lacks integrity: ${path}`);
    }
    for (
      const licence of fontOutputs.filter((path) =>
        path.startsWith("licenses/")
      )
    ) {
      const body = await Deno.readTextFile(join(bundleRoot(name), licence));
      assertStringIncludes(body, "SIL OPEN FONT LICENSE");
    }
  }
});
